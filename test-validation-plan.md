# Test & Validation Plan — Relay Bot Initiative

## Test categories
1. Functional E2E
2. Failure-path behavior (fail loudly)
3. Security controls
4. State persistence/recovery

## Minimum tests for v1

- [x] orchestrator dispatch reaches subagent channel
  - **PASS** — Confirmed multiple times. Relay bot posts to #tech with dispatch marker and @mention. Evidence: dispatchIds `8afe4945`, `c918869d`, `537a94a5`, `443682d6`, `2a8c4f00`, others.
- [x] Subagent reply is forwarded to orchestrator
  - **PASS** — `agent_end` hook with `extractCurrentTurnContent` captures tool results + assistant text from current turn and forwards to orchestrator channel. CEO confirmed tool outputs (hostname) visible in forward but not in subagent channel. Evidence: dispatchId `443682d6` (content_len=51), `2a8c4f00` (content_len=21).
  - **CAVEAT**: Forward payloads >2000 chars fail (Discord limit). Needs message splitting. Only trivial/short responses forward successfully.
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
