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

- Date/Time: 2026-02-27
- Author: systems-eng
- Change: Wired subagent response-capture + forward-to-orchestrator core path.
- Why: Complete remaining Milestone 1 core flow before live hook integration.
- Evidence:
  - Added `src/capture.ts` with `captureSubagentResponse` + marker extraction + state-gated processing
  - Added `src/forward.ts` interfaces and fail-loud default forward transport
  - Added `DiscordForwardTransport` + `forwardTransportFromEnv` in `src/transport-discord.ts`
  - Added tests for reference-based capture, marker fallback, and forward completion state
- Risk introduced: Medium (forward path depends on correct orchestrator channel config).
- Rollback note: Revert capture/forward commit to return to dispatch-only flow.

- Date/Time: 2026-02-27
- Author: systems-eng
- Change: Added explicit forward-failure retry behavior test for capture flow.
- Why: Document and lock expected behavior when forwarding fails (`SUBAGENT_RESPONDED` retained, retry by re-capture).
- Evidence: `test/capture.test.ts` includes failing-forward then recovery-forward sequence with state assertions.
- Risk introduced: Low (test-only behavior lock-in).
- Rollback note: Revert test commit if behavior model changes.

- Deferred (explicit from capture audit):
  - O(n) scan functions (`findDispatchByRequestId`, `findDispatchByPostedMessageId`) remain for v1, revisit with index map in Milestone 2/3.
  - Marker regex looseness is acceptable due to UUID validation guard in `loadDispatch`; tighten later if noisy.
  - Test env-var concurrency fragility accepted for now; consider `--test-concurrency=1` or injected config factory in hardening phase.

- Date/Time: 2026-02-27
- Author: systems-eng
- Change: Implemented transient-general-announce suppression filter logic.
- Why: Close remaining Milestone 1 behavior requirement before runtime hook integration.
- Evidence:
  - Added `src/announce-filter.ts` with `shouldSuppressTransientGeneralAnnounce(...)`
  - Supports suppression by dispatch marker and by related subagent message id correlation
  - Added `test/announce-filter.test.ts` coverage for disabled mode, marker path, and message-id path
- Risk introduced: Low (logic is isolated; no runtime interception wired yet).
- Rollback note: Revert filter commit if suppression strategy changes.

- Date/Time: 2026-02-27
- Author: systems-eng
- Change: Applied announce-filter audit follow-ups.
- Why: Improve maintainability and observability before runtime hook integration.
- Evidence:
  - Deduplicated marker parsing via shared `src/markers.ts`
  - Added explicit suppression-state gating (`SUBAGENT_RESPONDED`+)
  - Added `announce.suppressed` structured logs with correlation path
  - Expanded tests for channel mismatch, unknown marker dispatch, and failed-dispatch non-suppression
- Risk introduced: Low (predicate behavior made stricter, with added tests).
- Rollback note: Revert this commit if suppression-state policy changes.

- Date/Time: 2026-02-27
- Author: systems-eng
- Change: Wired suppression/capture predicate into OpenClaw runtime hook path (plugin entrypoint).
- Why: Move from pure library logic to executable hook integration for `message_received` + `message_sending`.
- Evidence:
  - Added `src/openclaw-plugin.ts` registering hooks:
    - `message_received` -> `captureSubagentResponse`
    - `message_sending` -> `shouldSuppressTransientGeneralAnnounce` with `{ cancel: true }`
  - Added plugin packaging files: `openclaw.plugin.json`, root `index.ts`
  - Added plugin integration tests in `test/openclaw-plugin.test.ts`
  - README updated with plugin install/load instructions
- Risk introduced: Medium (runtime behavior depends on env/channel config correctness).
- Rollback note: Disable plugin (`openclaw plugins disable clawsuite-relay`) and restart gateway.

- Date/Time: 2026-02-27
- Author: systems-eng
- Change: Applied runtime-hook audit follow-ups (entrypoint + resiliency).
- Why: Ensure plugin loads via documented OpenClaw extension discovery and harden hook error isolation.
- Evidence:
  - Added `package.json#openclaw.extensions` pointing to `./src/openclaw-plugin.ts`
  - Added try/catch boundary around capture execution in `message_received`
  - Expanded plugin tests for non-discord no-op and missing-content early bail
- Risk introduced: Low.
- Rollback note: Revert follow-up commit if loader assumptions change.

- Deferred (explicit from runtime-hook audit):
  - `relayEnabled`/`orchestratorChannelId` are read at register-time (restart required for config/env changes), accepted for v1 operational model.
  - Relay-channel allowlist optimization in `message_received` deferred to Milestone 2/3 performance pass.

