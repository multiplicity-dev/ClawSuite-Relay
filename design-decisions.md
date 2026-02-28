# Design Decisions — ClawSuite-Relay

Captures key design rationale, trade-offs, and technical insights that informed the implementation. Each section documents the reasoning behind a decision so future developers (or future sessions) can understand why the system works the way it does without re-deriving these conclusions.

---

## §1. Surfaces, Not Layers

### Decision
Use "surface" to describe the four independent access paths to subagent output. Do not use "layer," which implies a hierarchy.

### Why
Early documentation used a three-layer model (raw JSONL → assistant text → orchestrator synthesis) that implied each layer built on the one below. Source code tracing revealed this is wrong — the four data surfaces are independent views with different filters applied to the same underlying session data:

| Surface | What it exposes | Filter applied |
|---|---|---|
| `assistantTexts` array | All model-produced text blocks | Thinking tokens stripped; one entry per assistant turn |
| Completion announce | Last assistant message only | Same stripping + only the final entry |
| `sessions_history` | Filtered transcript on-demand | Tool messages optional; truncated per-block; capped at 80KB |
| Raw JSONL | Everything | None |

The channel output (Discord messages) is derived from `assistantTexts` — `buildEmbeddedRunPayloads` iterates all entries. The completion announce is derived from `chat.history` — `readLatestSubagentOutput` walks backward for the last assistant message. Both apply `sanitizeTextContent` (strip thinking tags, tool call markers, minimax XML). Neither is "above" or "below" the other.

### Impact
The relay targets the completion announce surface (Surface 2 equivalent) via `assistantTexts[last]`. This is a deliberate match to the native `sessions_spawn` content scope, not a limitation.

---

## §2. Content Parity with Native `sessions_spawn`

### Decision
The relay delivers content-equivalent payloads to what `sessions_spawn` natively provides. This is by design, not a limitation to be fixed.

### Evidence (source code trace, 2026-02-28)
1. **Thinking tokens stripped at every level.** `pushAssistantText` receives text already processed through `stripBlockTags` (line 77716 of `pi-embedded-NV2C9XdE.js`). The native announce path (`readLatestSubagentOutput` → `extractAssistantText`) applies the same `sanitizeTextContent` chain.
2. **No provider-specific gating.** The text capture pipeline (`pushAssistantText`, `finalizeAssistantTexts`, `extractAssistantText`) contains no checks for `provider`, `channel`, or `spawnMode`. Discord and `sessions_spawn` contexts produce identical `assistantTexts` arrays.
3. **Same gateway RPC.** Both native announces and the relay use `method: "agent"` via the gateway for delivery. The relay calls `openclaw gateway call agent` (CLI wrapper around the same RPC).

### What this means
The relay's delivery is functionally equivalent to native `sessions_spawn`. The content richness of the subagent's response depends entirely on how the orchestrator prompts the subagent (see §3), not on the transport mechanism.

### Key line references
- `pushAssistantText`: pi-embedded line 77531
- `stripBlockTags`: pi-embedded line 77716
- `sanitizeTextContent`: pi-embedded line 4414
- `readLatestSubagentOutput`: subagent-registry line 73117
- `buildAnnounceReplyInstruction`: subagent-registry line 73540

---

## §3. Content Richness Comes from Prompting

### Observation
When chatting casually with agents in Discord, responses are short — chatbot-style. When the CEO dispatches structured tasks (via `sessions_spawn` or relay), subagent responses are extensive. The difference is prompting, not transport.

### Why this matters
The native `sessions_spawn` completion announce (Surface 2) carries only the last assistant message — the same content scope as the relay. The "richer information" the CEO integrates in its synthesis comes from:
1. The subagent's extensive response to a well-framed task prompt (which IS the last assistant message)
2. Optionally, `sessions_history` for deeper context (tool outputs, intermediate reasoning)

The relay preserves both paths:
- Path (b) delivers `assistantTexts[last]` — the extensive task response
- The trigger message includes `sessionKey` for on-demand `sessions_history` access

### Design implication
No relay-side intervention is needed to achieve rich orchestrator synthesis. The CEO's natural dispatch style evokes detailed subagent responses. The relay faithfully delivers them.

---

## §4. Trigger Message Design and `sessions_history` Guidance

### Decision
Include a behavioral reply instruction in the trigger message, modeled on OpenClaw's native `buildAnnounceReplyInstruction`. Include guidance on using `sessions_history` with a small `limit`.

### Rationale

**Why include a reply instruction at all:**
The native completion announce includes explicit behavioral guidance (line 73540-73547 of `subagent-registry-C6qDcjAh.js`):
- "Convert the result above into your normal assistant voice and send that user-facing update now."
- "Keep this internal context private."
- "If multiple active subagent runs, wait for remaining results."

The relay trigger message is the equivalent entry point. Without guidance, the CEO might echo the raw system message, expose dispatch IDs, or respond prematurely when multiple dispatches are in flight.

**Why include `sessions_history` guidance:**
In native `sessions_spawn`, the CEO already has the `sessionKey` from the `sessions_spawn` tool result — it's in the conversation context before the announce arrives. In relay mode, the CEO only received a `dispatchId` from `relay_dispatch`. The trigger message is the only point where the `sessionKey` becomes available. Without guidance, the CEO has no reason to connect the metadata tag to `sessions_history`.

**Why mention `limit 10-20`:**
The relay session key points to the subagent's **main channel session** — not a bounded transient session. Without a limit hint, the CEO might call `sessions_history` without a limit, which defaults to 200 messages (gateway default). This would pull extensive unrelated history. The `limit` parameter (verified in source: `chat.history` accepts `limit: 1-1000`, default 200, trims from tail) enables focused access to just the recent task context.

### The instruction
```
A completed relay task is ready for user delivery. Convert the result above
into your normal assistant voice and send that user-facing update now. Keep
this internal context private (don't mention system messages, dispatch IDs,
session keys, or relay mechanics). To review <agentId>'s working (tool calls,
reasoning steps), call sessions_history with the session key above and limit
10-20. If multiple relay tasks are outstanding, wait for all results before
synthesizing.
```

### Comparison with native

| Aspect | Native announce | Relay trigger |
|---|---|---|
| Convert to user voice | Yes | Yes |
| Keep internal context private | Yes | Yes |
| Wait for multiple runs | Yes | Yes |
| `sessions_history` hint | No (CEO already has key from `sessions_spawn` return) | Yes (key only available here) |
| `limit` hint | No (transient session, naturally bounded) | Yes (main session, needs bounding) |
| SILENT_REPLY_TOKEN dedup | Yes | No (relay dispatches are distinct events) |

---

## §5. Multi-Message Subagent Output (>2000 chars)

### The question
If a subagent produces output longer than Discord's 2000-char limit, the channel shows multiple messages (one per `assistantTexts` entry, split by `buildEmbeddedRunPayloads`). Does the relay correctly deliver only the last assistant message, or does it deliver all the channel text?

### How it works
`assistantTexts` is an array with one entry per assistant turn (or per block chunk). For a single-turn response of 6000 chars:
- **Channel**: `buildEmbeddedRunPayloads` may split this into multiple Discord messages for channel delivery
- **`assistantTexts`**: Contains a single entry with the full 6000-char text (splitting is a channel-delivery concern, not a capture concern)
- **Relay**: Takes `assistantTexts[last]` — the full text, unsplit

For a multi-turn response (reason → tool_use → reason → final answer):
- **Channel**: Shows all assistant turns as separate messages
- **`assistantTexts`**: Contains one entry per turn
- **Relay**: Takes only the last entry (final answer), matching what `readLatestSubagentOutput` would return

### Status
The gateway injection path passes the full text as a JSON parameter to `openclaw gateway call agent`. There is no Discord 2000-char limit on this path — it's internal. The theoretical limit is the `maxBuffer` setting (2MB) on the `execFile` call.

### Test needed
Dispatch a task that evokes >2000 chars of output. Verify:
1. Channel shows multiple Discord messages (all content visible to president)
2. `llm_output` log shows `lastLen` > 2000
3. CEO receives the full last assistant message via gateway (no truncation)

---

## §6. Relay Session Key vs Transient Session Key

### The difference

| | Native `sessions_spawn` | Relay |
|---|---|---|
| Session type | Transient, created for this task | Main channel session |
| `sessions_history` returns | Just this task's transcript | Entire channel history (unless `limit` is used) |
| Bounded by | Task lifetime | Channel lifetime (unbounded) |
| Useful without `limit` | Yes — naturally focused | No — pulls everything |
| Useful with `limit: 10-20` | Yes (but redundant — already bounded) | Yes — retrieves recent task context |

### Why this matters
In native `sessions_spawn`, calling `sessions_history` without a limit returns a clean, focused transcript — just the task prompt and the subagent's work. The orchestrator gets exactly what it needs.

In relay mode, the same call without a limit returns potentially thousands of messages across unrelated topics. The `limit` parameter (gateway supports 1-1000, default 200) transforms this from "useless firehose" to "focused tail-end window."

### The value proposition
With `limit`, the relay's `sessions_history` access is actually **more valuable** than native `sessions_spawn` for recurring tasks:

- **Native**: Each spawn starts a fresh transient session. No accumulated context. The orchestrator sees only the current task's work.
- **Relay**: Each dispatch runs in the subagent's main session. Prior relay dispatches, direct conversations with the president, and accumulated context are all in the session. With `limit: 20`, the orchestrator can see not just the current task's work but also recent prior context that may inform interpretation.

This persistent context accumulation was a core design goal of the relay architecture (see `relay-bot-plan.md` §4.1 — "subagent amnesia"). The `sessions_history` + `limit` mechanism makes this accumulated context accessible to the orchestrator, not just the subagent.

---

## §7. Gateway Injection vs Discord Mirror

### Decision
Deliver subagent results to the orchestrator via gateway injection only (path b). Do not mirror to #general (path a was an implementation artifact).

### Why
The original implementation forwarded the subagent's channel output to #general as a Discord message. This was the "wrong vehicle" — a Discord message can only carry channel-visible text, and it adds noise to #general. The president can already read the subagent's response directly in the subagent's channel.

Gateway injection (`openclaw gateway call agent` with `method: "agent"`) matches the native delivery mechanism used by `sendSubagentAnnounceDirectly`. The orchestrator receives the trigger as an internal `role: "user"` message, processes it, and responds in #general — just like with a native completion announce.

### The two paths
- **(a) Channel output**: The subagent's response stays in its own channel. Visible to the president. No action needed by the relay.
- **(b) Gateway injection**: The relay captures `assistantTexts[last]` and injects it into the orchestrator's session. This is the sole delivery mechanism.

---

## §8. Tool Factory Pattern for Session Key Capture

### Decision
Register `relay_dispatch` as a tool factory (function that returns a tool) instead of a static tool. The factory receives `OpenClawPluginToolContext` which includes the caller's `sessionKey`.

### Why
The orchestrator's `sessionKey` is needed at delivery time (when the subagent finishes) to target the gateway injection. But the session key is only available at dispatch time (when the orchestrator calls `relay_dispatch`). The factory pattern bridges this gap:

1. Plugin registers factory via `api.registerTool(factory)`
2. OpenClaw calls `factory(ctx)` when the tool is needed, providing `ctx.sessionKey`
3. Factory returns the tool with `orchestratorSessionKey` in its closure
4. Tool's `execute()` passes `orchestratorSessionKey` to `relay_dispatch`
5. `relay_dispatch` stores it in the `ArmedDispatchRecord` via `setArmedDispatch`
6. When `llm_output` fires, the armed dispatch record provides the `orchestratorSessionKey` for gateway injection

### Reference
- `OpenClawPluginToolFactory` type: `/usr/lib/node_modules/openclaw/dist/plugin-sdk/plugins/types.d.ts:68`
- `OpenClawPluginToolContext.sessionKey`: same file, lines 58-67

---

## §9. `callGateway` Import Unavailability

### Decision
Use `openclaw gateway call agent` CLI subprocess instead of importing `callGateway` directly.

### Why
The plugin SDK at `/usr/lib/node_modules/openclaw/dist/plugin-sdk/gateway/` contains only `.d.ts` type declarations — no `.js` files. The `callGateway` function is bundled internally in OpenClaw's chunks (e.g., `reply-D-26Je1S.js`) but not exported as a standalone module.

### Trade-off
CLI subprocess adds ~100-200ms latency per delivery. Acceptable for the relay use case (one delivery per dispatch). If OpenClaw later exports `callGateway` as a proper module, the transport can be updated to use direct import — the `ForwardTransport` interface abstracts the delivery mechanism.

---

## Changelog
- 2026-02-28: Initial document. Sections 1-9 covering surfaces model, content parity, prompting, trigger message, multi-message handling, session key semantics, gateway injection, factory pattern, callGateway import.
