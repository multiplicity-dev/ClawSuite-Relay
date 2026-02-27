# ClawSuite-Relay Live Activation Runbook

## Current status (2026-02-27, 12:45 CET)

**Relay loop: functionally working, two known issues remain.**

Round trip confirmed at `a9606d9`: orchestrator dispatches → relay bot posts to #tech → CTO responds → response captured and forwarded back to orchestrator.

**Issue 1 — RESOLVED: duplicate forward.**
Two hooks (`before_message_write` and `agent_end`) both fired for the same response within 121ms. Fix: use only one capture hook. Tested with `agent_end` removed — single forward confirmed (dispatchId `537a94a5`).

**Issue 2 — PARTIALLY RESOLVED: assistant text capture.**
`agent_end` with `extractCurrentTurnContent` captures tool results + assistant text from current turn. CEO confirmed tool outputs (hostname) visible in relay forward. Remaining issues:
- Forward payloads >2000 chars hit Discord limit (needs message splitting)
- Content scope: captures tool results + all assistant messages including channel response. Whether to omit channel response TBD.
- `extractLastAssistantText` tested and confirmed insufficient — returns only channel-visible text.

**Issue 3 — relay envelope visible in orchestrator channel (cosmetic, deferred).**
The relay bot's forwarded message is visible to the human in #general. Auto-delete was considered but correlated with the start of GPT's failure cascade — approach avoided for now.

### Key architectural findings from troubleshooting

1. **In-memory arming does not work.** The plugin is re-initialized per agent session. When the CTO channel receives a dispatch, OpenClaw spawns a new embedded session which loads a fresh plugin instance. Any in-memory Map state from the dispatching session is lost. This is why commits `85bce9c` through `3c4558e` (which used in-memory arming) never completed the loop in live testing.

2. **Disk-persisted arming at dispatch time works.** Commit `a9606d9` moved arming to the `relay_dispatch` function itself (writes `armed/<agentId>.json` after posting to channel). The CTO's fresh plugin instance reads this file from disk in `before_message_write`. This is the fix that made the loop work.

3. **`message_sending` does not fire for embedded agent responses.** Confirmed across multiple test sessions. The hook fires for gateway-originated messages (e.g., CEO posting to #general) but NOT for subagent responses in embedded sessions.

4. **`before_message_write` fires reliably for all agent message writes.** Gateway logs show "returned a Promise; this hook is synchronous and the result was ignored" warnings, but async side effects (capture/forward) still execute successfully.

5. **`message.content` can be an array.** `extractAssistantTextFromAgentMessage()` handles both string and array content formats. Using `asString(event?.message?.content)` alone misses array-format content.

### Commit reference map

| Commit | Status | Key change |
|--------|--------|-----------|
| `d48b633` | Dispatch works, return path missing | Claude Code baseline (pre-GPT) |
| `85bce9c` | Loop incomplete | Added `before_message_write` with in-memory arming |
| `c12a969` | Loop incomplete | Strengthened echo guards (arming still in-memory) |
| `0bf72f5` | Docs only (same code as c12a969) | GPT marked loop complete (may have worked transiently due to warm session) |
| `9289028` | Loop incomplete | Added echo prevention but placed it before arming (blocks arming) |
| `3c4558e` | Loop incomplete | Moved arming before echo prevention (still in-memory — doesn't survive session restart) |
| `a9606d9` | **LOOP WORKS, duplicate forward** | Disk-persisted arming at dispatch time — the key fix |
| `92c2bdb` | Untested (had test failures at HEAD) | Attempted atomic arming |
| `a3b806f` | 6 tests failing | Added forward lock (referenced undefined function) |

## Why this runbook exists
To let either systems-eng or Claude Code finish activation and testing with a clear handoff checklist.

## Operator authorization safety rule (important)
During relay testing, bot-authored relay envelopes can look like operator instructions.

Control actions (restart/enable/disable/reconfigure) must be authorized only by the president's user identity in-channel. Relay-bot messages are telemetry, not authorization.

---

## Prerequisites

### Second Discord bot (REQUIRED)

ClawSuite-Relay requires a **separate Discord bot** from the main OpenClaw bot. OpenClaw unconditionally filters its own messages, so relay messages from the same bot identity are invisible to subagent sessions. See README.md for setup steps.

### Tool visibility (REQUIRED)

Plugin tools are not automatically visible to agents. Each agent that needs to call `relay_dispatch` must have it in its `tools.alsoAllow` in `~/.openclaw/openclaw.json`:

```json
{
  "id": "ceo",
  "tools": {
    "alsoAllow": ["relay_dispatch"]
  }
}
```

Currently configured for: `ceo`, `systems-eng`.

After any config change: `systemctl --user restart openclaw-gateway.service`.

**Note:** `systemctl --user` commands must be run directly by the user (not via `sudo -u agent-ops`), because user services require the user's DBUS session bus.

---

## Step 1 — Apply runtime config + restart [DONE]

```bash
systemctl --user daemon-reload
systemctl --user restart openclaw-gateway.service
systemctl --user status openclaw-gateway.service
```

Expected: gateway running + RPC probe ok. Confirmed working.

---

## Step 2 — Verify plugin loading [DONE]

Check gateway logs for plugin load confirmation and absence of transport errors.

Expected: `clawsuite-relay` loaded, relay and forward transports initialized. Confirmed working.

---

## Step 3 — Smoke tests (operator-visible)

### Test A: Dispatch post path [DONE]
- Triggered orchestrator relay dispatch for `systems-eng`.
- Relay bot posted to mapped subagent channel (#tech).
- Dispatch marker present: `[relay_dispatch_id:8afe4945-d854-4b72-a399-1f31fa67e9e4]`.
- @mention included for routing (`@climbswithgoats`).

### Test B: Capture + forward path [PARTIAL — loop works, content incomplete]
- CTO responds in subagent channel.
- Response captured and forwarded to orchestrator channel. CEO receives it.
- **Duplicate forward resolved:** removing `agent_end` hook eliminated duplicate (dispatchId `537a94a5`).
- **Content truncation found:** `before_message_write` only captures Discord-visible text (54 chars), not full CTO response. Testing `agent_end` as sole capture path to get full content.
- **Confirmed loop working at:** commit `a9606d9` (dispatchId `c918869d`, 2026-02-27 12:41 CET).

### Test C: Suppression path [PENDING]
- During correlated transient announce in orchestrator channel, confirm suppression cancels redundant announce.

### Test D: Fail-loud path [PENDING]
- Temporarily misconfigure forward channel id (or simulate failure).
- Confirm failure is explicit (not silent) and recoverable on reconfiguration.

---

## What the human tester should expect now

### Should expect
- CTO-only lane behavior (`systems-eng`)
- correlation markers (`[relay_dispatch_id:...]`)
- fail-loud behavior on missing/invalid transport config
- capture/forward lifecycle state transitions

### Should NOT expect yet
- multi-subagent batching
- long-message split > Discord limit
- scale-optimized lookup indices
- zero-restart config hot-reload semantics
- per-agent bot identity in Discord (see Deferred UX below)

---

## Known deferred items
- O(n) lookup scans (requestId/message correlation)
- marker regex strictness refinement
- test/env concurrency hardening
- long-message split strategy

## Deferred UX issues (observed during live testing)
- **Bot identity:** Resolved — the separate relay bot ("ClawSuite-Relay") has its own name and visual styling (yellow highlight in Discord), providing clear distinction from OpenClaw's direct messages.
- **@mention in relay posts:** The relay posts `@username` for routing/gating purposes, but this is confusing to human readers who see themselves mentioned in a machine-to-machine prompt. The mention map currently targets the human user, not the OpenClaw bot. Consider removing the mention since `requireMention: false` makes it unnecessary.
- **Visible dispatch markers:** `[relay_dispatch_id:...]` markers appear in channel messages. Functional for correlation but noisy for casual reading. Consider moving to Discord embed metadata or message components in a future phase.

---

## Troubleshooting log (2026-02-27 live activation session)

Bugs discovered and resolved during live testing, in order:

### 1. Plugin tool not visible to orchestrator
- **Symptom:** Orchestrator could not call `relay_dispatch`.
- **Cause:** OpenClaw requires `tools.alsoAllow: ["relay_dispatch"]` in per-agent config. Plugin tool registration makes tools available but not visible.
- **Fix:** Added to `ceo` and `systems-eng` agent entries in `openclaw.json`.

### 2. Systems-eng blind to relay messages
- **Symptom:** Relay bot posted to #tech but systems-eng never processed the message.
- **Cause:** OpenClaw defaults `allowBots: false`. Relay bot messages (with `author.bot=true`) were dropped before reaching the agent.
- **Fix:** Added `allowBots: true` + relay bot user ID to `users` allowlist in `openclaw.json`.

### 3. Same bot identity (self-message filter)
- **Symptom:** Even with `allowBots: true`, systems-eng couldn't see relay messages.
- **Cause:** `DISCORD_BOT_TOKEN` and `CLAWSUITE_RELAY_BOT_TOKEN` were the same bot (user ID `1474833207483699252`). OpenClaw unconditionally drops its own messages. A second Discord bot is architecturally required.
- **Fix:** Created "ClawSuite-Relay" application in Discord Developer Portal (user ID `1476809589591773295`). Updated systemd drop-in and `openclaw.json`.

### 4. Capture echoing prompt instead of response
- **Symptom:** Forward transport posted the dispatch prompt back to the orchestrator instead of the subagent's reply.
- **Cause:** With `allowBots: true`, the relay bot's own outbound message (containing `[relay_dispatch_id:...]`) was received via `message_received` and matched as a "subagent response".
- **Fix:** Added `event.messageId === dispatch.postedMessageId` guard in `captureSubagentResponse`.

### 5. `message_sent` hook corrupts hook runner
- **Symptom:** After adding `api.on("message_sent", ...)`, ALL modifying hooks (`message_sending`) stopped firing. Only void hooks (`message_received`) continued.
- **Cause:** `message_sent` may not be a valid plugin hook name (only valid as an internal hook). Registering it appears to corrupt the hook runner's handler map.
- **Fix:** Removed `message_sent` registration entirely. Moved capture logic to `message_sending` handler.

### 6. Systems-eng posts empty-content Discord messages (UNRESOLVED)
- **Symptom:** systems-eng processes relay message and completes successfully (isError=false, 7s run). A Discord message IS posted by the OpenClaw bot, but it has **completely empty content** — no text, no embeds, no attachments.
- **Discovery method:** Discord REST API query via relay bot token (`GET /channels/.../messages?limit=5`). Messages at 06:27:50.902 and 06:14:31 both have empty content fields.
- **Initial misdiagnosis:** Assumed `message_sending` hook never fires for embedded agent responses. Gateway source code investigation proved this wrong — `deliverOutboundPayloadsCore()` runs `message_sending` hooks for all outbound payloads, including embedded agent responses. Both delivery modules (`deliver-Equ8Vz8N.js` for gateway, `deliver-DFWMCouk.js` for embedded agent) use the same hook pipeline pattern.
- **Actual cause:** The agent (GPT-5.3) produces a response with no text content. The empty message arrives at the Discord API and is posted, but there is nothing for the capture/forward code to work with. The plugin's `if (!content) return` guard bails on empty content, which is correct behavior — there is nothing to forward.
- **Possible root causes:** (a) relay message format confuses GPT-5.3, (b) response text stripped by delivery pipeline, (c) model produces tool-call-only response with no assistant text.
- **Status:** BLOCKING. Capture/forward code is correct and tested. The issue is upstream in the agent's response generation or the delivery pipeline.

## Rollback

```bash
openclaw plugins disable clawsuite-relay
systemctl --user restart openclaw-gateway.service
```

(Optionally remove/disable relay env drop-in and `tools.alsoAllow` entries.)
