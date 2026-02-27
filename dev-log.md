# Dev Log — Relay Bot Initiative

Use this as the canonical chronological log.

## Entry Template
- Date/Time:
- Author:
- Change:
- Why:
- Evidence:
- Risk introduced:
- Rollback note:

---

## Entries

- Date/Time: 2026-02-27
- Author: systems-eng
- Change: Filled Milestone 0 TDD placeholders with concrete v1 contract/scope/failure/security/rollback criteria.
- Why: Move from concept doc to executable design baseline before coding.
- Evidence: `technical-design-doc.md` sections 1-10 populated.
- Risk introduced: Medium (early design lock could miss edge cases).
- Rollback note: Revert single commit if scope contract needs reset.

- Date/Time: 2026-02-27
- Author: systems-eng
- Change: Implemented Milestone 1 coding skeleton (TypeScript project scaffolding, relay dispatch contract implementation, file-backed dispatch persistence, structured logging, and baseline tests).
- Why: Start executable code path for v1 CTO-only relay with deterministic behavior.
- Evidence: `src/types.ts`, `src/state.ts`, `src/logger.ts`, `src/index.ts`, `test/relay-dispatch.test.ts`, `package.json`, `tsconfig.json`; tests passing locally.
- Risk introduced: Low-medium (skeleton may require interface refinements once live Discord wiring begins).
- Rollback note: Revert this milestone commit; no runtime integrations deployed yet.

- Date/Time: 2026-02-27
- Author: systems-eng
- Change: Addressed audit findings from Claude Code review.
- Why: Close quality gaps before wiring transport integration.
- Evidence:
  - Implemented `requestId` idempotency replay in `relay_dispatch`
  - Added test isolation via `CLAWSUITE_RELAY_DISPATCH_DIR` temp directory override
  - Added dispatchId validation in `loadDispatch` to block traversal-style ids
  - Fixed build config (`rootDir=src`, tests excluded from dist emit)
  - Added optional log suppression in tests (`CLAWSUITE_RELAY_SILENT_LOGS=1`)
- Risk introduced: Low (contained changes, expanded tests).
- Rollback note: Revert this follow-up commit; previous skeleton remains intact.

