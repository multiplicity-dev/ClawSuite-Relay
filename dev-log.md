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

- Date/Time: 2026-02-27
- Author: systems-eng
- Change: Added `RelayTransport` interface and injected transport flow in `relay_dispatch`.
- Why: Keep core dispatch logic testable and decouple network posting from orchestration state transitions.
- Evidence:
  - New `src/transport.ts` with interface + noop transport
  - `relay_dispatch` now accepts deps `{ transport }`, posts via transport, and transitions state to `POSTED_TO_CHANNEL`
  - Tests updated with mocked transport asserting call and persisted `postedMessageId`
- Risk introduced: Low-medium (API surface expanded with dependency injection).
- Rollback note: Revert transport commit to restore pre-transport skeleton.

- Date/Time: 2026-02-27
- Author: systems-eng
- Change: Applied second audit pass fixes for idempotency correctness on failed dispatches.
- Why: Prevent false "accepted" idempotent replay when prior dispatch never posted.
- Evidence:
  - Idempotent replay now allowed only for replayable states (`POSTED_TO_CHANNEL`+), not `CREATED`/`FAILED`
  - Transport failure path now marks persisted record `FAILED`
  - Added transport-failure test verifying failed state + non-replay behavior
  - Failed responses now include `dispatchId` for traceability
- Risk introduced: Low (behavioral correction + test coverage increase).
- Rollback note: Revert this commit if needed; previous behavior was less correct.

- Date/Time: 2026-02-27
- Author: systems-eng
- Change: Added concrete Discord transport adapter and fail-loud default transport behavior.
- Why: Progress Milestone 1 from abstract transport to real integration-ready wiring.
- Evidence:
  - `src/transport-discord.ts` added (`DiscordRelayTransport`, `transportFromEnv`)
  - default transport changed to `UnconfiguredRelayTransport` (throws by default)
  - tests updated for explicit transport injection and unconfigured-fail path
- Risk introduced: Medium (env-config errors can block dispatch until configured, by design).
- Rollback note: Revert this commit to return to previous transport behavior.

- Date/Time: 2026-02-27
- Author: systems-eng
- Change: Applied audit follow-up to Discord transport wiring.
- Why: Improve correlation readiness and operator diagnostics before response-capture phase.
- Evidence:
  - Dispatch marker embedded in posted content: `[relay_dispatch_id:<id>]`
  - Preflight payload-length check for Discord 2000-char limit
  - Payload-too-long now returns `rejected/INVALID_PAYLOAD` from `relay_dispatch`
  - Added JSON env parse error clarity and snowflake format validation for channel/mention IDs
  - Added transport tests for marker inclusion and overlong-content rejection
- Risk introduced: Low-medium (strict validation may fail fast on misconfigured envs).
- Rollback note: Revert this commit to prior adapter behavior.

- Deferred (explicit):
  - O(n) requestId lookup remains acceptable for v1 volume; index optimization later.
  - Multi-message split strategy for overlong prompts deferred to Milestone 2 reliability work.

