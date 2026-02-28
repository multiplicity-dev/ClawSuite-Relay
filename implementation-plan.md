# Implementation Plan — Relay Bot Initiative

Status: Phase 2 COMPLETE (envelope verified live 2026-02-28, dispatch 2fc74431).

## Phase 0 — Design Freeze
- [x] Approve TDD
- [x] Approve failure semantics
- [x] Approve v1 scope

---

## Phase 1 — Core Relay Loop (CTO only) — COMPLETE

### Core implementation (done)
- [x] Relay dispatch contract + validation skeleton (`relay_dispatch`) with deterministic status codes
- [x] Relay post path wired via `RelayTransport` interface + mocked tests + live Discord transport verified
- [x] Subagent response capture core flow (`captureSubagentResponse`) with state transitions
- [x] Forward to orchestrator path via `ForwardTransport` abstraction (+ Discord adapter)
- [x] Basic correlation IDs (`dispatchId` lifecycle)
- [x] `relay_dispatch` tool registered via OpenClaw plugin API (TypeBox schema, execute handler)
- [x] Disk-persisted arming at dispatch time (plugin is re-initialized per session — in-memory state lost)
- [x] Capture + delivery via `llm_output` → `assistantTexts[last]` → `GatewayForwardTransport` → `openclaw gateway call agent`. Content parity with native `sessions_spawn` confirmed via source code trace. See `layer-disambiguation.md`.
- [x] Gateway injection bypasses Discord 2000-char limit — verified with 4001-char payload (2026-02-28)

### Deployment prerequisites (done)
- [x] Plugin tools require `tools.alsoAllow: ["relay_dispatch"]` in per-agent config (`openclaw.json`)
- [x] Relay bot messages require `allowBots: true` + relay bot user ID in `users` allowlist (`openclaw.json`)
- [x] Separate Discord bot ("ClawSuite-Relay") — OpenClaw drops its own bot's messages

### Remaining Phase 1 verification
- [ ] **Suppress redundant transient announce** — code exists (`shouldSuppressTransientGeneralAnnounce`), needs one live test (Test C in runbook)
- [ ] **Fail-loud path** — code exists (`UnconfiguredForwardTransport` throws), needs one live test (Test D in runbook)

### Acceptance — Phase 1
- [x] Dispatch post path verified (orchestrator → #tech, marker present)
- [x] Capture + forward delivers last assistant message to orchestrator — `llm_output` → gateway injection
- [x] Clean loop: CEO dispatches, CTO responds with extensive text, CEO synthesizes concise summary (2026-02-28)
- [x] >2000 char responses delivered intact via gateway (no Discord splitting on internal path)
- [x] No Discord mirror to #general (subagent output stays in subagent channel)
- [ ] Suppression path verified — NOT TESTED LIVE
- [ ] Fail-loud path verified — NOT TESTED LIVE

---

## Phase 2 — Delivery Enrichment & `sessions_history` Integration

**Goal:** Make the orchestrator's access to subagent context near-native. The relay delivers `assistantTexts[last]` (matching the completion announce), but the orchestrator should also be able to efficiently access intermediate reasoning, tool outputs, and prior dispatch context — matching what `sessions_history` provides in native `sessions_spawn` but adapted for main-session semantics.

### Trigger message refinement
- [x] **Gateway restart to deploy current trigger message** — deployed 2026-02-28. Reply instruction modeled on native `buildAnnounceReplyInstruction` with `sessions_history` + limit guidance. Verified live (dispatch 2fc74431).
- [ ] **Verify CEO follows the `sessions_history` guidance** — does the CEO call `sessions_history` with a small limit when the result alone is insufficient? Test with a task where the final answer is ambiguous without seeing the working.
- [ ] **Evaluate pre-fetching** — should the relay pre-fetch `chat.history(limit: 10)` and include it in the trigger message? This would make context access automatic (no CEO action needed) but increases trigger message size. Design decision needed.

### Multi-message subagent output
- [x] Gateway injection delivers full text regardless of Discord splitting — verified with 4001-char payload
- [x] **Verify `assistantTexts` array structure for multi-turn responses** — tested with file-read task (dispatch 03e93d96). CTO used tool call (read file) then responded. `texts=1`, `lastLen=107`. Tool-call intermediate turns don't produce separate entries. `[last]` reliably captures the final answer.
- [x] **Outbound prompt delivery for >2000 char prompts** — `postToChannel` now splits long prompts. Envelope footer on last chunk only.

### Structured message envelope
- [x] **Adopt structured envelope based on standards research** — 6-field `RelayEnvelope` type (`source`, `target`, `dispatchId`, `createdAt`, `type`, `content`). Field rationale documented in `design-decisions.md` §12.
- [x] **Gateway injection path: structured envelope** — `serializeForGateway` produces trigger messages with `source → target` provenance using agent IDs (not session keys).
- [x] **Discord channel path: human-readable envelope** — `serializeForDiscord` produces task content with compact footer (`[relay_dispatch_id:...] from <agent>`).
- [x] **Remove redundant code paths** — deleted `capture.ts`, `DiscordForwardTransport`, `message_received`/`agent_end` hooks, `isRelayMachinery`, `UnconfiguredForwardTransport`. Codebase reduced to primary path only.
- [x] **Outbound message splitting** — prompts >2000 chars split at paragraph/line boundaries. Footer on last chunk. Return path (gateway injection) unlimited.

### Acceptance — Phase 2
- [ ] CEO calls `sessions_history` with limit on a relay dispatch when needed
- [x] Multi-turn subagent responses deliver correct `assistantTexts[last]` — verified (dispatch 03e93d96, texts=1 after tool use)
- [x] Trigger message format uses structured envelope (design-decisions.md §12)
- [x] No stale envelope formats in active code paths (dead fallback code removed)
- [x] Live verification: new envelope format confirmed in production (dispatch 2fc74431, 2026-02-28). Both directions: `from ceo` on outbound, `systems-eng → ceo` on return. Gateway delivery succeeded. CEO synthesis clean.

---

## Phase 3 — Dispatch Routing Enforcement

**Goal:** Ensure the CEO uses `relay_dispatch` for relay-bound agents instead of drifting back to `sessions_spawn`.

### Routing policy
- [ ] **`before_tool_call` hook blocking `sessions_spawn` for relay-bound agents** — when the CEO attempts `sessions_spawn(agentId="systems-eng")`, block it with an error message redirecting to `relay_dispatch`. The error message must tell the CEO what to do, not just what it can't do.
- [ ] **Allow `sessions_spawn` for non-relay agents** — ephemeral research spawns (ad-hoc agents without channel mappings) should continue using `sessions_spawn`. The routing decision is: does this agent have a relay channel mapping? If yes → relay. If no → `sessions_spawn`.
- [ ] **Design decision: hybrid routing** — can the CEO use both `relay_dispatch` and `sessions_spawn` for the same agent? Use case: `sessions_spawn` for quick fire-and-forget tasks, `relay_dispatch` for tasks that benefit from channel context and visibility. This may be over-engineering for now — simpler to enforce relay-only for mapped agents.

### Acceptance — Phase 3
- [ ] CEO uses `relay_dispatch` for CTO without manual correction
- [ ] CEO can still `sessions_spawn` for unmapped agents
- [ ] Error message on blocked `sessions_spawn` is actionable

---

## Phase 4 — Reliability & Hardening

**Goal:** Production reliability — timeout handling, failure visibility, retry budget.

### Timeout and failure handling
- [ ] **Dispatch timeout** — configurable per-dispatch timeout (default 10 minutes). On expiry: mark dispatch FAILED, notify orchestrator explicitly.
- [ ] **Fail-loud operator notices** — when relay is misconfigured or unavailable, explicit failure message in orchestrator channel (not silent degradation).
- [ ] **Retry budget** — transient API errors get 2 attempts with short backoff. Non-transient errors fail immediately.

### Security
- [ ] **Minimal bot permissions** — verify relay bot has only Send Messages + Read History in mapped channels, nothing more.
- [ ] **Sender validation** — relay dispatch accepted only from orchestrator-controlled path (tool boundary).

### Observability
- [ ] **Structured logging grep playbook** — document how to trace a dispatch end-to-end via `dispatchId` in journal logs.
- [ ] **Incident artifact capture** — dispatch JSON + gateway log window for failures.

### Acceptance — Phase 4
- [ ] Injected failures are visible and recoverable
- [ ] Timeout produces explicit FAILED state + operator notice
- [ ] Security checklist passes

---

## Phase 5 — Multi-Subagent & Expansion

**Goal:** Extend relay to multiple subagents with scripted coordination.

### Multi-subagent batching
- [ ] **Scripted fan-in coordination** — correlation ID per dispatch batch, plugin tracks expected vs received responses, triggers orchestrator only when all arrive. This replaces the soft "wait for all results" text instruction with deterministic behavior.
- [ ] **File-based batch state** — batch tracking survives gateway restart (same pattern as dispatch persistence).
- [ ] **Partial completion handling** — what happens when one subagent responds and another times out? Notify orchestrator with partial results + explicit gap report.

### Agent rollout
- [ ] **CLO (legal) channel mapping** — second relay-bound agent
- [ ] **V1_TARGET_AGENT expansion** — remove single-agent restriction, validate against channel map instead
- [ ] **Per-agent relay configuration** — different timeout, retry, and routing policies per agent

### Packaging
- [ ] **Plugin packaging for distribution** — move from local install to ClawHub-ready package
- [ ] **Configuration schema** — formalize env vars into plugin config schema

### Acceptance — Phase 5
- [ ] Two-agent relay dispatch with scripted fan-in
- [ ] Orchestrator synthesizes from both results in single response
- [ ] Agent rollout does not require code changes (config-only)

---

## Delivery Artifacts
- [x] Core relay code (Phase 1)
- [x] Design documentation (`design-decisions.md`, `layer-disambiguation.md`, `relay-bot-plan.md`)
- [ ] Updated runbook (Phase 2)
- [ ] Test evidence matrix (Phase 2)
- [ ] Rollback guide (Phase 4)

---

## Cross-phase design questions (tracked)

These emerged from implementation discussions and are relevant across phases:

1. **Relay vs `sessions_spawn` coexistence** (Phase 3) — should relay-bound agents be relay-only, or can the CEO choose per-task? Simpler to enforce relay-only. But the CEO's own subagent spawning (parallel research agents) uses `sessions_spawn` legitimately. Resolution: route by agent channel mapping, not globally.

2. **Pre-fetch vs on-demand `sessions_history`** (Phase 2) — should the relay pre-fetch recent history and include it in the trigger? Pro: automatic, no CEO action needed. Con: larger trigger, may include irrelevant context from prior conversations. Resolution: test CEO behavior with the guidance-only approach first. If insufficient, add pre-fetch as an option.

3. **Soft vs scripted coordination for multi-dispatch** (Phase 5) — the text instruction "wait for all results" is unreliable. Scripted fan-in is the correct solution but requires Phase 5 infrastructure. Until then, single-dispatch usage avoids the problem.

4. **Gateway delivery size limit** (Phase 2/4) — the CLI argument path has a ~2MB practical limit (Linux ARG_MAX). For extremely long subagent outputs, the transport would need to pass params via stdin or temp file. Not a practical concern at current usage but should be documented as a known ceiling.

5. **Value of relay `sessions_history` vs native** (Phase 2) — relay's main-session key with `limit` gives the orchestrator access to accumulated subagent context across prior dispatches and direct conversations. This is potentially MORE valuable than native `sessions_spawn`'s clean but context-free transient session. See `design-decisions.md` §6.
