# TRACK.md (Single Control Entry)

Use this file as the ONLY pointer for Phase 1 execution.

## Mandatory per-turn behavior
1. Read this file.
2. Read `facts-established.md`.
3. Read `phase1-workflow.md`.
4. Execute exactly one active-step cycle:
   - one change
   - one discriminating test
   - one evidence update (`dev-log.md`)
5. Report only: change, test, evidence, result.

## Drift prevention
- No new hypotheses unless `facts-established.md` active step is completed/failed and updated.
- No hook-family retries without new evidence.
- If two failures in a row: stop and present options.

## User prompt (if needed)
"Follow TRACK.md now."
