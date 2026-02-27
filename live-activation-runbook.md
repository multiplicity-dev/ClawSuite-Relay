# ClawSuite-Relay Live Activation Runbook

## Current status (as of now)
- Plugin installed as local link and appears loaded in plugin list (`clawsuite-relay`).
- Runtime hook wiring is implemented in code (`message_received` capture + `message_sending` suppression predicate).
- Systemd drop-in for relay env vars exists.
- **Action pending:** gateway restart after latest env formatting correction.

## Why this runbook exists
To let either systems-eng or Claude Code finish activation and testing with a clear handoff checklist.

---

## Step 1 — Apply runtime config + restart

```bash
systemctl --user daemon-reload
openclaw gateway restart
openclaw gateway status
```

Expected: gateway running + RPC probe ok.

---

## Step 2 — Verify plugin loading

```bash
openclaw plugins list | grep -i clawsuite
```

Expected: `clawsuite-relay` shown as loaded.

---

## Step 3 — Smoke tests (operator-visible)

### Test A: Dispatch post path
- Trigger orchestrator relay dispatch for `systems-eng`.
- Confirm relay bot posts to mapped subagent channel.
- Confirm dispatch marker appears: `[relay_dispatch_id:...]`.

### Test B: Capture + forward path
- Reply in subagent channel to relay message.
- Confirm response is captured and forwarded to orchestrator channel.
- Confirm forwarded content includes dispatch marker(s).

### Test C: Suppression path
- During correlated transient announce in orchestrator channel, confirm suppression cancels redundant announce.

### Test D: Fail-loud path
- Temporarily misconfigure forward channel id (or simulate failure).
- Confirm failure is explicit (not silent) and recoverable on reconfiguration.

---

## What the human tester should expect now

### Should expect
- CTO-only lane behavior (`systems-eng`)
- correlation markers
- fail-loud behavior on missing/invalid transport config
- capture/forward lifecycle state transitions

### Should NOT expect yet
- multi-subagent batching
- long-message split > Discord limit
- scale-optimized lookup indices
- zero-restart config hot-reload semantics

---

## Known deferred items
- O(n) lookup scans (requestId/message correlation)
- marker regex strictness refinement
- test/env concurrency hardening
- long-message split strategy

---

## Rollback

```bash
openclaw plugins disable clawsuite-relay
openclaw gateway restart
```

(Optionally remove/disable relay env drop-in.)
