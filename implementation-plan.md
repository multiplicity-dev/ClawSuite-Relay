# Implementation Plan — Relay Bot Initiative

Status: Milestone 1 — IN PROGRESS (blockers remain, see below)

## Milestone 0 — Design Freeze
- [x] Approve TDD
- [x] Approve failure semantics
- [x] Approve v1 scope

## Milestone 1 — Single-Subagent Relay (CTO only)

### Core implementation (done)
- [x] Relay dispatch contract + validation skeleton (`relay_dispatch`) with deterministic status codes
- [x] Relay post path wired via `RelayTransport` interface + mocked tests + live Discord transport verified
- [x] Subagent response capture core flow (`captureSubagentResponse`) with state transitions
- [x] Forward to orchestrator path via `ForwardTransport` abstraction (+ Discord adapter)
- [x] Basic correlation IDs (`dispatchId` lifecycle)
- [x] `relay_dispatch` tool registered via OpenClaw plugin API (TypeBox schema, execute handler)
- [x] Disk-persisted arming at dispatch time (plugin is re-initialized per session — in-memory state lost)
- [ ] **Capture subagent's last assistant message via `llm_output` hook.** The relay should forward `assistantTexts[assistantTexts.length - 1]` — matching what the completion announce delivers in normal `sessions_spawn` workflows. Previous attempts used `agent_end` and `before_message_write` with inconsistent results. `llm_output` provides the data pre-extracted as `string[]`, avoiding message parsing entirely. See `layer-disambiguation.md` for the four-surface analysis and rationale for targeting last message only (orchestrator context budget).

### Deployment prerequisites (done)
- [x] Plugin tools require `tools.alsoAllow: ["relay_dispatch"]` in per-agent config (`openclaw.json`)
- [x] Relay bot messages require `allowBots: true` + relay bot user ID in `users` allowlist (`openclaw.json`)
- [x] Separate Discord bot ("ClawSuite-Relay") — OpenClaw drops its own bot's messages

### Remaining work (Phase 1 blockers)
- [ ] **PRIMARY BLOCKER: Switch capture to `llm_output` hook.** Previous approaches (`agent_end` + message parsing, `before_message_write`) produced inconsistent results — sometimes channel-visible text, sometimes correct assistant text. The `llm_output` hook provides `assistantTexts: string[]` pre-extracted, and the relay should forward only the last entry (`assistantTexts[assistantTexts.length - 1]`), matching what the completion announce delivers. This keeps the orchestrator's context clean for cross-agent synthesis. See `layer-disambiguation.md`.
- [ ] **Relay envelope visibility** — relay bot's forwarded message visible to human in #general. Needs auto-delete of relay bot's OWN forwarded message (not other messages). GPT's prior attempt deleted the wrong message (CEO's prompt to #tech) and cascaded into losing the loop.
- [ ] **Suppress redundant transient announce** — code exists (`shouldSuppressTransientGeneralAnnounce`) but NEVER tested live (Test C in runbook).
- [ ] **Fail-loud path** — code exists (`UnconfiguredForwardTransport` throws) but NEVER tested live (Test D in runbook).
- [ ] **Live validation matrix** — `test-validation-plan.md` minimum v1 tests mostly unchecked.

### Deferred to post-Phase 1
- Forward payloads >2000 chars — needs message splitting in `DiscordForwardTransport`. Not blocking Phase 1 completion.

### Acceptance
- [x] Dispatch post path verified (orchestrator → #tech, marker present)
- [ ] **Capture + forward delivers last assistant message to orchestrator** — requires switching to `llm_output` hook. Previous hooks produced inconsistent results. See `layer-disambiguation.md` for target definition.
- [ ] Suppression path verified (redundant announce cancelled) — NOT TESTED LIVE
- [ ] Fail-loud path verified (misconfigured transport → explicit failure) — NOT TESTED LIVE
- [ ] Relay envelope not visible to human in orchestrator channel — BLOCKED on auto-delete

## Milestone 2 — Reliability & Fail Loudly
- [ ] Timeout handling
- [ ] Explicit operator-facing failure messages
- [ ] No silent fallback path
- [ ] Long-message strategy (split/segment prompts > Discord limit) — partially pulled into M1 as blocker

Acceptance:
- [ ] Injected failures are visible and recoverable

## Milestone 3 — Security + Observability
- [ ] Minimal permissions
- [ ] Sender validation
- [ ] Structured logging and grep playbook

Acceptance:
- [ ] Security checklist passes

## Milestone 4 — Optional Expansion
- [ ] Multi-subagent batching (if approved)
- [ ] Agent rollout expansion plan (CTO → CLO → additional subagents)
- [ ] Packaging for reuse

## Delivery Artifacts
- [ ] code
- [ ] updated runbook
- [ ] test evidence
- [ ] rollback guide
