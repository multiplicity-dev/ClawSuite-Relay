# Technical Design Doc (TDD) — Relay Bot Initiative

Status: Milestone 1 — PRIMARY BLOCKER RESOLVED. Capture + delivery working (see implementation-plan.md for remaining polish)

## 1. Scope
- In-scope (v1):
  - Single-subagent relay for `systems-eng` only (CTO lane)
  - `relay_dispatch` contract + deterministic status codes
  - Relay bot posts orchestrator prompt into mapped subagent channel with mention
  - `llm_output` hook captures subagent's last assistant message and delivers via gateway injection to orchestrator session (matching completion announce content and delivery mechanism)
  - Fail-loud behavior (no silent fallback)
  - Basic correlation IDs and audit logging
  - Suppress redundant transient subagent completion announce in `#general` when relay mode is active
- Out-of-scope (v1):
  - Multi-subagent batching and fan-in orchestration
  - Packaging/distribution (ClawHub)
  - Upstream core API changes (`chat.append` or equivalent)
  - Advanced policy automation beyond required relay constraints

## 2. Interfaces (Contracts)
### 2.1 relay_dispatch
Request:
- `targetAgentId` (required, string): must have a configured relay mapping
- `task` (required, string): orchestrator-formulated dispatch prompt
- `requestId` (optional, string): idempotency key; must be unique per intended relay step
- `options` (optional object):
  - `priority` (`normal` default)
  - `replyMode` (`auto-forward` default)

Response:
- `status`: `accepted` | `rejected` | `failed`
- `dispatchId`: UUID (always present when accepted)
- `code`: stable machine code
  - `TARGET_UNMAPPED`
  - `RELAY_UNAVAILABLE`
  - `DISPATCH_IN_FLIGHT`
  - `RATE_LIMITED`
  - `INVALID_PAYLOAD`
- `message`: human-readable status detail
- `retryable`: boolean

Current duplicate semantics:
- If the same `requestId` is reused while the earlier dispatch is still `POSTED_TO_CHANNEL` or `SUBAGENT_RESPONDED`, relay returns `failed/DISPATCH_IN_FLIGHT` and does not post a new message.
- If the prior dispatch is `COMPLETED`, relay may return the existing dispatch as an idempotent replay.
- If the prior non-completed replayable dispatch is older than `CLAWSUITE_RELAY_REPLAYABLE_TTL_MS`, relay expires it, marks it `FAILED`, and creates a fresh dispatch.

## 3. State Model
Lifecycle states:
- `CREATED`
- `POSTED_TO_CHANNEL`
- `SUBAGENT_RESPONDED`
- `COMPLETED`
- `FAILED`

Persistence:
- storage path: `~/.openclaw/extensions/relay-bridge/dispatches/*.json`
- retention policy: keep 7 days rolling by default (configurable), prune daily
- recovery behavior after restart: on startup, reload unfinished dispatch records; resume timeout tracking and forwarding logic

## 4. Failure Semantics
- Relay unavailable behavior:
  - return `failed/RELAY_UNAVAILABLE`
  - post explicit operator-facing failure notice in orchestrator channel
- Fallback policy:
  - **no silent fallback** to `sessions_spawn`
  - optional explicit manual override command can be introduced later (not in v1)
- Operator notification path:
  - immediate notification in orchestrator channel (`#general`)
  - structured error in relay log with dispatchId
- Timeouts and retries:
  - dispatch posting retry: 2 attempts with short backoff for transient API errors
  - subagent response timeout: default 10 minutes, then mark `FAILED` with `SUBAGENT_TIMEOUT`
  - `requestId` is not a blind retry token; live duplicates fail with `DISPATCH_IN_FLIGHT`
  - stale replayable non-completed dispatches are expired after `CLAWSUITE_RELAY_REPLAYABLE_TTL_MS`
  - missing orchestrator/source identity fails closed instead of silently posting under generic relay branding

## 5. Security Controls
- token handling:
  - relay bot token from environment or secret file (`600` perms), never hardcoded
- channel permission minimums:
  - send/read history only in mapped subagent channels; no admin perms
- allowed sender validation:
  - relay dispatch accepted only from orchestrator-controlled path (plugin/tool boundary)
- message authenticity checks:
  - dispatch payload includes dispatchId + source marker; hook only forwards messages that match active dispatch expectations
- source identity checks:
  - dispatch posting requires a valid `sourceAgentId` with configured source profile metadata
  - if source identity/profile is missing, dispatch fails loudly before posting

## 6. Observability
- required logs:
  - dispatch created, posted, response captured, completed, failed
- correlation IDs:
  - `dispatchId` attached to all logs/events/messages
- dashboard/grep views:
  - grep by `dispatchId`, `targetAgentId`, `code`, timeout events
- incident artifact capture:
  - preserve dispatch JSON + relevant gateway log window (+/-120s) for failures

## 7. Rollback
- immediate disable switch:
  - config flag `relay.enabled=false` (plugin-level)
- restore previous behavior:
  - disable relay plugin; remove `sessions_spawn` block; restart gateway
- preserve incident evidence:
  - retain dispatch state files + logs before rollback actions

## 8. Documentation Practice (required)
- **Code comments:** explain non-obvious logic, invariants, and failure handling close to code.
- **Operator docs:** keep runbook-level behavior, setup, rollback, and troubleshooting in markdown docs (not only in code comments).
- **Decision records:** any meaningful tradeoff/decision is logged in `dev-log.md` with rationale.
- **User-facing docs:** if behavior/config changes for users, update README/changelog notes in the same milestone.
- **Rule:** implementation is not "done" until code + docs + rollback notes are all updated.
- **Version control policy:** all design/ops docs in this initiative are committed to git along with code changes (same milestone PR/commit set), so rollback can be performed from repository state.
## 9. Acceptance Criteria

### Implementation status (2026-02-28)

- functional:
  - [x] orchestrator dispatch to `systems-eng` appears in mapped channel via relay bot — **VERIFIED LIVE**
  - [x] subagent's last assistant message captured via `llm_output` hook and delivered to orchestrator via gateway injection — **VERIFIED LIVE 2026-02-28**. `assistantTexts[last]` → `openclaw gateway call agent` → trigger message in orchestrator session. Content parity with native `sessions_spawn` confirmed via source code trace.
- reliability:
  - [ ] transient relay API errors recover within retry budget — **NOT IMPLEMENTED** (no retry logic in v1)
  - [ ] timeout paths produce explicit `FAILED` state + operator notice — **NOT IMPLEMENTED** (no timeout tracking in v1)
- transparency:
  - [x] prompt/response visible in subagent channel — **VERIFIED LIVE**
  - [ ] redundant transient completion announce in `#general` suppressed during relay mode — **CODE EXISTS, NOT TESTED LIVE**
- safety/security:
  - [ ] no silent fallback to `sessions_spawn` — **NOT ENFORCED** (no `before_tool_call` hook blocking `sessions_spawn`)
  - [x] token is secret-managed and never logged — env var via systemd drop-in, not in code
  - [x] only mapped channels/agents are accepted in v1 — `V1_TARGET_AGENT = "systems-eng"` enforced

## 10. Milestone 0 Approval Checklist (required before first code)
- [x] Scope approved: v1 is CTO-only single-subagent relay (no multi-subagent batching)
- [x] Contract approved: `relay_dispatch` request/response fields + error codes
- [x] Failure policy approved: fail loudly, no silent fallback
- [x] Security policy approved: secret-managed token, minimal permissions, sender validation
- [x] Observability approved: dispatchId correlation + required lifecycle logs
- [x] Rollback approved: `relay.enabled=false` switch + documented restore path
- [x] Documentation policy approved: docs and code updated in same commit/PR set
