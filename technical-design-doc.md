# Technical Design Doc (TDD) — Relay Bot Initiative

Status: Draft

## 1. Scope
- In-scope (v1): __________________
- Out-of-scope (v1): __________________

## 2. Interfaces (Contracts)
### 2.1 relay_dispatch
Request:
- targetAgentId:
- task:
- requestId (optional):
- options (optional):

Response:
- status: accepted|rejected|failed
- dispatchId:
- code:
- message:
- retryable:

## 3. State Model
Lifecycle states:
- CREATED
- POSTED_TO_CHANNEL
- SPECIALIST_RESPONDED
- FORWARDED_TO_orchestrator
- COMPLETED
- FAILED

Persistence:
- storage path:
- retention policy:
- recovery behavior after restart:

## 4. Failure Semantics
- Relay unavailable behavior:
- Fallback policy:
- Operator notification path:
- Timeouts and retries:

## 5. Security Controls
- token handling:
- channel permission minimums:
- allowed sender validation:
- message authenticity checks:

## 6. Observability
- required logs:
- correlation IDs:
- dashboard/grep views:
- incident artifact capture:

## 7. Rollback
- immediate disable switch:
- restore previous behavior:
- preserve incident evidence:

## 8. Documentation Practice (required)
- **Code comments:** explain non-obvious logic, invariants, and failure handling close to code.
- **Operator docs:** keep runbook-level behavior, setup, rollback, and troubleshooting in markdown docs (not only in code comments).
- **Decision records:** any meaningful tradeoff/decision is logged in `dev-log.md` with rationale.
- **User-facing docs:** if behavior/config changes for users, update README/changelog notes in the same milestone.
- **Rule:** implementation is not "done" until code + docs + rollback notes are all updated.
- **Version control policy:** all design/ops docs in this initiative are committed to git along with code changes (same milestone PR/commit set), so rollback can be performed from repository state.
## 9. Acceptance Criteria
- functional:
- reliability:
- transparency:
- safety/security:
