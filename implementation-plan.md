# Implementation Plan — Relay Bot Initiative

Status: Draft

## Milestone 0 — Design Freeze
- [x] Approve TDD
- [x] Approve failure semantics
- [x] Approve v1 scope

## Milestone 1 — Single-Subagent Relay (CTO only)
- [x] Relay dispatch contract + validation skeleton (`relay_dispatch`) with deterministic status codes
- [ ] Relay post to target channel
- [ ] Subagent response capture
- [ ] Forward to orchestrator
- [x] Basic correlation IDs (`dispatchId` lifecycle)
- [ ] Suppress redundant transient subagent completion announce in #general when relay mode is active

Acceptance:
- [ ] End-to-end flow passes in staging

## Milestone 2 — Reliability & Fail Loudly
- [ ] Timeout handling
- [ ] Explicit operator-facing failure messages
- [ ] No silent fallback path

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
