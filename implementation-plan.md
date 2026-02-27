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
- [x] `agent_end` hook captures full current-turn content (`extractCurrentTurnContent`)

### Deployment prerequisites (done)
- [x] Plugin tools require `tools.alsoAllow: ["relay_dispatch"]` in per-agent config (`openclaw.json`)
- [x] Relay bot messages require `allowBots: true` + relay bot user ID in `users` allowlist (`openclaw.json`)
- [x] Separate Discord bot ("ClawSuite-Relay") — OpenClaw drops its own bot's messages

### Remaining work (Phase 1 blockers)
- [ ] **Forward payloads >2000 chars** — `extractCurrentTurnContent` captures full turn content but any substantive tool output exceeds Discord's 2000-char limit. Needs message splitting in `DiscordForwardTransport.forwardToOrchestrator`.
- [ ] **Relay envelope visibility** — relay bot's forwarded message visible to human in #general. Needs auto-delete of relay bot's OWN forwarded message (not other messages). GPT's prior attempt deleted the wrong message (CEO's prompt to #tech) and cascaded into losing the loop.
- [ ] **Suppress redundant transient announce** — code exists (`shouldSuppressTransientGeneralAnnounce`) but NEVER tested live (Test C in runbook).
- [ ] **Fail-loud path** — code exists (`UnconfiguredForwardTransport` throws) but NEVER tested live (Test D in runbook).
- [ ] **Live validation matrix** — `test-validation-plan.md` minimum v1 tests mostly unchecked.

### Acceptance
- [x] Dispatch post path verified (orchestrator → #tech, marker present)
- [x] Capture + forward path verified (subagent reply → orchestrator channel, tool outputs included)
- [ ] Suppression path verified (redundant announce cancelled) — NOT TESTED LIVE
- [ ] Fail-loud path verified (misconfigured transport → explicit failure) — NOT TESTED LIVE
- [ ] Forward works for substantive responses (>2000 chars) — BLOCKED on message splitting
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
