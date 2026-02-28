# Layer Disambiguation — OpenClaw Subagent Output Surfaces

**Date:** 2026-02-28
**Author:** Claude Code (Opus 4.6)
**Purpose:** Disambiguate the information layers available when a subagent completes, and clarify the relay's target.

---

## Takeaway: The relay should deliver the last assistant message

Under default `sessions_spawn` usage, the parent agent (CEO) formulates its initial response from the **completion announce**, which delivers the subagent's **last assistant message text** as its `Result:` field. OpenClaw deliberately limits the announce to the final message — not the full run's intermediate reasoning — because the orchestrator's context budget is a finite resource. An orchestrator managing multiple subagents cannot afford to absorb every intermediate thought from each one; it needs concise results it can synthesize across.

To replicate the normal information flow via the relay, the correct target is the **last assistant message text** — matching what the completion announce delivers (Surface 2). The `llm_output` plugin hook provides access to this as the last entry in `event.assistantTexts`.

**As a terminal solution, do not forward the full `assistantTexts` array.** While it contains all model-produced text across every turn, forwarding it all would flood the orchestrator's context with intermediate reasoning, tool-call preambles, and step-by-step narration that OpenClaw's native pipeline deliberately discards. This would degrade the orchestrator's ability to synthesize across multiple subagent results.

**As a terminal solution, do not target `sessions_history`.** The CEO can call `sessions_history` on-demand when it needs deeper context for a specific subagent. The relay should not pre-emptively deliver the full transcript.

**As a terminal solution, do not target channel-visible text.** That text has been processed through the channel delivery pipeline (chunking, directive extraction, prefix handling) and may not match the raw assistant text.

---

## Four distinct data surfaces

OpenClaw exposes subagent output through four distinct surfaces, each with different scope and content. The relay-bot-plan's three-layer model maps onto these, but the boundaries are sharper than initially described.

### Surface 1 — `assistantTexts` (all model-produced text)

**What it is:** A `string[]` accumulated live during the agent run. One entry per assistant turn, or per block chunk if block-chunking is active.

**Content:** Every text block the model produced, in order. For a multi-step run (reason > tool_use > reason > tool_use > answer), this contains entries for intermediate assistant text AND the final answer. Tool results are NOT included — only what the model itself wrote.

**How it's populated:** `pushAssistantText(text)` (pi-embedded, line 77531) and `emitBlockChunk` (line 77725). Dedup guard prevents consecutive identical entries. `finalizeAssistantTexts` (line 77537) consolidates reasoning-mode entries.

**Who uses it:**
- **Channel delivery:** `buildEmbeddedRunPayloads` (line 79504) iterates ALL entries and produces one Discord reply payload per entry. This is what appears in the subagent's channel.
- **`llm_output` plugin hook:** Receives the same array as `event.assistantTexts`. Fires after the run completes, after `agent_end`.

**Relay access:** `api.on("llm_output", handler)` — data arrives pre-extracted as `string[]`.

### Surface 2 — Completion announce (last assistant text only)

**What it is:** The automatic notification the parent agent receives when a subagent finishes.

**Content:** Only the text of the LAST assistant message in the session transcript. Extracted by `readLatestSubagentOutput` > `readLatestAssistantReply` > `chat.history` RPC > backward walk for last `role: "assistant"` message.

**Delivered as two messages:**
- **User-visible announce** (posted to channel): `"[status emoji] Subagent <name> completed this task\n\n<findings>"`
- **Parent agent trigger** (injected as `role: "user"`): `"[System Message] ... Result:\n<findings>\n\n<statsLine>\n\n<replyInstruction>"`

**Metadata included:** `sessionKey`, `sessionId`, transcript file path, runtime, token counts — enabling the parent to call `sessions_history` on-demand.

**Key difference from Surface 1:** For multi-step runs, Surface 2 contains ONLY the final answer. Surface 1 contains all turns.

**This is what drives the parent agent's initial response** in normal `sessions_spawn` workflows.

### Surface 3 — `sessions_history` (filtered transcript, on-demand)

**What it is:** A tool the parent agent can call explicitly, using the `childSessionKey` from the `sessions_spawn` return or the completion announce.

**Content (default, `includeTools: false`):** All messages except `role: "toolResult"` and `role: "tool"`. Retains user messages, assistant messages (including embedded `tool_use` blocks), system messages. Text truncated at 4000 chars/block, images stripped, total capped at 80KB.

**Content (`includeTools: true`):** All messages including tool results. Same truncation limits.

**Filtering chain:**
1. Gateway `chat.history` RPC returns raw messages (12,000 char/block truncation)
2. `sessions_history` tool applies `stripToolMessages` unless `includeTools: true`
3. `sanitizeHistoryMessage` strips metadata (`details`, `usage`, `cost`, `thinkingSignature`, image base64)
4. `capArrayByJsonBytes` trims from front to stay under 80KB

**Who uses it:** The parent agent, on-demand. The CEO calls this when it needs more than the completion announce provides — e.g., to see tool outputs, intermediate reasoning, or the full task execution trace.

### Surface 4 — Raw JSONL (file on disk)

**What it is:** The complete, unfiltered session transcript persisted at `~/.openclaw/agents/<scope>/sessions/<sessionId>.jsonl`.

**Content:** Every message exactly as stored — assistant text, thinking blocks with signatures, tool calls, tool results, system messages, usage/cost data, full image base64. No truncation, no filtering.

**Available to:** Direct filesystem access only. Not exposed through plugin hooks or agent tools without explicit file reading.

---

## How the CEO normally processes subagent output

Traced from source code and confirmed by live probe:

1. **CEO calls `sessions_spawn`** — receives `childSessionKey` + `runId` immediately (non-blocking)
2. **Subagent runs asynchronously** — CEO continues other work
3. **Completion announce fires** — CEO receives the trigger message containing `Result: <last assistant text>` + metadata (Surface 2)
4. **CEO formulates its initial response** from the announce's `Result:` field
5. **Optionally, CEO calls `sessions_history(childSessionKey)`** for deeper context (Surface 3) — but only when needed, not automatically

The "richer content" the CEO produces compared to what the subagent posted in its Discord channel comes from step 5 when it occurs. The completion announce alone provides only the subagent's final answer text. The CEO's synthesis quality improves when it accesses the full transcript, but the default information flow is driven by the announce.

---

## Mapping to the relay-bot-plan three-layer model

The plan (section 1.3) defines:
- **Layer 1:** Raw JSONL — everything
- **Layer 2:** Assistant text — what the agent "says"
- **Layer 3:** Orchestrator synthesis — CEO's integrated response

The source code reveals that "Layer 2" spans two distinct surfaces:

| Plan layer | Actual surface(s) | What it contains |
|---|---|---|
| Layer 1 | Surface 4 (JSONL) or Surface 3 (`sessions_history` + `includeTools: true`) | Complete transcript |
| Layer 2 | Surface 1 (`assistantTexts`) — all turns | All model-produced text across the run |
| Layer 2 | Surface 2 (completion announce) — last turn only | Final assistant message text |
| Layer 3 | CEO's output after working from Surfaces 2 and/or 3 | CEO's digest for the human |

For simple one-shot tasks (subagent produces a single answer), Surfaces 1 and 2 are identical. For multi-step tasks, Surface 1 contains more — but that additional content is intermediate reasoning that the orchestrator should not receive.

**Why OpenClaw limits to the last message:** The completion announce is designed for an orchestrator that manages multiple subagents concurrently. Each subagent may take many internal steps (reasoning, tool calls, more reasoning) before producing a final answer. If the orchestrator received every intermediate turn from every subagent, its context would fill with step-by-step narration instead of actionable results. The last-message-only design keeps the orchestrator's context clean and focused on outcomes.

The plan's section 3.5 stated the relay should deliver content "richer than the short summaries printed to Discord." Section 3.8 showed relay richness as "Equivalent" to `sessions_spawn`. Surface 2 (last assistant message, matching the completion announce) satisfies both: it delivers the subagent's actual assistant text rather than a post-processed channel summary, and it matches what `sessions_spawn` natively provides to the orchestrator.

---

## Verification test: orchestrator must "betray" knowledge in its reply

### The missing vehicle problem

The relay's outbound path (orchestrator → subagent) uses Discord: the relay bot posts the orchestrator's prompt to the subagent's channel. In this direction, the content should not substantively differ from what the internal system would deliver — the prompt is the prompt. Discord's character caps are a theoretical concern but not a practical one at current usage.

The return path (subagent → orchestrator) is where the problem lies. In normal `sessions_spawn`, the subagent's assistant text is delivered to the orchestrator via OpenClaw's internal messaging system — the completion announce injects a `role: "user"` message directly into the orchestrator's session containing the subagent's last assistant message. This is richer than what appears in any Discord channel.

With the relay, the subagent responds in its own Discord channel. The relay plugin intercepts this and posts a forwarded copy to the orchestrator's channel (#general). This mirroring is an artifact of the current implementation — it was not designed as the delivery mechanism for the orchestrator and adds noise to #general. But as it stands, it is the only thing triggering the orchestrator's turn. The orchestrator receives it as a Discord message — no richer than what any human would see — and there is no internal delivery of assistant text alongside it.

**As of the current implementation, there is no vehicle for assistant text to reach the orchestrator.** The relay envelope posted to #general triggers the orchestrator's turn, but it carries only channel-visible content plus relay metadata. The orchestrator's response can only reflect what was in that Discord message — nothing more.

### The echo and the conceptual two-path model

Earlier testing with the echo present appeared to show richer content reaching the orchestrator (e.g., tool result `montblanc` alongside channel text `Checked.`). Whether this was a true positive (assistant text actually delivered) or a false positive (tool result leakage from `agent_end` extracting the wrong content blocks) is unresolved.

However, the conceptual model this suggests may be sound independent of whether our prior data confirmed it: the subagent's turn should produce two effects — (a) posting its response in its own channel (visible to the president directly; the current mirror to #general is an implementation artifact, not part of this design), and (b) delivering the assistant text payload to the orchestrator through a separate, internal path, enabling the orchestrator to respond with richer context than what appears in the channel.

The current implementation is missing (b) entirely and relies on the (a) mirror artifact as a substitute. When troubleshooting the echo, we may have eliminated (b) — conflating the assistant text delivery with the channel output mirror because both manifested as Discord messages in #general.

### The transport question

If assistant text must reach the orchestrator through a richer channel than a Discord message, the relay plugin needs a second transport mechanism for the return path. One candidate: `sessions_send`, which injects content directly into the orchestrator's session via OpenClaw's internal messaging — the same mechanism that `sessions_spawn`'s completion announce uses. This would bypass Discord entirely for the (b) path.

Under this model:
- **(a) Channel mirror** — currently, the relay bot posts the subagent's channel output to #general. This is an artifact of the current implementation, not a design goal. It adds noise to the orchestrator's channel and has no value for the orchestrator (which needs assistant text, not a copy of what's already visible in the subagent's channel). Suppressing or eliminating it is desirable but can be deprioritized relative to solving (b).
- **(b) Internal delivery** — relay plugin calls `sessions_send` to inject the assistant text into the orchestrator's session (invisible in Discord, carries richer content). This is the missing piece.

This is a possible technical lead, not a confirmed solution. Two open questions must be resolved before committing to it:

**Plugin access to `sessions_send`.** Plugins interact with OpenClaw via `api.on()` (hooks) and `api.registerTool()` (tools). It is not yet confirmed whether a plugin can call gateway RPCs like `sessions_send` directly. The plugin runs inside the gateway process, so the internal API may be reachable — but this needs verification in the source. If plugins cannot call `sessions_send`, alternatives include: registering a tool that the orchestrator calls to pull the content, or finding another internal injection API the plugin can access.

**Message framing.** Raw assistant text injected into the orchestrator's session is necessary but not sufficient. In normal `sessions_spawn`, the completion announce's trigger message is structured:

```
[System Message] [sessionId: <id>] A subagent "<taskLabel>" just completed successfully.

Result:
<last assistant message text>

runtime: Xs, tokens: N (in: X, out: Y)
sessionKey: <key>
sessionId: <id>
transcript: <path>

<replyInstruction>
```

This framing gives the orchestrator: (1) the subagent's output, (2) metadata to call `sessions_history` on-demand for deeper context, (3) stats for operational awareness, and (4) a reply instruction. Without this framing, the orchestrator receives the text but lacks the context to know what dispatch it corresponds to and has no `sessionKey` for follow-up queries. The relay already tracks dispatch metadata (`dispatchId`, `agentId`); the `sessions_send` payload should include it in a format the orchestrator can act on.

### Test design

The orchestrator cannot be asked as a follow-up whether it saw reasoning — because at that point it could call `sessions_history` to retrieve the full transcript after the fact, contaminating the test. The verification must come from the orchestrator's **immediate response** to the relay delivery.

**Design:** Dispatch a task where the subagent must reason to produce a short answer. The orchestrator's response is then examined for evidence of what it received.

**Critical diagnostic distinction:**
- If the orchestrator's response **includes** details from the subagent's reasoning → it **definitely received** more than channel output. This is a **positive signal** — conclusive.
- If the orchestrator's response **does not include** reasoning details → this is **inconclusive**. The orchestrator may have received richer content and chosen not to surface it. Absence of evidence is not evidence of absence.

This asymmetry matters: the test can **confirm** receipt of assistant text but cannot **rule it out**. A negative result requires further investigation, not a conclusion.

**Example (asymmetric — original formulation):**
1. Relay to CTO: "List the first 5 Fibonacci numbers greater than 100, but reply with only how many of them are odd."
2. CTO reasons: 144, 233, 377, 610, 987 → identifies 233, 377, 987 as odd → outputs `3`
3. Orchestrator response includes "233, 377, 987" → **conclusive: received assistant text**
4. Orchestrator response is only "3" → **inconclusive: may or may not have received assistant text**

**Closing the asymmetry:** The prompt to the orchestrator must force it to either surface reasoning or admit it cannot. Instead of simply relaying the task, the president instructs the orchestrator: "Dispatch CTO to report how many Fibonacci numbers greater than 100 are odd, and explain to me how CTO arrived at the answer."

This changes the orchestrator's obligation. It should now explain CTO's reasoning process, not just echo the result. If it received assistant text containing the reasoning, it can comply. If it received only the channel output (`3`), it should admit it doesn't know how CTO arrived at the answer — which is itself a conclusive signal.

**Example (symmetric — improved formulation):**
1. President to orchestrator: "Dispatch CTO to report how many Fibonacci numbers greater than 100 are odd, and explain to me how CTO arrived at the answer."
2. CTO reasons internally, outputs `3` to channel
3. Orchestrator explains "CTO enumerated 144, 233, 377, 610, 987 and identified the odd ones" → **conclusive: received assistant text**
4. Orchestrator says "CTO reported 3, but I don't have visibility into the reasoning" → **conclusive: received only channel output**

## Relay implementation: recommended approach

**Target:** Last assistant message text (Surface 2 equivalent) via `llm_output` hook.

**Rationale:**
- Matches what the completion announce delivers to the orchestrator in normal `sessions_spawn` workflows
- Pre-extracted — no message parsing, no content block filtering, no role detection
- Fires for embedded agent sessions (confirmed in `pi-embedded-NV2C9XdE.js`)
- Sidesteps every extraction problem that plagued `agent_end` and `before_message_write` approaches
- Keeps the orchestrator's context clean — only the final answer, not intermediate reasoning

**Implementation sketch:**
```typescript
api.on("llm_output", async (event, ctx) => {
    const agentId = ctx?.agentId;
    if (!agentId) return;

    const armed = await getArmedDispatch(agentId);
    if (!armed) return;

    const texts = event.assistantTexts;
    if (!texts?.length) return;

    // Take only the LAST entry — matches completion announce behavior
    const content = texts[texts.length - 1];
    if (!content?.trim()) return;

    await forwardToOrchestrator(armed.dispatchId, agentId, content);
    await disarmDispatch(agentId);
});
```

**Why last entry only:** `readLatestSubagentOutput` (the native completion announce path) walks `chat.history` backward and returns the single last assistant message. Taking `assistantTexts[assistantTexts.length - 1]` replicates this behavior. The orchestrator can always call `sessions_history` itself if it needs deeper context for a specific subagent.

**Firing order note:** `agent_end` fires FIRST, then `llm_output` fires SECOND (lines 79308-79355). If the relay needs both hooks, `llm_output` arrives after `agent_end` has already processed.

---

## Evidence base

### Verified working state (2026-02-27, 09:10 CET)

Assistant text was confirmed working at dispatch `a78db81a`. CEO designed a discriminating test: CTO ran `uptime -p` silently, then output only a check mark. CEO received only the check mark — clean assistant text, no tool output leakage, correct dispatch ID, single message. This was Surface 1 content delivered via `before_message_write` at commit `a9606d9`.

### CEO probe transcript (2026-02-27, late session)

CEO spawned a subagent normally (not via relay) with a multi-step task. Observed:
- Completion announce delivered only the final answer ("no") — Surface 2
- CEO called `sessions_history` and received full transcript (thinking, tool calls, tool results) — Surface 3
- Confirmed that "richer content" requires explicit `sessions_history` call

### Source code references

| Function | File | Line | Role |
|---|---|---|---|
| `pushAssistantText` | `pi-embedded-NV2C9XdE.js` | 77531 | Accumulates model text into `assistantTexts` |
| `emitBlockChunk` | `pi-embedded-NV2C9XdE.js` | 77725 | Block-chunked text to `assistantTexts` |
| `finalizeAssistantTexts` | `pi-embedded-NV2C9XdE.js` | 77537 | Reasoning mode consolidation |
| `llm_output` hook firing | `pi-embedded-NV2C9XdE.js` | 79339 | Delivers `assistantTexts` to plugins |
| `buildEmbeddedRunPayloads` | `pi-embedded-NV2C9XdE.js` | 79504 | Channel delivery from `assistantTexts` |
| `readLatestSubagentOutput` | `subagent-registry-C6qDcjAh.js` | 73117 | Completion announce text source |
| `readLatestAssistantReply` | `subagent-registry-C6qDcjAh.js` | 29330 | Last assistant message from history |
| `buildCompletionDeliveryMessage` | `subagent-registry-C6qDcjAh.js` | 72988 | Formats announce message |
| `sessions_history` tool | `subagent-registry-C6qDcjAh.js` | 28992 | Full transcript access with filtering |
| `chat.history` RPC | `gateway-cli-Bs_SXkBW.js` | 10144 | Gateway-level history retrieval |
| `stripToolMessages` | `subagent-registry-C6qDcjAh.js` | 4403 | Filters `toolResult`/`tool` roles |
| `extractTextFromChatContent` | `image-DPjsAyun.js` | 136 | Core text extraction from content blocks |

### Online references

- GitHub Issue #15147: Reply ordering race — confirms `assistantTexts` pipeline and `buildEmbeddedRunPayloads`
- GitHub Issue #13004: Message interception hooks — user capturing agent replies for audit
- OpenClaw v2026.2.15 release: Ships `llm_output` hook with `assistantTexts` payload
- GitHub Discussion #20575: Bridge plugin hook system to internal hooks

---

## Appendix: Community reports confirming the `assistantTexts` pipeline

### A1. GitHub Issue #15147 — Reply ordering race confirms `assistantTexts` pipeline

A bug report about message ordering reveals the exact `assistantTexts` → channel delivery pipeline:

> "After the turn completes, replyItems are constructed from assistantTexts and dispatched as final payloads."

The issue describes `assistantTexts` as the LLM's raw output that gets processed by `buildEmbeddedRunPayloads` into channel messages. The race condition is between message-tool sends and the post-turn `assistantTexts` dispatch — confirming these are two separate paths and `assistantTexts` is the authoritative model output.

Source: https://github.com/openclaw/openclaw/issues/15147

### A2. GitHub Issue #13004 — User captures agent replies for Discord audit logging

User montytorr describes a concrete use case of capturing assistant text and forwarding it:

> "Audit logging: Posting agent replies to Discord channels for visibility"

Also: "Auto task tracking: Automatically creating task entries after agent replies" and "Git synchronization: Triggering commits/pushes after substantive responses." The issue was closed as duplicate of #8807, with message lifecycle hooks subsequently implemented — confirming this pattern works and is supported.

Source: https://github.com/openclaw/openclaw/issues/13004

### A3. OpenClaw v2026.2.15 release — `llm_output` officially ships

The February 16, 2026 release announcement:

> "Extension authors can now observe what goes into and comes out of the model. The new llm_input and llm_output hook payloads expose prompt context and model responses, opening the door to logging, guardrails, and analytics plugins."

This is the official feature announcement — `llm_output` with `assistantTexts` is a shipped, supported API specifically designed for plugins to capture model responses.

Source: https://github.com/openclaw/openclaw/releases/tag/v2026.2.15
