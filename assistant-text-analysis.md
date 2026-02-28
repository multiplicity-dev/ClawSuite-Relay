# Assistant Text Extraction — OpenClaw Source Code Reference

**Date:** 2026-02-27
**Author:** Claude Code (Opus 4.6)
**Purpose:** Document how OpenClaw internally extracts assistant text and what hooks/APIs expose it, so the relay plugin's extraction can align with the native approach.

---

## Context

Assistant text was **verified working at 09:10 CET** (dispatch `a78db81a`). CEO designed a discriminating test: CTO ran `uptime -p` silently, then output only ✅. CEO received only ✅ — clean assistant text, no tool output leakage. CEO confirmed: "Clean assistant text, no tool output leakage, correct dispatch ID, single message, no echo." Only remaining issue at that point was echo/duplication on the return leg.

The relay's extraction became inconsistent after subsequent changes (echo fix attempts, code iterations). This document provides the OpenClaw source code reference for realigning the extraction.

---

## Confirmed working state (09:10 CET)

The code running at 09:10 was near commit `a9606d9` (disk-persisted arming, `before_message_write` as capture hook). Key characteristics of the working state:

- `before_message_write` fired for the CTO's assistant message
- `extractAssistantTextFromAgentMessage(event?.message)` extracted the text
- The message contained the assistant's response text (✅), not tool results
- Forward delivered clean assistant text to orchestrator channel
- Echo/duplication was present but core relay was functional

---

## OpenClaw's hook surface for assistant text

### `llm_output` hook — THE native assistant text hook

**Source:** `plugin-sdk/plugins/types.d.ts`, line ~300; runtime: `pi-embedded-NV2C9XdE.js`, line 79339

```typescript
type PluginHookLlmOutputEvent = {
    runId: string;
    sessionId: string;
    provider: string;
    model: string;
    assistantTexts: string[];    // <-- ALL text blocks the model produced during the run
    lastAssistant?: unknown;     // <-- last assistant message object (full structured content)
    usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number };
};

// Context:
type PluginHookAgentContext = {
    agentId?: string;       // e.g. "systems-eng"
    sessionKey?: string;
    sessionId?: string;
    workspaceDir?: string;
    messageProvider?: string;
};
```

**How `assistantTexts` is populated** (traced from source):
- `EmbeddedPiSubscribeState.assistantTexts: string[]` is accumulated during the entire agent run
- Every text block the model produces is pushed via `pushAssistantText(text)` (line 77531)
- Deduplication: skips if text matches the last assistant text (normalized comparison)
- Block reply chunks also push to `assistantTexts` (line 77725)
- When `includeReasoning` is on, reasoning text replaces intermediate entries via `finalizeAssistantTexts` (line 77537)
- Result: `assistantTexts` contains ALL text content the model produced, in order

**Firing order** (lines 79308-79355):
1. `agent_end` fires FIRST — with `messagesSnapshot` (full session transcript)
2. `llm_output` fires SECOND — with `assistantTexts` + `lastAssistant`

**Fires for embedded agent sessions:** YES. The code is inside `pi-embedded-NV2C9XdE.js` which IS the embedded agent runner (what processes the CTO's relay-dispatched turns).

**Observe-only** (returns `void`). Cannot modify or cancel.

**This is the purpose-built API for assistant text.** It provides the raw model output as accumulated `string[]`, not requiring any message parsing or content block filtering. The relay plugin can register `api.on("llm_output", handler)` to capture `event.assistantTexts` directly.

### `agent_end` hook — full session transcript

```typescript
type PluginHookAgentEndEvent = {
    messages: unknown[];   // full session message history
    success: boolean;
    error?: string;
    durationMs?: number;
};
```

Context: `{ agentId?, sessionKey?, sessionId?, workspaceDir?, messageProvider? }`

The `messages` array contains `AgentMessage` objects: user messages, assistant messages (with text content blocks), tool call blocks, tool result messages. Observe-only.

### `before_message_write` hook — individual message before persistence

```typescript
type PluginHookBeforeMessageWriteEvent = {
    message: AgentMessage;    // the message about to be written
    sessionKey?: string;
    agentId?: string;
};

type PluginHookBeforeMessageWriteResult = {
    block?: boolean;          // drop the message
    message?: AgentMessage;   // replace the message
};
```

**Synchronous.** Fires for every message written to the session transcript — user, assistant, tool call, tool result. This was the capture hook in the working 09:10 state.

### `message_sending` hook — outbound channel message

```typescript
Event:  { to: string; content: string; metadata?: Record<string, unknown> }
Result: { content?: string; cancel?: boolean }
Context: { channelId: string; ... }
```

Can modify or cancel. Content is the post-processed channel text (after chunking, prefix, directive extraction).

---

## OpenClaw's native extraction chain (for `sessions_spawn` subagents)

### 1. `readLatestSubagentOutput(sessionKey)`

**Source:** `subagent-registry-C6qDcjAh.js`, line 73117

```javascript
async function readLatestSubagentOutput(sessionKey) {
    // Stage 1: readLatestAssistantReply
    try {
        const latestAssistant = await readLatestAssistantReply({
            sessionKey, limit: 50
        });
        if (latestAssistant?.trim()) return latestAssistant;
    } catch {}

    // Stage 2: fallback — walk history with extractSubagentOutputText
    const history = await callGateway({
        method: "chat.history",
        params: { sessionKey, limit: 50 }
    });
    const messages = Array.isArray(history?.messages) ? history.messages : [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const text = extractSubagentOutputText(messages[i]);
        if (text) return text;
    }
}
```

### 2. `readLatestAssistantReply(params)`

**Source:** line 29330

```javascript
async function readLatestAssistantReply(params) {
    const history = await callGateway({
        method: "chat.history",
        params: { sessionKey: params.sessionKey, limit: params.limit ?? 50 }
    });
    const filtered = stripToolMessages(messages);  // removes toolResult/tool
    for (let i = filtered.length - 1; i >= 0; i -= 1) {
        if (filtered[i].role !== "assistant") continue;
        const text = extractAssistantText(filtered[i]);
        if (text?.trim()) return text;
    }
}
```

Strips tool messages, walks backward, returns last non-empty assistant text.

### 3. `extractAssistantText(message)`

**Source:** line 4418

```javascript
function extractAssistantText(message) {
    if (message.role !== "assistant") return;
    const content = message.content;
    if (!Array.isArray(content)) return;  // array content ONLY
    const joined = extractTextFromChatContent(content, {
        sanitizeText: sanitizeTextContent,
        joinWith: "",
        normalizeText: (text) => text.trim()
    }) ?? "";
    const errorContext = message.stopReason === "error" || ...;
    return joined ? sanitizeUserFacingText(joined, { errorContext }) : undefined;
}
```

Returns `undefined` for string content. Caller has fallback for string content.

### 4. `extractTextFromChatContent(content, opts)`

**Source:** `image-DPjsAyun.js`, line 136 (`src/shared/chat-content.ts`)

```javascript
function extractTextFromChatContent(content, opts) {
    if (typeof content === "string") return normalize(sanitized content);
    if (!Array.isArray(content)) return null;
    const chunks = [];
    for (const block of content) {
        if (block.type !== "text") continue;  // ONLY {type: "text"} blocks
        const text = block.text;
        if (typeof text !== "string") continue;
        const value = opts?.sanitizeText ? opts.sanitizeText(text) : text;
        if (value.trim()) chunks.push(value);
    }
    return normalize(chunks.join(joinWith));
}
```

### 5. `extractSubagentOutputText(message)` (fallback path)

**Source:** line ~8949

```javascript
if (role === "assistant") {
    const assistantText = extractAssistantText(message);
    if (assistantText) return assistantText;
    if (typeof content === "string") return sanitizeTextContent(content);
    if (Array.isArray(content)) return extractInlineTextContent(content);
    return "";
}
if (role === "toolResult" || role === "tool") {
    return extractToolResultText(message.content);
}
```

### 6. `sanitizeTextContent(text)`

**Source:** line 4414

```javascript
function sanitizeTextContent(text) {
    return stripThinkingTagsFromText(
        stripDowngradedToolCallText(
            stripMinimaxToolCallXml(text)
        )
    );
}
```

---

## Relay extraction — gaps vs native approach

| Aspect | OpenClaw native | Relay plugin (current) |
|---|---|---|
| Content source | `chat.history` API | `agent_end.messages` or `before_message_write` event |
| Array content | Filters `{type: "text"}` blocks specifically | Checks `part?.text`, `part?.content`, `asString(part)` — less specific |
| Sanitization | `sanitizeTextContent` (thinking tags, tool markers, minimax XML) | None |
| String vs array | Array-only in `extractAssistantText`; string fallback in caller | Both in single function |

### Alignment actions — RESOLVED (2026-02-28)

All alignment actions below were addressed by switching to `llm_output` hook with `assistantTexts[last]`:

1. ~~**Match `{type: "text"}` filter**~~ — Resolved: `assistantTexts` entries are pre-extracted from `{type: "text"}` blocks by `extractAssistantText` → `extractTextFromChatContent`, which filters for `block.type === "text"` at source.

2. ~~**Consider `llm_output` hook**~~ — Implemented: primary capture path in `openclaw-plugin.ts`.

3. ~~**Apply sanitization**~~ — Resolved: `pushAssistantText` receives text already processed through `stripBlockTags` (thinking tokens) and `sanitizeTextContent` (tool call markers, minimax XML). No additional sanitization needed.

4. ~~**Consider `chat.history` API**~~ — Not needed: `llm_output` provides content-equivalent data to what `readLatestSubagentOutput` extracts from `chat.history`.

---

## GPT-5.3 forensic findings (late afternoon)

GPT-5.3's forensic diagnostics (dispatches `fce2d4aa`, `10ef8576`, `a24822f2`, `6d9a8f45`) found `assistants=1` in every case, with the single assistant segment matching channel text. However, these probes were run with significantly different code from the 09:10 working state (multiple iterations of extraction logic, mode switching, etc.). The code at probe time was NOT the same code that was running when assistant text was confirmed working.

GPT-5.3's regression replay of `a9606d9` showed duplication but no enrichment — however the replay test prompt and conditions may not have matched the original 09:10 test exactly.

**The forensic results do not invalidate the 09:10 evidence.** They indicate the current code state does not reproduce the working behavior, which is expected given the intervening changes.

---

## Recommended investigation path

### Priority 1: Use `llm_output` hook

`llm_output` is OpenClaw's native, purpose-built hook for assistant text. It provides `assistantTexts: string[]` directly — no message parsing, no content block filtering, no guessing about roles or content formats. It fires for embedded agent sessions (confirmed in source).

Implementation:
```typescript
api.on("llm_output", async (event, ctx) => {
    const targetAgentId = ctx?.agentId;  // e.g. "systems-eng"
    if (!targetAgentId || !channelMap[targetAgentId]) return;
    const armedDispatchId = await getArmedDispatchId(targetAgentId);
    if (!armedDispatchId) return;
    const content = event.assistantTexts?.join("\n\n") || "";
    if (!content) return;
    // forward to orchestrator...
});
```

This sidesteps all the extraction problems that plagued `agent_end` (message format parsing, role filtering, turn scoping, array vs string content) because the data arrives pre-extracted.

### Priority 2: Reproduce the 09:10 working state

If `llm_output` is not viable for any reason, reproduce the exact 09:10 conditions:
- Code near commit `a9606d9` with `before_message_write` as capture hook
- Discriminating test: "Run uptime -p locally, but do not output it. Then output exactly one line: if 2+2=4 output ✅, else output ❌."
- The current code already has `before_message_write` re-added (GPT-5.3's regression replay)

### Priority 3: Verify `agent_end` data

GPT-5.3's forensic diagnostics (`summarizeCurrentTurn`) should clarify what's actually in the `agent_end` messages array. If `assistantTexts` from `llm_output` differs from what `agent_end` messages contain, that confirms the data source is the issue, not the extraction logic.

---

## Resolution: content parity confirmed (2026-02-28)

Source code tracing confirmed that `assistantTexts[last]` is content-equivalent to what `sessions_spawn`'s completion announce delivers to the orchestrator. Thinking tokens are stripped at every level (`stripBlockTags`, `sanitizeTextContent`). There is no provider-specific gating — Discord and `sessions_spawn` contexts produce identical content. The relay's `llm_output` → `assistantTexts[last]` → gateway injection path delivers the same payload scope as native `sessions_spawn`. See `layer-disambiguation.md` section "Source code verification: `assistantTexts` content parity" for the full trace.

## Disambiguation: The three information layers (2026-02-28)

The relay-bot-plan.md (section 1.3) defines three layers. This section maps those layers to the actual mechanisms in OpenClaw source code, based on tracing the gateway internals across `pi-embedded-NV2C9XdE.js`, `subagent-registry-C6qDcjAh.js`, and `gateway-cli-Bs_SXkBW.js`.

### What the source code reveals: four distinct data surfaces

There are actually **four** distinct data surfaces that a parent agent or plugin can access, not three. Each has a different scope and different content.

#### Surface 1: `assistantTexts` (via `llm_output` hook or `buildEmbeddedRunPayloads`)

**Scope:** All text blocks the model produced during the entire agent run.

**Content:** One entry per assistant turn (or per block chunk if block-chunking is active). For a multi-step run (think → tool_use → think → tool_use → final answer), this array contains entries for every intermediate assistant text AND the final answer. Tool results are NOT included — only what the model itself wrote.

**Populated by:** `pushAssistantText(text)` (line 77531) and `emitBlockChunk` (line 77725) during the live run. Dedup guard skips if text matches the last entry.

**Channel delivery uses this:** `buildEmbeddedRunPayloads` (line 79504) iterates ALL entries in `assistantTexts` and produces one reply payload per entry. So what appears in the Discord channel is derived from the full `assistantTexts` array, not just the final entry.

**Available to plugins via:** `llm_output` hook → `event.assistantTexts` (the same array, passed by reference).

#### Surface 2: Completion announce (`readLatestSubagentOutput` → `findings`)

**Scope:** Only the text from the LAST assistant message in the session.

**Content:** `readLatestSubagentOutput(sessionKey)` calls `readLatestAssistantReply`, which fetches `chat.history` from the gateway, strips tool messages, walks backward, and returns text from the **single last `role: "assistant"` message**. This is one string — the final answer only.

**Delivered as:**
- **User-visible announce** (channel message): `"✅ Subagent <name> completed this task\n\n<findings>"`
- **Parent agent trigger** (injected as `role: "user"` in parent session): `"[System Message] ... Result:\n<findings>\n\n<statsLine>\n\n<replyInstruction>"`

**The trigger message also includes:** `sessionKey`, `sessionId`, `transcript` path, runtime, token counts. This metadata allows the parent to call `sessions_history` for the full record.

**Key difference from Surface 1:** If the agent produced 3 assistant turns (intermediate reasoning + intermediate reasoning + final answer), the completion announce contains ONLY the final answer. `assistantTexts` contains all 3.

#### Surface 3: `sessions_history` tool (what the parent agent calls on-demand)

**Scope:** The complete session transcript, subject to filtering and truncation.

**Content with `includeTools: false` (default):** All messages EXCEPT `role: "toolResult"` and `role: "tool"`. Keeps: user messages, assistant messages (including embedded `tool_use` content blocks within assistant messages), system messages. Text truncated at 4000 chars per block. Images stripped. Total capped at 80KB.

**Content with `includeTools: true`:** All messages including tool results. Same truncation/cap limits.

**Filtering chain:**
1. Gateway `chat.history` RPC returns raw messages (all roles, text truncated at 12,000 chars per block)
2. `sessions_history` tool applies `stripToolMessages` if `includeTools: false`
3. `sanitizeHistoryMessage` strips `details`, `usage`, `cost`, `thinkingSignature`, image base64
4. `capArrayByJsonBytes` trims from front to stay under 80KB

**Available to:** Any agent that has the `childSessionKey` (provided in the `sessions_spawn` return value and in the completion announce).

#### Surface 4: Raw JSONL transcript (file on disk)

**Scope:** Everything, with no truncation or filtering.

**Content:** Every message exactly as persisted — user, assistant (with full text, thinking blocks, `thinkingSignature`), tool calls, tool results, system messages, usage/cost data, images (full base64).

**Location:** `~/.openclaw/agents/<scope>/sessions/<sessionId>.jsonl` (path provided in completion announce stats).

**Available to:** Direct file read. Not accessible via plugin hooks or tools without filesystem access.

### How the CEO actually works with subagent output

Based on the probe transcript and the source code:

1. CEO calls `sessions_spawn` → receives `childSessionKey` immediately
2. Subagent runs asynchronously → CEO receives completion announce (Surface 2: last assistant text only)
3. CEO calls `sessions_history(childSessionKey)` → receives filtered transcript (Surface 3)
4. CEO synthesizes its response to the human from the `sessions_history` data

The "richer content" the CEO produces compared to what the subagent posted in its channel comes from step 3 — the CEO explicitly calls `sessions_history` and works from the full (filtered) transcript. The completion announce alone (Surface 2) provides only the subagent's final answer text.

### Mapping to the relay-bot-plan three-layer model

| Plan layer | Actual surface | What it contains |
|---|---|---|
| Layer 1: Raw JSONL | Surface 4 (raw JSONL) or Surface 3 (`sessions_history` with `includeTools: true`) | Complete transcript — everything |
| Layer 2: Assistant text | **Ambiguous** — see below | Depends on which surface |
| Layer 3: Orchestrator synthesis | CEO's output after calling `sessions_history` | CEO's digest of the full transcript |

**The ambiguity of "Layer 2"** is the core disambiguation issue:

- If "assistant text" means **`assistantTexts`** (Surface 1): all model-produced text across all turns. This is what `llm_output` provides and what `buildEmbeddedRunPayloads` sends to the channel.
- If "assistant text" means **what the completion announce delivers** (Surface 2): only the last assistant message text. This is what `readLatestSubagentOutput` extracts and what goes into the parent's trigger message as `Result:`.
- These are **not the same thing** for multi-step agent runs.

### What the CEO's probe transcript reveals

In the probe, the CEO spawned a subagent normally (not via relay). The subagent ran `uptime`, extracted characters, and output "no". The CEO observed:

- The completion announce delivered only "no" (the final assistant text) — this is Surface 2
- The CEO then called `sessions_history` and received the full transcript (thinking blocks, tool calls, tool results) — this is Surface 3
- The CEO identified that the "richer content" comes from `sessions_history`, not from the announce itself

This is consistent with the source code: `readLatestSubagentOutput` returns only the last assistant message. The CEO's typical workflow accesses Surface 3 explicitly to get full context.

### Implications for the relay

The relay currently operates at the plugin hook level. Available options:

| Approach | Surface accessed | Content scope | Complexity |
|---|---|---|---|
| `llm_output` hook | Surface 1 (`assistantTexts`) | All assistant turns, no tool results | Low — data arrives pre-extracted |
| `agent_end` hook + message parsing | Subset of Surface 3 | Whatever extraction logic captures | High — fragile parsing |
| `before_message_write` hook | Individual messages (Surface 1, one at a time) | One message per firing | Medium — must reassemble |
| `chat.history` RPC call from plugin | Surface 3 | Full transcript (filtered) | Medium — needs gateway RPC |
| `sessions_history` via tool | Surface 3 | Full transcript (filtered) | N/A — tools are agent-side, not plugin-side |

If the relay's goal is to deliver what the CEO would normally get from `sessions_history` (Surface 3), that requires either:
- Calling `chat.history` gateway RPC from the plugin after the run completes, OR
- Using `agent_end` messages and doing the extraction carefully

If the relay's goal is to deliver what `assistantTexts` contains (Surface 1 — all assistant-produced text, no tool results), `llm_output` is the direct path.

If the relay's goal is to match what the completion announce delivers (Surface 2 — just the final answer), either `llm_output` (take last entry) or `readLatestAssistantReply` logic achieves that.

### Resolution (2026-02-28)

**Target: last assistant message text** (Surface 2 equivalent). OpenClaw deliberately limits the completion announce to the final assistant message because the orchestrator's context is a finite resource — it must synthesize across multiple subagents and cannot afford to absorb intermediate reasoning from each one. The relay should match this behavior, not exceed it.

See `layer-disambiguation.md` for the full analysis and implementation recommendation.
