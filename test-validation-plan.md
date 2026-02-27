# Test & Validation Plan — Relay Bot Initiative

## Test categories
1. Functional E2E
2. Failure-path behavior (fail loudly)
3. Security controls
4. State persistence/recovery

## Minimum tests for v1
- [ ] orchestrator dispatch reaches subagent channel
- [ ] Subagent reply is forwarded to orchestrator
- [ ] orchestrator synthesis path remains intact
- [ ] Relay outage surfaces explicit error (no silent fallback)
- [ ] Restart does not corrupt dispatch state

## Evidence format
For each test include:
- Test ID
- Preconditions
- Steps
- Expected
- Actual
- Logs/screenshots
- Pass/Fail
