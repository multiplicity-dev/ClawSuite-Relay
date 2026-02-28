# Implementation Plan — Relay Bot Initiative

Status: Milestone 1 — PRIMARY BLOCKER RESOLVED (capture + delivery working, polish items remain)

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
- [x] **Capture subagent's last assistant message via `llm_output` hook and deliver via gateway injection.** Implemented: `llm_output` → `assistantTexts[last]` → `GatewayForwardTransport` → `openclaw gateway call agent`. Verified live 2026-02-28. Content parity with native `sessions_spawn` confirmed via source code trace. See `layer-disambiguation.md` for the four-surface analysis.

### Deployment prerequisites (done)
- [x] Plugin tools require `tools.alsoAllow: ["relay_dispatch"]` in per-agent config (`openclaw.json`)
- [x] Relay bot messages require `allowBots: true` + relay bot user ID in `users` allowlist (`openclaw.json`)
- [x] Separate Discord bot ("ClawSuite-Relay") — OpenClaw drops its own bot's messages

### Remaining work (Phase 1 polish)
- [x] **~~PRIMARY BLOCKER:~~ Capture + delivery via `llm_output` + gateway injection.** RESOLVED 2026-02-28. `llm_output` → `assistantTexts[last]` → `openclaw gateway call agent` → trigger message in orchestrator session. Content parity with native `sessions_spawn` confirmed.
- [x] **~~Relay envelope visibility~~** — RESOLVED by architecture change. No Discord mirror to #general. Subagent output stays in subagent channel (path a). Orchestrator receives via gateway injection (path b). No envelope to auto-delete.
- [ ] **Suppress redundant transient announce** — code exists (`shouldSuppressTransientGeneralAnnounce`) but NEVER tested live (Test C in runbook).
- [ ] **Fail-loud path** — code exists (`UnconfiguredForwardTransport` throws) but NEVER tested live (Test D in runbook).
- [ ] **Live validation matrix** — `test-validation-plan.md` minimum v1 tests mostly unchecked.

### Deferred to post-Phase 1
- Forward payloads >2000 chars — needs message splitting in `DiscordForwardTransport`. Not blocking Phase 1 completion.

### Acceptance
- [x] Dispatch post path verified (orchestrator → #tech, marker present)
- [x] **Capture + forward delivers last assistant message to orchestrator** — `llm_output` → gateway injection. Verified live 2026-02-28.
- [ ] Suppression path verified (redundant announce cancelled) — NOT TESTED LIVE
- [ ] Fail-loud path verified (misconfigured transport → explicit failure) — NOT TESTED LIVE
- [x] ~~Relay envelope not visible to human in orchestrator channel~~ — N/A, no Discord mirror to #general

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
