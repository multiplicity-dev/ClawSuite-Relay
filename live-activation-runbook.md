# ClawSuite-Relay Live Activation Runbook

## Current status (2026-02-27)
- Plugin installed as local link and loaded (`clawsuite-relay`).
- Runtime hook wiring is implemented (`message_received` capture + `message_sending` suppression).
- `relay_dispatch` tool registered via plugin, visible to agents with `tools.alsoAllow`.
- Systemd drop-in for relay env vars configured.
- **Step 1 complete:** gateway restarted, plugin loaded, no transport errors.
- **Step 2 complete:** plugin confirmed loaded in gateway logs.
- **Smoke Test A (dispatch post path):** verified — orchestrator calls `relay_dispatch` tool, message posted to #tech with dispatch marker and @mention.
- **Smoke Tests B–D:** pending.

## Why this runbook exists
To let either systems-eng or Claude Code finish activation and testing with a clear handoff checklist.

---

## Prerequisites — Tool visibility (REQUIRED)

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

### Test B: Capture + forward path [PENDING]
- Reply in subagent channel to relay message.
- Confirm response is captured and forwarded to orchestrator channel.
- Confirm forwarded content includes dispatch marker(s).

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
- **Bot identity:** Both orchestrator dispatches and subagent replies display as "openclaw" (the Discord bot name). Ideally, dispatches would identify the originating agent (e.g., "CEO"). This is a single-bot-token limitation; addressing it would require Discord webhook-based posting with per-agent display names, or multiple bot tokens.
- **@mention in relay posts:** The relay posts `@username` for routing/gating purposes, but this is confusing to human readers who see themselves mentioned in a machine-to-machine prompt. Consider suppressing the mention display or moving it to metadata.
- **Visible dispatch markers:** `[relay_dispatch_id:...]` markers appear in channel messages. Functional for correlation but noisy for casual reading. Consider moving to Discord embed metadata or message components in a future phase.

---

## Rollback

```bash
openclaw plugins disable clawsuite-relay
systemctl --user restart openclaw-gateway.service
```

(Optionally remove/disable relay env drop-in and `tools.alsoAllow` entries.)
