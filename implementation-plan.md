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
- [ ] **`agent_end` hook captures full assistant text — NOT WORKING RELIABLY.** `extractCurrentTurnContent` exists and captured tool results in one simple test (CEO confirmed hostname visible), but in real-world tests the orchestrator still only receives channel-visible text, not the full assistant-layer content. This is the PRIMARY Phase 1 blocker. See dev-log.md "Handoff state" for details on what was tried and what failed.

### Deployment prerequisites (done)
- [x] Plugin tools require `tools.alsoAllow: ["relay_dispatch"]` in per-agent config (`openclaw.json`)
- [x] Relay bot messages require `allowBots: true` + relay bot user ID in `users` allowlist (`openclaw.json`)
- [x] Separate Discord bot ("ClawSuite-Relay") — OpenClaw drops its own bot's messages

### Remaining work (Phase 1 blockers)
- [ ] **PRIMARY BLOCKER: Orchestrator receives only channel-visible text, not full assistant text.** `extractCurrentTurnContent` captures tool results + assistant messages from the current turn in the `agent_end` messages array. It worked once for a trivial test (hostname visible to CEO). But in real-world tests with complex prompts, the orchestrator still only sees what the CTO posted to the Discord channel — not the underlying tool outputs, reasoning, or full assistant-layer content. This was the capability GPT reportedly achieved (with echo issues) but is not reliably working in the current code. The mechanism (`agent_end` + turn scoping + `toolResult` role + array content handling) is in place but the end-to-end result does not consistently deliver assistant text to the orchestrator. **This is why the handoff is happening.**
- [ ] **Relay envelope visibility** — relay bot's forwarded message visible to human in #general. Needs auto-delete of relay bot's OWN forwarded message (not other messages). GPT's prior attempt deleted the wrong message (CEO's prompt to #tech) and cascaded into losing the loop.
- [ ] **Suppress redundant transient announce** — code exists (`shouldSuppressTransientGeneralAnnounce`) but NEVER tested live (Test C in runbook).
- [ ] **Fail-loud path** — code exists (`UnconfiguredForwardTransport` throws) but NEVER tested live (Test D in runbook).
- [ ] **Live validation matrix** — `test-validation-plan.md` minimum v1 tests mostly unchecked.

### Deferred to post-Phase 1
- Forward payloads >2000 chars — needs message splitting in `DiscordForwardTransport`. Not blocking Phase 1 completion.

### Acceptance
- [x] Dispatch post path verified (orchestrator → #tech, marker present)
- [ ] **Capture + forward delivers ASSISTANT TEXT to orchestrator** — NOT WORKING RELIABLY. Tool results appeared in one simple test but complex responses still only show channel text. This is the primary acceptance gap.
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
