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

- Date/Time: 2026-02-27
- Author: Claude Code (Opus 4.6)
- Change: Created `relay_dispatch` tool for OpenClaw plugin API and wired tool registration.
- Why: Orchestrator agent cannot call `relay_dispatch` without a registered tool — the function existed but was not exposed via the plugin tool system.
- Evidence:
  - New `src/relay-dispatch-tool.ts`: TypeBox parameter schema, tool metadata (name/label/description), `execute()` handler wrapping `relay_dispatch()` with formatted `AgentToolResult` output.
  - Updated `src/openclaw-plugin.ts`: imports `transportFromEnv` and `createRelayDispatchTool`, initializes relay transport at registration time (with try/catch for missing config), calls `api.registerTool()`.
  - Updated `PluginApi` interface to include `registerTool`.
  - Updated `test/openclaw-plugin.test.ts`: added `createMockApi()` helper with `registerTool` tracking, added test for tool registration verification, added test for tool execution with mock transport.
  - Added `@sinclair/typebox` dependency to `package.json`.
  - All 25/25 tests passing, typecheck clean.
- Risk introduced: Low (additive tool registration, no behavior change to hooks).
- Rollback note: Remove `relay-dispatch-tool.ts` and revert `openclaw-plugin.ts` to prior version.

- Date/Time: 2026-02-27
- Author: Claude Code (Opus 4.6)
- Change: Discovered and resolved plugin tool visibility requirements for OpenClaw agents.
- Why: `relay_dispatch` tool was registered but invisible to orchestrator. Two failed attempts before root cause identified.
- Evidence:
  - Attempt 1: Registered with `{ optional: true }` — failed because optional tools require explicit `tools.allow` and CEO agent had no allowlist.
  - Attempt 2: Removed `optional: true` — still failed because ALL plugin tools (optional or not) must be explicitly listed in agent `tools.alsoAllow` config.
  - Root cause: OpenClaw's `resolvePluginTools()` filters tools against per-agent allowlists. Plugin tool registration makes tools *available* but not *visible* to any agent until configuration grants access.
  - Fix: Added `"tools": { "alsoAllow": ["relay_dispatch"] }` to `ceo` and `systems-eng` agent entries in `~/.openclaw/openclaw.json`.
- Risk introduced: Low (configuration-only change).
- Rollback note: Remove `tools.alsoAllow` entries from agent configs.

- Date/Time: 2026-02-27
- Author: Claude Code (Opus 4.6)
- Change: Discovered and resolved relay bot message filtering issue in OpenClaw Discord integration.
- Why: After successful relay dispatch (message posted to #tech), systems-eng never responded. Relay bot messages were silently dropped.
- Evidence:
  - Root cause: OpenClaw defaults to `allowBots: false` — any message with `message.author.bot === true` is dropped before reaching the agent. The relay bot uses a separate Discord bot token, so its messages are bot-authored.
  - Fix: Added `"allowBots": true` to `channels.discord` config and added relay bot user ID (`1474833207483699252`, decoded from bot token) to `allowFrom` and guild `users` allowlist.
  - Security note: `allowBots` is account-level only (no per-channel override). Access control maintained via `users` allowlist — only Dave and the relay bot are whitelisted.
- Risk introduced: Medium (any message from whitelisted bot user ID in any allowed channel will be processed; mitigated by strict `users` allowlist).
- Rollback note: Remove `allowBots: true` and relay bot user ID from config.

- Date/Time: 2026-02-27
- Author: Claude Code (Opus 4.6) + Dave
- Change: Created separate "ClawSuite-Relay" Discord bot and updated all config to use its token and user ID.
- Why: OpenClaw's self-message filter unconditionally drops messages from its own bot identity. Using the same bot token for both the gateway and the relay meant relay messages were invisible to subagent sessions. A second bot is architecturally required (as noted in relay-bot-plan.md).
- Evidence:
  - Created "ClawSuite-Relay" application in Discord Developer Portal
  - Invited to server with Send Messages permission (OAuth2 permission 2048)
  - Updated systemd drop-in with new `CLAWSUITE_RELAY_BOT_TOKEN`
  - Updated `openclaw.json` with new relay bot user ID (`1476809589591773295`) in `allowFrom` and guild `users`
  - Verified: relay messages now visible to systems-eng, agent responds to dispatched prompts
  - Side benefit: relay bot displays with distinct name and yellow highlight in Discord, resolving the bot identity UX issue
- Risk introduced: Low (additive bot, no changes to main OpenClaw bot).
- Rollback note: Revert to old bot token in systemd drop-in, remove new user ID from openclaw.json.

- Date/Time: 2026-02-27
- Author: Claude Code (Opus 4.6)
- Change: Fixed capture logic forwarding relay bot's own outbound prompt instead of subagent reply.
- Why: With `allowBots: true`, the gateway processes relay bot messages via `message_received`. The relay bot's outbound dispatch prompt contains `[relay_dispatch_id:...]`, which the capture logic matched as a "subagent response" and forwarded back to the orchestrator — echoing the prompt instead of the actual reply.
- Evidence:
  - Root cause: `captureSubagentResponse` matched the relay bot's own outbound message via the dispatch marker. The dispatch was in state `POSTED_TO_CHANNEL`, so it passed state gating and forwarded the prompt content.
  - Fix: Added `event.messageId === dispatch.postedMessageId` guard in `capture.ts`. If the incoming message ID matches the dispatch's posted message ID, it's the relay's own outbound message and is skipped.
  - Added test: "capture ignores relay bot's own outbound message" in `test/capture.test.ts`.
  - All 26/26 tests passing.
- Risk introduced: Low (additive guard, no behavior change for legitimate subagent responses).
- Rollback note: Remove the `postedMessageId` guard from `captureSubagentResponse`.

- Date/Time: 2026-02-27
- Author: Claude Code (Opus 4.6)
- Change: Removed `message_sent` hook registration (hook runner corruption) and moved outbound capture to `message_sending`.
- Why: Registering `api.on("message_sent", ...)` caused the OpenClaw plugin hook runner to stop dispatching ALL modifying hooks (`message_sending`). Only void hooks (`message_received`) continued to fire. Removing `message_sent` and consolidating capture into `message_sending` restores expected behavior.
- Evidence:
  - Before `message_sent` registration: `[hooks] running message_sending (1 handlers, sequential)` appeared in logs at 04:09:55, 04:31:51, 05:25:14.
  - After `message_sent` registration: zero `message_sending` entries. Only `message_received` fired (4 instances observed).
  - After removing `message_sent`: hook runner logs show `message_received` firing normally. `message_sending` behavior still under investigation (see next entry).
  - `message_sending` handler now has two paths: (1) outbound capture via `reverseChannelMap` → `captureOutboundResponse`, (2) announce suppression via `shouldSuppressTransientGeneralAnnounce`.
  - Added `captureOutboundResponse` to `capture.ts` and `findPendingDispatchForAgent` to `state.ts`.
  - Added test: "message_sending attempts outbound capture for subagent channel" in plugin tests.
  - All 29/29 tests passing.
- Risk introduced: Low (removed broken hook, consolidated capture into working hook).
- Rollback note: Revert `openclaw-plugin.ts` and `capture.ts` changes.

- Date/Time: 2026-02-27
- Author: Claude Code (Opus 4.6)
- Change: Identified root cause of return-path failure — `message_sending` never fires for systems-eng outbound responses.
- Why: After fixing all capture/forward logic and removing the `message_sent` corruption, the return path still doesn't work. Detailed log analysis revealed that `message_sending` simply does not fire for embedded agent run completions (systems-eng's Discord responses).
- Evidence (full timeline from 06:27 dispatch):
  ```
  06:27:42.058  dispatch.created (relay_dispatch tool call)
  06:27:42.437  dispatch.posted (relay bot posts to #tech, messageId=1476828121293652080)
  06:27:42.595  [hooks] running message_received (relay bot's own message seen by gateway)
  06:27:43.470  lane enqueue: session:agent:systems-eng:discord:channel:1474868861525557308
  06:27:43.490  embedded run start: provider=openai-codex model=gpt-5.3-codex
  06:27:43.497  plugin auto-loaded for systems-eng session
  06:27:50.552  embedded run agent end (isError=false, 7s duration)
  06:27:50.569  lane task done — ZERO message_sending events, ZERO Discord API activity
  ```
  - systems-eng received the relay message, processed it for 7 seconds, completed without error, but produced NO outbound Discord message.
  - No `message_sending` hook fired. No announce triggered. Response was silently consumed.
  - In earlier tests (around 05:25), systems-eng DID respond visibly in #tech. Behavior may be inconsistent or dependent on session state.
- Blocking question: **Why does systems-eng's embedded agent run complete without producing a Discord message?** Possible causes:
  1. The agent produced an empty response (GPT-5.3 decided not to reply)
  2. The gateway's response delivery mechanism doesn't fire `message_sending` for embedded agent responses (it may be an internal-only hook)
  3. Some session or plugin configuration suppresses response delivery
  4. The response was delivered via a different path that bypasses the hook pipeline
- Status: **Blocking — Milestone 1 capture/forward path cannot work until this is resolved.**

- Deferred (explicit from live activation):
  - @mention noise: Relay posts `@climbswithgoats` for routing/gating, but `requireMention: false` means it's unnecessary. The mention map currently points to the human user, not the OpenClaw bot.
  - Visible dispatch markers: `[relay_dispatch_id:...]` in channel messages is functional but noisy for casual reading.

