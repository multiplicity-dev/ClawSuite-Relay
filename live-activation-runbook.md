# ClawSuite-Relay Live Activation Runbook

## Current status (2026-02-27)
- Plugin installed as local link and loaded (`clawsuite-relay`).
- Runtime hook wiring: `message_received` (inbound capture) + `message_sending` (outbound capture + announce suppression).
- `relay_dispatch` tool registered via plugin, visible to agents with `tools.alsoAllow`.
- Separate relay bot created ("ClawSuite-Relay") with distinct Discord identity.
- Systemd drop-in for relay env vars configured with relay bot token.
- `allowBots: true` + relay bot user ID in `openclaw.json` allowlists.
- **Step 1 complete:** gateway restarted, plugin loaded, no transport errors.
- **Step 2 complete:** plugin confirmed loaded in gateway logs.
- **Smoke Test A (dispatch post path):** PASS — orchestrator calls `relay_dispatch`, message posted to subagent channel with dispatch marker. Systems-eng receives and processes the message.
- **Smoke Tests B–D:** BLOCKED — return path does not work (see blocking issue below).

### BLOCKING ISSUE: Return path — systems-eng posts empty-content Discord messages

The capture/forward code is correct and tested. The hook pipeline is confirmed working (gateway source code analysis verified `message_sending` fires for ALL outbound messages including embedded agent responses). The blocking issue is **upstream**: systems-eng (GPT-5.3) produces responses with empty text content.

Full observed timeline (06:27 dispatch):
```
06:27:42.058  dispatch.created
06:27:42.437  relay bot posts to #tech (messageId=1476828121293652080)
06:27:42.595  message_received fires (relay bot's own message bounces back)
06:27:43.470  systems-eng session enqueued on its Discord channel lane
06:27:43.490  systems-eng embedded run starts (gpt-5.3-codex)
06:27:50.552  systems-eng run ends (isError=false, 7s)
06:27:50.902  OpenClaw bot posts to #tech — BUT message content is completely empty
```

**Discord API evidence:** `GET /channels/1474868861525557308/messages?limit=5` (via relay bot token) shows messages posted by the OpenClaw bot at 06:27:50.902 and 06:14:31 with empty `content`, no `embeds`, and no `attachments`. Both correspond to relay dispatch responses. The gateway delivered a message, but there was nothing in it.

**Impact on capture:** The plugin's `message_sending` handler has `if (!content) return` as an early bail guard. Even without this guard, `captureOutboundResponse` would have nothing to forward. The capture/forward code is correct but there is nothing to capture.

**Key question:** Why does systems-eng (GPT-5.3) produce empty response content for relay-dispatched prompts?
1. Does the relay message format (`@mention` + `[relay_dispatch_id:...]` markers) confuse the model into a tool-only or empty response?
2. Is the response text stripped by the OpenClaw delivery pipeline before Discord posting?
3. Does the session context or system prompt cause GPT-5.3 to respond differently to bot-authored messages?

**Next steps to investigate:**
- Check systems-eng's session JSONL for the 06:27 run to see the raw model response
- Try a dispatch with simpler content (no markers, no mention) to isolate the cause
- Add temporary logging in `message_sending` that fires regardless of content to confirm hook execution

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

### Test B: Capture + forward path [BLOCKED]
- Reply in subagent channel to relay message.
- Confirm response is captured and forwarded to orchestrator channel.
- Confirm forwarded content includes dispatch marker(s).
- **Blocked by:** systems-eng posts empty-content Discord messages in response to relay dispatches (see blocking issue above).

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
