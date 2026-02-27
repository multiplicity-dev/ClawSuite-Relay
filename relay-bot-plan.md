# Relay Bot Plan — Orchestrator↔subagent Transparency

**Created:** 2026-02-26  
**Owner:** President (design), CTO (implementation)  
**Status:** Milestone 1 implementation IN PROGRESS — core relay loop works, blockers remain (see implementation-plan.md)
**Source conversation:** orchestrator #general session, Feb 26 2026 (afternoon/evening)  
**Reference docs:**
- `/home/dave/Documents/Notes/ceo/multi-agent-research.md` — research on multi-agent patterns, context gathering, community approaches
- `/home/dave/.openclaw/workspace-it/published/hook-implementation-spec.md` — hook-based enforcement architecture for orchestrator quality control (tag system, output gates, tool restrictions, pre-dispatch checks)
- `/home/dave/.openclaw/workspace/published/agent-governance-vision.md` — 8 structural problems identified in current agent operations + solution hierarchy + decision tree concept for iterative projects

---

## 1. The Problem

### 1.1 What happens today

When the president (human user) asks orchestrator (openclaw orchestrator) to delegate work to a subagent:

1. President types in #general (Discord channel for orchestrator)
2. orchestrator calls `sessions_spawn(agentId="systems-eng", task="...")`
3. A **transient session** is created: `~/.openclaw/agents/systems-eng/sessions/<uuid>.jsonl`
4. CTO (example subagent) works inside that session — reads files, runs commands, reasons, produces output
5. CTO finishes. orchestrator receives a completion announce: status line + CTO's final assistant text
6. orchestrator synthesizes and responds in #general

**What the president sees:** orchestrator synthesis in #general plus (today) a clipped/partial subagent completion announce. This is redundant and noisy once relay transparency exists. In relay mode, the target behavior is to suppress transient subagent completion announces to #general and keep subagent detail in subagent channels only.

**What the subagent remembers:** Nothing. The work happened in a transient subagent session, not in CTO's main #it (Discord channel for CTO) channel session. When the president later chats with CTO directly in #it, CTO has zero memory of orchestrator-dispatched work.

**What the orchestrator remembers:** Only the announce summary. The full subagent conversation (tool calls, intermediate reasoning, complete response) lives only in the JSONL file.

### 1.2 The double-blind problem

- **orchestrator forgets** what it delegated (unless it re-reads JSONL via `sessions_history`)
- **CTO doesn't know** what was delegated to it (transient session, not main session)
- **President can't audit** the subagent's actual work without digging into JSONL files
- **Errors propagate silently** — if orchestrator's summary is wrong, neither president nor subagent catches it because neither sees the raw exchange

### 1.3 Three layers of information richness

1. **Raw JSONL** — everything: tool calls, intermediate steps, thinking blocks, assistant text. Only accessible via file read or `sessions_history`.
2. **Assistant text** — what the agent "says" in response. A fraction of the JSONL. This is what appears in chat and what gets forwarded in completion announces.
3. **orchestrator synthesis** — orchestrator's integrated response in #general, working off the assistant text it received. May involve multiple subagents.

Today the president only sees layer 3. The relay bot makes layer 2 visible in subagent channels.

### 1.4 Why this matters beyond debugging

This isn't just about catching errors. It's about:
- **President can directly read subagent reasoning** in the subagent's channel, at the subagent's level of detail
- **Multi-subagent coordination becomes transparent** — president sees orchestrator's prompt to CLO (a second subagent example) in #legal (Discord channel for CLO), orchestrator's prompt to CTO in #it, each subagent's response, and orchestrator's integrated answer in #general
- **subagent context builds naturally** — because work happens in the main session, CTO accumulates knowledge over time instead of starting fresh each spawn
- **The president can go direct** — if orchestrator's integration adds no value for a particular question, the president can just read the subagent channel

---

## 2. The Target User Experience

### 2.1 Single-subagent delegation

1. President types in #general: "Ask CTO how the exec tool security config works"
2. orchestrator reformulates: composes a proper technical question with context (NOT a passthrough of the president's words — orchestrator adds value by framing the question with relevant context the subagent needs)
3. **In #it:** orchestrator's reformulated prompt appears as a message (posted by relay bot, mentioning CTO)
4. **In #it:** CTO responds as if a human asked — natural channel response, persistent in CTO's main session
5. **In #general:** orchestrator receives CTO's response (via hook push), synthesizes, and responds to the president
6. President can read #it for CTO's direct response, or read #general for orchestrator's synthesis

### 2.2 Multi-subagent delegation

1. President types in #general: "I need CLO and CTO to both weigh in on the hook enforcement approach"
2. orchestrator composes **different** prompts for each subagent (tailored to their domain)
3. **In #legal:** orchestrator's legal-framed question appears, CLO responds
4. **In #it:** orchestrator's technical-framed question appears, CTO responds
5. **In #general:** orchestrator receives both responses, produces a single integrated analysis
6. President sees: individual subagent responses in their channels + integrated answer in #general

### 2.3 What it feels like

From the president's perspective: "I talk to orchestrator. orchestrator's version of my question appears in the relevant subagent channels. subagents respond in their channels like they would to me. orchestrator gives me the integrated answer. I can check any subagent's channel for detail."

From the subagent's perspective: "I receive a question in my channel and respond. It's part of my normal session. I remember this work next time someone talks to me."

From the orchestrator's perspective: "I compose prompts, they get posted to channels, I receive the responses via push notification, and I synthesize."

### 2.4 Key properties

- **(a)** The output "mirrored" to subagent channels is orchestrator's reformulated prompt and the subagent's natural response — not raw data dumps, not additional summarization layers. What appears in channel is what would appear if the president had asked directly (just with orchestrator's framing instead of the president's words).
- **(b)** This mirrored information is part of the subagent's main session context. Future prompts (from orchestrator or president) automatically include it — no special injection needed.
  - Clarification: this does **not** guarantee orchestrator has enough context when composing new dispatches across many agents/channels. orchestrator still needs explicit pre-dispatch context gathering (`sessions_history` + STATUS/memory checks) before writing prompts. This is distinct from orchestrator's downstream synthesis context in section 3.8.
- **(c)** The relay mechanism does not create cascading responses. The relay bot posts the prompt; the subagent responds once; the hook forwards to orchestrator. No loops.
- **(d)** This is the **default flow** whenever orchestrator delegates. Not an opt-in mode.
- **(e)** Strategic benefit: reduces forced choice between orchestrator-first and subagent-first interaction styles. If relay works as intended, users can fluidly move between direct subagent interaction (speed/depth) and orchestrator synthesis (integration) without losing transparency or continuity.

---

## 3. Technical Architecture

### 3.1 Components

1. **Relay bot** — a second Discord bot (separate token from OpenClaw's bot) that posts messages to subagent channels
2. **OpenClaw plugin** — handles the `message_sent` hook to forward subagent responses back to orchestrator
3. **OpenClaw config changes** — `allowBots=true`, mention gating, channel mappings

### 3.2 Message flow

```
President → #general → orchestrator processes → orchestrator composes task prompt
                                            ↓
                                    Relay bot posts prompt to #it
                                    (mentions CTO, from different bot token)
                                            ↓
                                    CTO sees message in main session
                                    (requireMention satisfied by relay bot's @CTO)
                                            ↓
                                    CTO responds in #it (normal channel response)
                                            ↓
                                    message_sent hook fires on CTO's response
                                            ↓
                                    Plugin forwards assistant text to orchestrator
                                    (via sessions_send or enqueueSystemEvent)
                                            ↓
                                    orchestrator synthesizes in #general
```

### 3.3 Why a second bot appears necessary

OpenClaw's Discord integration hard-drops the bot's own messages from session context:
```
if (params.botUserId && author.id === params.botUserId) return null;
```
Source: `dist/pi-embedded-BDhvoWGL.js` line ~47905

This is not configurable. Not affected by `allowBots`. A message posted by the OpenClaw bot to its own channel will never enter that channel's agent session context.

A second bot token bypasses this filter. With `allowBots=true`, the relay bot's messages are ingested into the subagent's session like any other user message.

### 3.4 How mention gating prevents loops

- subagent channels have `requireMention=true`
- Relay bot messages include an @mention of the subagent → subagent processes and responds
- Messages posted by the OpenClaw bot itself (e.g., orchestrator posting to a different channel) would be dropped by the self-filter anyway
- The relay bot ONLY posts orchestrator's prompts — it never posts anything that would trigger a second response
- The subagent responds once → `message_sent` hook fires → plugin forwards to orchestrator → orchestrator responds in #general (a different channel — no loop)

### 3.5 How orchestrator receives the response

The plugin forwards subagent responses to orchestrator via `sessions_send`, which triggers a orchestrator turn.

**Single-subagent dispatch:** Straightforward. subagent responds → plugin forwards → orchestrator synthesizes.

**Multi-subagent dispatch:** The plugin batches responses (see 3.6) and only calls `sessions_send` once with the complete set. orchestrator should not be woken per-response — waking orchestrator on each arrival burns tokens on intermediate "not yet complete" turns and requires separate enforcement to ensure orchestrator waits rather than synthesizing prematurely on partial information. The plugin owns the batching logic; orchestrator is only triggered when all expected responses are in.

**Response framing:** The forwarded message to orchestrator must include structured context — not just raw response text. At minimum:
- **subagent identity** — which agent produced this response
- **Correlation ID** — which dispatch batch this belongs to (for multi-subagent flows)
- **Response text** — the subagent's full assistant text

Without this framing, orchestrator must infer attribution, which is error-prone when multiple subagents respond to related prompts. The exact format is a Track A implementation decision, but the requirement is fixed: orchestrator must receive enough metadata to synthesize without guessing. The goal is for orchestrator to receive the subagent's actual assistant text — richer than the short summaries printed to Discord today, without drowning orchestrator in raw JSONL.

### 3.6 Parallel dispatch coordination

When orchestrator sends to multiple subagents simultaneously, it needs to wait for all responses before synthesizing.

**Scripted batching (primary approach):** Each relay dispatch carries a correlation ID (e.g., `dispatch-2026-02-26-001`). The `message_sent` hook on each subagent writes the response + correlation ID to shared state. A batching component tracks expected vs received responses per correlation ID. When all expected responses arrive, it triggers orchestrator (via `sessions_send`) with the complete batch. orchestrator synthesizes once, not per-response.

This is the primary approach — not merely preferred — because:
- **Deterministic** — no reliance on orchestrator correctly managing a checklist (which requires token burn and enforcement of its own)
- **Simpler in practice** — the correlation + batch logic lives in the same plugin that already handles `message_sent`
- **No premature synthesis** — orchestrator cannot respond to the first subagent's response because it never sees it until the batch is complete
- **No mid-turn collision** — if orchestrator is mid-turn when a subagent responds, the plugin simply records the response in batch state; orchestrator is only woken after the batch completes and any current turn ends.
  - This protects a common workflow where the president messages orchestrator while subagents are still in flight.

**Batch state must be file-based, not in-memory.** `enqueueSystemEvent` is in-memory only and lost on gateway restart (see section 5). If the gateway restarts mid-flight with in-memory batch state, the plugin forgets it's waiting for responses — subagents respond, hooks fire, but the batch logic doesn't know a batch exists. File-based state (e.g., `~/.openclaw/extensions/relay-bridge/batches/<correlation-id>.json`) survives restart and can be recovered on plugin re-initialization. This is another reason the scripted approach is primary: it naturally supports durable state, whereas LLM-managed batching has no persistence across restarts.

**Fallback (if scripted batching encounters an unforeseen technical obstacle):** automated fallback only (never manual user procedure). The plugin creates a dispatch manifest and tracks expected responses; if fallback activates, the president is explicitly notified in #general that degraded mode is active. On receiving each response, orchestrator checks: all expected responses received? If yes → synthesize. If no → hold. This is strictly worse: it costs tokens on intermediate "not yet complete" turns, requires enforcement to ensure orchestrator actually waits (a separate enforcement problem), and introduces exactly the mid-turn collision and premature-synthesis risks that scripted batching avoids.

### 3.7 Discord message length and multi-message responses

Discord's 2000-character limit applies to subagent channel responses. If a subagent's response exceeds this, the delivery layer splits it across multiple Discord messages. Each split triggers `message_sent` separately.

**How the plugin knows all parts arrived:** The subagent's agent turn produces one logical response, which OpenClaw may split into multiple Discord sends. The plugin needs to distinguish "subagent sent 3 messages as one response" from "subagent sent 3 separate responses to 3 different prompts."

**V1 decision:** Buffer messages per subagent per correlation ID with a short debounce window (e.g., 5 seconds of no new messages from that subagent = response complete). This is consistent with the scripted-batching philosophy in 3.6 — the plugin handles reassembly, not orchestrator. CTO should also investigate OpenClaw's internal message sequencing during implementation, which may provide a cleaner signal than time-based debounce.

### 3.8 What orchestrator receives vs today

| | Today (sessions_spawn) | Relay bot |
|---|---|---|
| orchestrator gets | `buildCompletionDeliveryMessage`: status line + final assistant text | `message_sent` hook content: actual chat-visible text |
| Intermediate steps | Not included | Not included |
| Raw JSONL | Accessible via `sessions_history` | Not applicable (work in main session, not JSONL) |
| Richness | Equivalent | Equivalent |

The relay bot does NOT change what orchestrator works off of for synthesis. It changes WHERE the work happens (main session vs transient) and WHO can see it (everyone in channel vs nobody).

### 3.9 Concurrent session access

Nothing prevents the president from talking directly to a subagent in its channel while a relay prompt from orchestrator is also in flight. This can produce interleaved conversations — the subagent sees messages from the relay bot (orchestrator's prompt) and from the president (a separate topic) arriving in the same session, with no structural separation.

**This is not a problem unique to the relay bot.** It exists today whenever two users message the same channel, or whenever the president switches topics mid-conversation with any agent. The relay bot does not introduce the problem — it simply creates a second path (orchestrator-via-relay alongside president-direct) where interleaving can occur.

**Practical likelihood:** Non-trivial. A high-probability workflow is switching between direct subagent chat (efficiency) and orchestrator orchestration (integration). Relay design should support this fluid switching without forcing the president to stay in one channel.

**Mitigations:**
- **subagent soul.md** documents the relay architecture. The subagent understands that messages from the relay bot (identifiable by sender — see section 7, relay bot identity) represent orchestrator-dispatched work, and can maintain coherence when interleaved with direct president messages.
- **Relay bot identity** makes the source visually distinct in channel (see section 7). Both the subagent and the president can see which messages are relay-originated vs direct.
- **No hard enforcement in v1.** If interleaving causes coherence problems in practice, a future mitigation could be a "busy" flag on the subagent session that defers relay prompts until the current conversation completes. This is over-engineering for v1.

---

## 4. What This Solves (and What It Doesn't)

### 4.1 Solved

- **subagent amnesia:** Work happens in main session → subagent remembers it. This means when the president later chats directly with CTO in #it, CTO has full context of all orchestrator-dispatched work — no "what did orchestrator ask you to do?" re-orientation needed. This is a major improvement over transient subagent sessions where all delegated work was invisible to the subagent's persistent session.
- **President visibility:** Real conversation visible in subagent channels
- **orchestrator context:** orchestrator receives subagent response and produces own synthesis (which becomes orchestrator's session context)
- **Audit trail:** President can review any subagent's channel for unfiltered responses
- **Multi-subagent transparency:** Each subagent's contribution visible in its own channel; integration visible in #general

### 4.2 Not solved by relay bot alone
- **orchestrator pre-dispatch context gathering** — orchestrator still needs to read subagent STATUS.md/memory before composing the prompt. The relay bot changes delivery, not preparation. (Addressed by: `before_prompt_build` hook + pre-dispatch checklist. See hook-implementation-spec.md at `/home/dave/.openclaw/workspace-it/published/hook-implementation-spec.md`, Concept 1 tag `d` + Part 3 context-gathering.)
- **Output verification** — orchestrator still needs to verify subagent output before presenting to president. (Addressed by: two-phase commit output gate. See hook-implementation-spec.md, Concept 2.)
- **orchestrator trajectory lock / role confusion** — orchestrator may still try to answer directly instead of delegating. (Addressed by: tag system + `before_tool_call` gating. See hook-implementation-spec.md, Concept 1.)

**Planning note:** the three bullets above are core-adjacent and should be included in the delivery roadmap (can be phased after relay v1, but explicitly planned).

- **Project management / multi-step continuation** — Relay bot handles one delegation round. Multi-step project orchestration (decision trees, state tracking, automatic continuation) is a separate problem. (Addressed by: decision tree concept. See agent-governance-vision.md at `/home/dave/.openclaw/workspace/published/agent-governance-vision.md`, "Use Case Consideration: Decision Trees for Iterative Projects".)
- **STATUS.md update after work** — subagent needs to update STATUS.md after completing work. Relay bot doesn't enforce this. (Addressed by: `subagent_ended` hook check. See agent-governance-vision.md, Problem 5: "Subagent state loss across sessions".)

### 4.3 Relationship to hook enforcement

The relay bot and the hook enforcement architecture are **complementary, not competing**:
- Hook enforcement governs orchestrator behavior (what it delegates, how it frames prompts, whether it verifies output)
- Relay bot governs delivery mechanics (where work happens, who sees it, how results flow back)
- Both can be built independently. Neither requires the other.
- Combined, they address different parts of the same problem: hook enforcement ensures orchestrator delegates well; relay bot ensures the delegation is transparent and persistent.

---

## 5. Current Technical State (Verified)

These facts were verified by CTO from OpenClaw source code, not inferred:

- Bot self-message filter: hard-coded, not configurable (`dist/pi-embedded-BDhvoWGL.js` ~47905)
- `allowBots=true`: enables other bot messages, does NOT bypass self-filter (`docs/channels/discord.md`)
- `requireMention` + "store for context only": messages that fail mention gate are stored as pending history, not processed (`docs/channels/groups.md`, code ~48246-48260)
- `message_sent` hook: has full outgoing text in `content` field (`dist/plugin-sdk/plugins/types.d.ts`, `dist/deliver-EAUi55EQ.js` ~1158+)
- `enqueueSystemEvent`: max 20 per session, in-memory only, drained once into next prompt, lost on gateway restart (`dist/pi-embedded-BDhvoWGL.js` ~14333-14379)
- `chat.inject`: appends assistant-only note without triggering run — cannot inject user messages (`dist/client-Bri_7bSd.js` ~1677-1681)
- `sessions_send timeout=0`: fire-and-forget but still triggers a run in target session
- Plugin `registerService({ start, stop })`: manages background service lifecycle (`docs/tools/plugin.md`)
- No built-in `chat.append` API for injecting user/assistant pairs without triggering a run
- Subagent completion announce: `buildCompletionDeliveryMessage` = status line + final assistant text (`readLatestSubagentOutput` ~8904+, `buildCompletionDeliveryMessage` ~8775+)
- Session transcript schema: JSONL with `type:"message"`, `message.role:"user"/"assistant"`, parent chain (`docs/reference/session-management-compaction.md`)

---

## 6. Implementation Tracks

### Track A: Local Setup (Priority — Do First)

**Goal:** Working relay system for this deployment. Prove the architecture.

**Components:**
1. Discord bot application (Discord Developer Portal — free)
2. Relay bot script (Node.js or Python, ~100-200 lines): connects to Discord, listens for relay commands from orchestrator (via file, API, or inter-process mechanism), posts to target channels with subagent mention
3. OpenClaw plugin (`~/.openclaw/extensions/relay-bridge/`): `message_sent` hook that forwards subagent responses to orchestrator's session
4. Config changes: `allowBots=true`, channel-to-agent mappings, mention patterns

**Estimated effort:** 12-24h

**Key decisions for CTO during implementation:**
- How does orchestrator trigger the relay bot? (API call from `before_tool_call` hook? File-based queue? Direct Discord API call from a custom tool?)
- Response framing format: what structured metadata accompanies forwarded responses to orchestrator? (See 3.5)
- Correlation ID scheme and file-based batch state design for multi-subagent dispatches (see 3.6)
- Failure notification mechanism when relay bot is down (see section 7, failure handling)

**Prerequisites (non-negotiable before go-live):**
- `before_tool_call` hook blocking `sessions_spawn` for channel-bound agents, with redirect to relay tool in error message (see section 7, orchestrator dispatch flow)

**Validation criteria:**
- [x] orchestrator composes prompt → appears in subagent channel (via relay bot) — **VERIFIED LIVE**
- [x] subagent responds in channel → orchestrator receives response (via hook) — **VERIFIED LIVE** (tool results + assistant text via `agent_end`). Caveat: >2000 char payloads fail.
- [ ] subagent remembers the work in subsequent direct conversations — **NOT TESTED**
- [x] President can see both prompt and response in subagent channel — **VERIFIED LIVE**
- [x] No loops or cascading responses — **VERIFIED LIVE** (echo prevention via relay bot user ID filter + envelope guards)
- [ ] Multi-subagent dispatch works (orchestrator sends to 2+ subagents, receives all responses, synthesizes) — **OUT OF SCOPE for v1** (Milestone 4)

### Track B: Plugin Package (Follow-Up)

**Goal:** Make the relay bot distributable via ClawHub.

**What changes from Track A:**
- Move relay bot process from standalone systemd service into plugin's `registerService({ start, stop })`
- Move hardcoded config (bot token, channel mappings) into plugin config schema in `openclaw.json`
- Add setup documentation and optional CLI helper for bot token provisioning
- Package as skill+plugin for ClawHub

**Estimated additional effort:** 4-8h on top of Track A

**Why this is post-hoc, not parallel:** The core logic is identical. Track B is packaging — it changes lifecycle management and config surface, not the relay bot's behavior. Building Track A first lets us validate the architecture before investing in distribution packaging.

### Track C: Community Contribution (Optional Follow-Up)

**Goal:** Upstream influence + personal visibility.

**Options (not mutually exclusive):**
1. **ClawHub publish** — distribute the relay bot plugin for other multi-agent Discord users
2. **Showcase submission** — post to Discord #showcase or tag @openclaw on X with architecture writeup
3. **Blog post** — long-form writeup of the multi-agent transparency problem and the relay bot solution (following Adam91holt's Ghost blog model)
4. **GitHub repo** — open-source the plugin with architecture documentation
5. **Core PR** — propose `chat.append` API upstream (enables native solution without relay bot). Higher impact but higher risk (4,554 open PRs, many languish). Best submitted AFTER the relay bot proves the concept — then the PR has a working reference implementation and real usage data behind it.

**Community visibility playbook (observed from power users):**
- Build useful artifact → share on X/Discord/GitHub → get featured on showcase → attract followers/collabs
- Adam91holt model: Ghost blog (thought leadership) + GitHub repos (technical companion) + productized infra repo
- Dan Malone model: detailed blog post on multi-agent Telegram architecture
- Official mechanism: "Post in Discord #showcase or tag @openclaw on X" → standout projects added to showcase page

**Estimated effort for community track:**
- ClawHub publish: included in Track B
- Showcase + blog: 4-8h writing
- Core PR (`chat.append`): 20-80h + uncertain review timeline. Plugin-first is lower risk.

---

## 7. Open Design Questions

These need answers during Track A implementation:

- [x] **orchestrator→relay bot communication mechanism.** ~~How does orchestrator tell the relay bot "post this message to #it mentioning CTO"?~~ **RESOLVED: Option (a).** Plugin registers `relay_dispatch` tool via `api.registerTool()`. Orchestrator calls it directly. Requires `tools.alsoAllow: ["relay_dispatch"]` in per-agent config.
- [ ] **Correlation for parallel dispatches.** Preferred: scripted batching in the plugin (correlation ID per dispatch, plugin tracks expected vs received, triggers orchestrator when batch complete). Design questions: where to store batch state (in-memory map vs file)? How does orchestrator declare batch size at dispatch time? How to handle timeouts (one subagent never responds)?
- [ ] **Failure handling when relay bot is down.** Preferred approach: fail loudly and notify the president rather than silently falling back to `sessions_spawn`. Silent fallback reintroduces the transparency and amnesia problems the relay bot exists to solve, without the president knowing the system has degraded. The preference is to be notified of failures so they can be fixed, not to silently drive on a spare tire. Design question for Track A: what does "fail loudly" look like? (Plugin logs an error + orchestrator tells the president the relay is down? Discord webhook to a monitoring channel?)
- [x] **Channel mapping configuration.** **RESOLVED:** JSON env var `CLAWSUITE_RELAY_CHANNEL_MAP_JSON` (e.g., `{"systems-eng":"1474868861525557308"}`). Set via systemd drop-in.
- [ ] **Response batching for long messages.** If subagent response is split across multiple Discord messages, should the hook buffer and combine? Or pass each part individually?
- [x] **orchestrator's dispatch flow change (resolved — Track A prerequisite).** Today orchestrator calls `sessions_spawn`. With relay bot, orchestrator needs to: (1) compose prompt, (2) call relay bot tool/API, (3) NOT call `sessions_spawn`. A `before_tool_call` hook blocking `sessions_spawn` for channel-bound agents is **non-optional** — without it, orchestrator will drift back to the familiar tool. Critically, the hook's error message must **redirect orchestrator to the correct procedure** (e.g., "Use the relay_dispatch tool instead of sessions_spawn for channel-bound agents. See [reference doc]."), not just block. An LLM that hits a blocked tool without guidance on the alternative will often report failure or attempt a creative workaround (e.g., trying to call the Discord API directly via exec) rather than consulting its reference docs for the correct approach. The hook block + redirect is a Track A prerequisite.
- [ ] **Relay bot identity in channel.** The relay bot's Discord username should clearly identify it as a orchestrator relay — e.g., "orchestrator-Relay" — not the president's handle (which would be confusing) and not simply "orchestrator" (which could be mistaken for the orchestrator agent speaking directly in the subagent's channel). Messages may optionally carry a prefix (e.g., "From orchestrator:") for additional clarity. The subagent's soul.md should document the relay architecture so the subagent understands that messages from this bot represent orchestrator-dispatched prompts. Resolution direction: name the bot "orchestrator-Relay" (or similar), document in subagent soul.md, decide on message prefix during Track A.
- [x] **Which agents get relay bot routing?** **RESOLVED for v1:** CTO-only (`V1_TARGET_AGENT = "systems-eng"`). Expansion deferred to Milestone 4.
- [ ] **What the subagent sees as the sender identity.** The subagent's session will show the relay bot as the message author (not the president, not orchestrator). The subagent needs to understand that relay bot messages = orchestrator-dispatched prompts and should be treated with the same weight as a direct question from the president. This requires: (a) relay bot named clearly (e.g., "orchestrator-Relay"), (b) subagent SOUL.md updated to document the relay architecture, (c) potentially a brief header in relay messages ("orchestrator asks:" or similar) so the subagent can distinguish relay prompts from any other relay bot usage in the future. Without this, the subagent may treat relay bot messages differently from president messages — e.g., giving less thorough responses or deprioritizing them.
- [ ] **How orchestrator triggers the relay vs today's `sessions_spawn`.** Today orchestrator has muscle memory for `sessions_spawn`. The `before_tool_call` hook blocking `sessions_spawn` (see above) handles prevention, but orchestrator also needs a **positive path**: a new tool or procedure that is as easy to invoke as `sessions_spawn` was. If the replacement is harder to use, orchestrator will waste tokens trying workarounds. The custom tool registered by the plugin (option (a) in the orchestrator→relay bot question above) should mirror `sessions_spawn`'s interface as closely as possible: `relay_dispatch(agentId, task, correlationId?)`.
- [ ] **Timeout handling for subagent non-response.** If orchestrator dispatches to CTO and CTO never responds (crashed, busy, stuck), the batch never completes and orchestrator never synthesizes. The plugin needs a configurable timeout per dispatch (e.g., 10 minutes). On timeout: notify orchestrator that subagent X did not respond within the window. orchestrator can then decide whether to retry, fall back to `sessions_spawn`, or report the gap to the president.

---

## 8. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Bot loops from misconfigured mention gating | subagent responds to own relay, infinite loop | `requireMention=true` + relay bot only posts with subagent mention + subagent self-filter prevents own messages triggering |
| Relay bot downtime | orchestrator can't delegate transparently | Fail loudly: notify president that relay is down. Do not silently fall back to `sessions_spawn` — silent degradation reintroduces the transparency and amnesia problems without the president knowing. |
| `allowBots=true` lets unwanted bots trigger agents | Noise, unexpected agent turns | Combine with user/role allowlists to restrict which bots are accepted |
| Discord rate limits on relay bot | Throttled posting during heavy orchestration | Discord bot rate limits are generous for text messages; unlikely to hit in practice |
| Plugin hook fails silently | orchestrator never receives subagent response | Timeout mechanism: if no response within N minutes, orchestrator checks subagent channel directly via `sessions_history` |
| Context bloat in subagent sessions | Long sessions from accumulated relay work | Normal compaction handles this (same as human-direct conversation). The current approach already burns tokens through re-prompting and context loss from transient sessions. Main-session accumulation is a net improvement — paying once for persistent context vs repeatedly re-establishing it. |
| Relay bot token compromise | Attacker injects arbitrary user-role messages into subagent sessions | This is a **new** attack surface introduced by the relay bot. Today `allowBots=false` by default and no external bot has a path into agent sessions. The relay bot + `allowBots=true` creates that path. Mitigation: secure token storage, restrict the relay bot's Discord permissions to only the required subagent channels, combine `allowBots=true` with user/role allowlists. The surface is narrow (requires both the token and channel ID knowledge) but it is a genuinely new opening, not a restatement of existing OpenClaw risks. |
| Gateway restart during in-flight dispatch | Plugin batch state lost, subagent responses orphaned | Use file-based batch state (see 3.6), not in-memory. File state survives restart and can be recovered on plugin re-initialization. |

---

## 9. Success Criteria

The relay bot is successful when:

1. **Transparency:** President can read any subagent channel and see the full prompt+response for orchestrated work
2. **Continuity:** subagents remember orchestrated work in subsequent direct conversations
3. **Integration:** orchestrator produces integrated responses from multiple subagents visible in #general
4. **No overhead:** The relay mechanism is invisible to the president — the experience is just "I ask orchestrator, things happen in channels, I get an answer"
5. **Reliability:** The mechanism works consistently without manual intervention
6. **Failure visibility:** If the relay bot is down, the system fails loudly and notifies the president rather than silently degrading to `sessions_spawn`

---

## Appendix A — Alignment Assumptions (Explicit)

These are value decisions, not purely technical defaults. They should remain visible so collaborators can detect misalignment early.

1. **Transparency over silent fallback**
   - If relay fails, fail loudly and notify the president/operator.
   - Do not silently fall back to opaque delegation modes.

2. **Session continuity is a product goal**
   - subagent memory in main sessions matters as much as one-off task completion.

3. **orchestrator is a framing/intelligence layer**
   - orchestrator reformulates prompts for subagents; it is not a passthrough transport.

4. **Auditability is required**
   - The president can inspect subagent-channel prompt/response directly.

5. **Deterministic orchestration beats LLM checklist discipline**
   - Correlation, batching, and completion conditions should be implemented in code where possible.

6. **Single canonical path**
   - Avoid hidden backup paths that change behavior without explicit operator awareness.

7. **Operational legibility**
   - Prefer explicit state, logs, and rollback controls over clever but opaque automation.

## 10. Relationship to Other Initiatives

%%Previously referenced hook-enforcement-v2.md, structural-considerations.md, and multi-agent-interaction-patterns.md. These were reorganized on 2026-02-27 into the documents listed below. Originals archived in workspace/archive/ and Notes/ceo/archive-multi-agent-interaction-patterns.md.%%

### Related documents

- **Agent Governance Vision** (`/home/dave/.openclaw/workspace/published/agent-governance-vision.md`) — The *why*: root cause analysis (T1-T5), 8 structural problems, solution hierarchy, decision tree concept, use cases. Relay bot directly addresses Problem 5 (subagent state loss) and partially addresses Problem 1 (delegation quality — visible prompts create accountability).

- **Hook Implementation Spec** (`/home/dave/.openclaw/workspace-it/published/hook-implementation-spec.md`) — The *how*: hook surface, tag system, output gate, rollout phases. Complementary to the relay bot — hooks govern orchestrator quality (what it delegates, how it frames prompts, whether it verifies output); relay bot governs delivery mechanics (where work happens, who sees it, how results flow back). Build independently.

- **Multi-Agent Research** (`/home/dave/Documents/Notes/ceo/multi-agent-research.md`) — CTO research on community patterns, context access mechanisms, pre-dispatch workflow, subagent visibility gap. Parts 2-3 document the `sessions_history` and `before_prompt_build` mechanisms that orchestrator should use for pre-dispatch context gathering — which the relay bot enhances because delegated work now lives in the subagent's main session (persistent, queryable history of prior orchestrator→subagent interactions).

- **Session Performance Variables** (`/home/dave/Documents/Notes/ceo/session-performance-variables.md`) — 44 variables affecting LLM agent performance. Tangentially relevant: context window management, compaction behavior, and session lifecycle variables inform relay bot design decisions around context accumulation in subagent sessions.

### How this plan relates to the broader initiative

The relay bot is **one plank** in a larger governance architecture. It solves the delivery/transparency problem. It does not solve:
- orchestrator prompt quality → hook spec (tag system, delegation template enforcement)
- Output verification → hook spec (two-phase commit output gate)
- Multi-step project management → vision doc (decision trees, PM use case)
- Pre-dispatch context gathering → hook spec (`before_prompt_build` injection) + multi-agent research (workflow)

The relay bot makes pre-dispatch context gathering more valuable (subagent channels now contain real history), makes orchestrator prompts auditable (president can read them in subagent channels), and solves subagent amnesia (main session persistence). But it doesn't make orchestrator delegate well or verify output — that's the hook architecture's job.
