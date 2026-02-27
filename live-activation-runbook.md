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

### BLOCKING ISSUE: Return path — `message_sending` never fires for subagent responses

The capture/forward code is correct and tested, but it never runs in production because **`message_sending` does not fire when an embedded agent run completes and posts its response to Discord**.

Full observed timeline (06:27 dispatch):
```
06:27:42.058  dispatch.created
06:27:42.437  relay bot posts to #tech (messageId=1476828121293652080)
06:27:42.595  message_received fires (relay bot's own message bounces back)
06:27:43.470  systems-eng session enqueued on its Discord channel lane
06:27:43.490  systems-eng embedded run starts (gpt-5.3-codex)
06:27:50.552  systems-eng run ends (isError=false, 7s)
06:27:50.569  lane cleared — ZERO message_sending events
```

Key question for systems-eng (GPT-5.3): When the embedded agent run for a Discord-channel message completes, what is the response delivery path? Specifically:
1. Does the gateway fire `message_sending` plugin hooks for embedded agent responses, or only for user-initiated outbound messages?
2. Is there a separate response delivery path (e.g., direct Discord API post) that bypasses the plugin hook pipeline?
3. If `message_sending` is the wrong hook, what hook (if any) fires for outbound agent responses?

**Alternative capture strategies to consider if `message_sending` is not viable:**
- Poll the Discord API for new messages in the subagent channel after a dispatch
- Use a Discord bot websocket (gateway) listener on the relay bot to observe the main OpenClaw bot's messages
- Hook at a different layer (e.g., `before_tool_call`, agent completion callback)

## Why this runbook exists
To let either systems-eng or Claude Code finish activation and testing with a clear handoff checklist.

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
- **Blocked by:** `message_sending` never fires for embedded agent responses (see blocking issue above).

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

### 6. Return path — `message_sending` never fires for agent responses (UNRESOLVED)
- **Symptom:** systems-eng processes relay message and completes successfully, but no outbound Discord message is produced. Zero `message_sending` events in logs.
- **Possible causes:** (a) `message_sending` only fires for certain message types, not embedded agent run completions; (b) the agent produced an empty response; (c) response delivery bypasses the plugin hook pipeline.
- **Status:** BLOCKING. Capture/forward code is correct and tested but never reached.

## Rollback

```bash
openclaw plugins disable clawsuite-relay
systemctl --user restart openclaw-gateway.service
```

(Optionally remove/disable relay env drop-in and `tools.alsoAllow` entries.)
