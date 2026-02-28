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
