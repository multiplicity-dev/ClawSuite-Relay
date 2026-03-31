# Test & Validation Plan — Relay Bot Initiative

> Note (2026-02-28): This file contains historical v1-era validation notes. Current behavior no longer uses @mentions in relay dispatch posts.

## Test categories
1. Functional E2E
2. Failure-path behavior (fail loudly)
3. Security controls
4. State persistence/recovery

## Minimum tests for v1

- [x] orchestrator dispatch reaches subagent channel
  - **PASS** — Confirmed multiple times. Relay bot posts to #tech with dispatch marker and @mention. Evidence: dispatchIds `8afe4945`, `c918869d`, `537a94a5`, `443682d6`, `2a8c4f00`, others.
- [ ] Subagent's last assistant message is forwarded to orchestrator
  - **PENDING RETEST** — Switching capture from `agent_end` (inconsistent) to `llm_output` hook. Relay should forward `assistantTexts[assistantTexts.length - 1]` (last entry), matching what the completion announce delivers in normal `sessions_spawn` workflows. Previous `agent_end`-based capture produced inconsistent results across multiple attempts. `llm_output` provides the data pre-extracted.
  - **CAVEAT**: Forward payloads >2000 chars fail (Discord limit). Needs message splitting.
- [ ] orchestrator synthesis path remains intact
  - **NOT TESTED** — No test has verified that CEO correctly synthesizes from the forwarded relay content in a real orchestration flow.
- [ ] Relay outage surfaces explicit error (no silent fallback)
  - **NOT TESTED** — `UnconfiguredForwardTransport` throws in unit tests (30/30 pass), but never tested live with a misconfigured transport.
- [ ] Restart does not corrupt dispatch state
  - **NOT TESTED** — Disk-persisted dispatch files survive restart in theory (file-based state), but no live restart-during-dispatch test performed.
- [x] Return-hop failure does not leave stale armed dispatch / translator recall loop
  - **PASS (unit/regression)** — Added 2026-03-16 after CLO↔translator incidents. Simulated gateway-forward failure after subagent output capture. Expected behavior now:
    - dispatch transitions `POSTED_TO_CHANNEL` → `SUBAGENT_RESPONDED` → `FAILED`
    - `lastError` recorded on dispatch
    - armed record cleared for target agent
    - stale `requestId` path cannot sit in a replayable half-live state
  - Evidence: `test/openclaw-plugin.test.ts`
- [x] In-flight duplicate requestId is rejected (no immediate re-dispatch loop)
  - **PASS (unit/regression)** — Added 2026-03-16. If the same `requestId` is reused while an existing dispatch is still `POSTED_TO_CHANNEL` or `SUBAGENT_RESPONDED`, relay now returns `DISPATCH_IN_FLIGHT` and does not post again.
  - Evidence: `test/relay-dispatch.test.ts`
- [x] Missing source identity/profile fails closed
  - **PASS (unit/regression)** — Added 2026-03-16. Relay now requires both:
    - orchestrator agent identity at dispatch time
    - matching source profile at Discord post time
  - Missing either now fails loudly instead of posting a generic `relay`-branded message into the target channel.
  - Evidence: `test/relay-dispatch.test.ts`, `test/transport-discord.test.ts`
- [x] Completed idempotent replay is described as reuse, not a fresh post
  - **PASS (unit/regression)** — Added 2026-03-17. Tool text now explicitly says `idempotent replay` and `No new message was posted` when a completed dispatch is reused for the same `requestId`.
  - Evidence: `test/relay-dispatch.test.ts`
- [x] Test suite isolates armed-dispatch temp state
  - **PASS (test-harness hardening)** — Added 2026-03-17. `test/openclaw-plugin.test.ts` and `test/relay-dispatch.test.ts` now isolate both `CLAWSUITE_RELAY_DISPATCH_DIR` and `CLAWSUITE_RELAY_ARMED_DIR`, eliminating nondeterministic reads/writes against the real armed-dispatch path.
  - Evidence: `test/openclaw-plugin.test.ts`, `test/relay-dispatch.test.ts`

## Additional tests discovered during live activation

- [x] Duplicate forward prevention
  - **PASS** — Using `agent_end` as sole capture hook. `before_message_write` + `agent_end` race caused duplicates within 121ms. Fix: single hook only.
- [x] Echo loop prevention
  - **PASS** — Relay bot user ID filter + envelope content guards prevent re-capture of forwarded messages.
- [x] Suppression of redundant transient announce in orchestrator channel
  - **NOT TESTED LIVE** — Code exists (`shouldSuppressTransientGeneralAnnounce`), passes unit tests, but never triggered in a live dispatch. Marked [x] in implementation-plan.md by GPT but that was incorrect.
- [ ] Auto-delete of relay envelope in orchestrator channel
  - **NOT TESTED** — GPT attempted but deleted wrong message (CEO's prompt to #tech). Approach deferred.

## Evidence format
For each test include:
- Test ID
- Preconditions
- Steps
- Expected
- Actual
- Logs/screenshots
- Pass/Fail
