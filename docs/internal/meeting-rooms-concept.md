# Meeting Rooms Concept (Multi-Participant Relay)

Date: 2026-03-01
Project: ClawSuite-Relay

## Seed idea
A "meeting room" is a structured, multi-participant conversation where 3+ participants (human + agents) collaborate under an explicit protocol (for example round-robin), with clear turn-taking, traceability, and outcomes.

## Prior response (captured)
As of March 1, 2026, this idea is both real and still worth doing.

1. What already exists
- Consumer side: ChatGPT has official multi-human group chats (up to 20 people + ChatGPT in one thread).
- Builder side: multi-agent orchestration frameworks are mature (LangChain/LangGraph multi-agent docs, AutoGen GroupChat, CrewAI flows/crews).

2. Why your "meeting rooms" still has a niche
- Existing tools are either generic chat UX or developer frameworks.
- ClawSuite already has role identity, persistent channels, relay, and org framing.
- Niche: structured, auditable, role-based meetings inside operational workflows.

3. Suggested product shape
- "Create meeting room" with participants, protocol, context pack, and stop condition.
- Output artifact: summary, decisions, action items, unresolved questions.

4. Round-robin specifically
- Good MVP, but pure round-robin can become verbose.
- Better: round-robin + facilitator rules (max turn size, pass, skip-if-no-delta, termination test).

5. Technical tractability
- Tractable on current relay base.
- Core work: meeting state, scheduler loop, routing adapter, memory policy, loop guardrails, room commands/UI.

6. Effort sizing
- MVP: ~3-7 focused days.
- Solid v1: ~2-4 weeks.

7. Recommendation
- Build it.
- Positioning: structured multi-agent meetings with persistent role memory and decision artifacts.

## Follow-up analysis: UX of existing solutions and where the gap is

### How current solutions typically feel to users
1. Consumer group chat UX
- Very easy to start.
- Great for mixed human conversation.
- Weak on explicit protocol/governance (turn contracts, role policies, auditable task ownership).

2. Developer multi-agent frameworks
- Flexible and powerful.
- Require building orchestration logic, UI, persistence, and failure handling.
- Often optimized for app builders rather than end users who want "run a meeting now".

### Why there is still a gap for this idea
1. Missing "operations-native" meeting primitive
- Teams want a recognizable "meeting" object, not ad hoc chained prompts.

2. Weak accountability artifacts in many flows
- Often no first-class decision log with owner + deadline + rationale in one place.

3. Weak continuity semantics
- Sessions can be transient or fragmented.
- Hard to reason about what persists where unless explicitly engineered.

4. Organizational mental model fit
- Your CEO/functional-agent framing maps naturally to rooms, agendas, and outcomes.

## Persistence: what it can mean here

### Important distinction
"Persistence" is not one thing; choose explicitly:

1. Transcript persistence
- Every utterance is durably recorded and auditable.

2. Participant memory persistence
- Whether each agent's own channel/session later "remembers" room content.

3. State persistence
- Room protocol state survives restart (turn index, pending speaker, timers, votes).

4. Artifact persistence
- Decisions/action items are stored in structured records for later retrieval.

### Recommended model for ClawSuite relay
1. Keep relay-native channel persistence as source of truth
- Each agent receives meeting turns via its own channel context.
- This preserves continuity with the existing relay mental model.

2. Add a virtual room view on top
- A combined "room transcript" view for humans.
- Under the hood, dispatch still routes through agent channels.

3. Gate response triggering
- Agents can see full conversation context, but only the scheduled speaker is prompted to respond.
- Others receive context updates as read-only meeting state messages.

4. Avoid detached transient spawn-only memory for core rooms
- Spawn-only participants risk memory discontinuity with main agent channels.
- Use spawn mode only for explicitly temporary participants.

## Interface direction (MVP)
1. `meeting_create(roomId, participants, protocol, maxRounds, objective)`
2. `meeting_start(roomId)`
3. `meeting_advance(roomId)` (scheduler chooses next speaker)
4. `meeting_pause(roomId)` / `meeting_resume(roomId)`
5. `meeting_close(roomId)` (emit summary + decisions + owners)

## Risk notes (early)
1. Token/cost growth in large rooms.
2. Turn drift if protocol is too soft.
3. Infinite/long loops without hard stop conditions.
4. Concurrency hazards if multiple triggers fire simultaneously.

## Practical framing for next step
- Treat this as a relay extension, not a separate subsystem.
- Build "room orchestration + room transcript" while preserving channel-native agent continuity.
- Keep MVP narrow: one protocol (round-robin + facilitator constraints), one room artifact schema.
- Consider first building a cross-agent projects layer without "interactive" meetings to hone in on the gap between projects and meetings
- Consider building B2B business suite but first demonstrate utility in-house

## References
- OpenAI Group Chats announcement: https://openai.com/index/group-chats-in-chatgpt/
- OpenAI Group Chats help: https://help.openai.com/en/articles/12703475-group-chats-in-chatgpt
- LangChain multi-agent docs: https://docs.langchain.com/oss/python/langchain/multi-agent/index
- LangGraph multi-agent concepts: https://langchain-ai.lang.chat/langgraphjs/concepts/multi_agent/
- AutoGen GroupChat reference: https://microsoft.github.io/autogen/0.2/docs/reference/agentchat/groupchat
- AutoGen GroupChat notebook: https://microsoft.github.io/autogen/0.2/docs/notebooks/agentchat_groupchat/
- CrewAI Flow docs: https://docs.crewai.com/concepts/Flow
