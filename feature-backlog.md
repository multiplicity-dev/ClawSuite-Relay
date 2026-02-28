# Feature Backlog — ClawSuite-Relay

Prioritized list of pending work, from concrete to speculative. Created 2026-02-28 after Phase 2 completion.

## Completed

- [x] Core relay loop (dispatch → channel post → llm_output capture → gateway injection)
- [x] Structured envelope (RelayEnvelope, auto-derived agent ID provenance)
- [x] Dead code removal (454→197 lines in openclaw-plugin.ts)
- [x] Outbound message splitting (>2000 char Discord prompts)
- [x] Live verification: envelope format, multi-turn assistantTexts, gateway delivery
- [x] Content parity with native sessions_spawn confirmed
- [x] Agentic experimental design framework + session-history case study
- [x] **A. Multi-agent generalization** — removed `V1_TARGET_AGENT` hardcoded restriction, transport validates against channel map
- [x] **B. All 12 agents onboarded** — channel + mention maps configured, gateway restarted
- [x] **C. Soul.md updates** — CEO's TOOLS.md updated with all relay-bound agents, session keys, sessions_history guidance
- [x] **D. Propensity test** — CEO used relay_dispatch for CLO without prompting (contaminated — heavily primed). Clean test deferred to naive subjects.
- [x] **E. Announce suppression** — deleted. Speculative code that never fired; native completion announce doesn't trigger for relay-initiated embedded runs.
- [x] **Full system test** — all 12 agents dispatched and returned successfully, including 4-way parallel dispatch with synthesis (2026-02-28)
- [x] **Q. All-directional relay** — all 13 agents wired with `tools.alsoAllow: ["relay_dispatch"]`. CEO added to channel + mention maps (was missing, caused RELAY_UNAVAILABLE on inbound). Shared TOOLS.md content (Subagent Policy, Discord Channels, Session Keys) deployed to all 13 workspaces. Config-only, no code changes. (2026-02-28)
- [x] **Naive subject propensity test** — CEO dispatched to Life Coach ("message the life coach that this is just a test"). Life Coach received via relay and responded naturally. CEO used `relay_dispatch` without prompting — explained it was guided by TOOLS.md Subagent Policy loaded as project context. Key finding: OpenClaw injects workspace files (TOOLS.md, SOUL.md, etc.) on every turn, not just at session start. No new session or gateway restart needed for agents to pick up TOOLS.md changes — content is live immediately. This explains why all agents adopted relay dispatch on first contact after the wiring change. (2026-02-28)

---

## Tier 1 — Concrete, high-value

(Empty — all Tier 1 items completed.)

---

## Tier 2 — Valuable, needs design decisions

### F. Phase 3 routing enforcement (likely unnecessary)
Propensity test showed CEO defaults to relay without enforcement. Naive subject test (Life Coach) confirmed: agents follow TOOLS.md policy on first contact without priming. **Enforcement is almost certainly unnecessary.** Revisit only if an agent demonstrably ignores the policy under load.

### G. sessions_history pre-fetch (conditional on usage patterns)
Should the relay pre-fetch recent history and include it in the trigger message? Pro: automatic, no CEO action needed. Con: larger trigger, may include irrelevant context.

**Current state**: Guidance-only approach deployed. CEO propensity to use `sessions_history` is near-zero. If soul.md guidance doesn't increase propensity, pre-fetch becomes more attractive.

### H. Observability playbook
Document how to trace a dispatch end-to-end via `dispatchId` in journal logs. We've been doing this ad hoc — formalize the grep patterns, expected log events, and diagnostic workflow. Low effort, high value for incident response.

### I. @mention noise cleanup
Relay posts @mention the human user for routing, but this is unnecessary when `requireMention: false` is set. The mention map currently targets the human user, not the OpenClaw bot. Options:
- Remove mention entirely when requireMention is false
- Target the OpenClaw bot user ID instead
- Make mention behavior configurable per agent

### J. Dispatch marker visibility
`[relay_dispatch_id:...]` in channel messages is functional for correlation but noisy for casual reading. Could be moved to Discord embed metadata. Low priority — functional as-is.

### K. Scripted fan-in coordination (multi-dispatch)
Correlation ID per dispatch batch, plugin tracks expected vs received responses, triggers orchestrator only when all arrive. Replaces soft "wait for all results" instruction with deterministic behavior.

**Update (2026-02-28):** Live testing showed the CEO successfully coordinated 4 parallel dispatches behaviorally — tracking dispatchIds, reporting partial results, and synthesizing when all arrived. Scripted fan-in may be over-engineering for the current orchestrator. Revisit if behavioral coordination fails under stress or with less capable orchestrators.

### Q. All-directional relay (any agent → any agent) — COMPLETED
Moved to Completed section above (2026-02-28). All 13 agents wired, CEO added to maps, TOOLS.md deployed.

---

---

Everything above this line has concrete plans or is informed by observed behavior. The natural conclusion point for external sharing — the repo, docs, experimental design methodology, and architecture are presentable as-is (git, posts). Everything below is speculative.

---

## Tier 3 — Speculative, defer until needed

### L. Plugin packaging for external distribution
Move from local install (`openclaw plugins install -l`) to distributable package. Premature until API surface stabilizes.

### M. Dispatch timeout
Configurable per-dispatch timeout (default 10 minutes). On expiry: mark dispatch FAILED, notify orchestrator. Haven't hit timeout issues in practice.

### N. Retry budget
Transient API errors get 2 attempts with short backoff. Non-transient errors fail immediately. Current behavior: single attempt, fail-loud. Adequate for current usage.

### O. Per-agent relay configuration
Different timeout, retry, and routing policies per agent. Over-engineering until there are enough agents to warrant differentiation.

### P. Gateway delivery size limit mitigation
CLI argument path has ~2MB practical limit (Linux ARG_MAX). For extremely long subagent outputs, transport would need stdin or temp file. Not a practical concern at current usage.

---

## Dependencies

```
F (enforcement) likely unnecessary — naive subject test confirmed agents follow TOOLS.md policy
K (fan-in) may be unnecessary — behavioral coordination worked for 4-way parallel
Q (all-directional) DONE (2026-02-28)
```

---

## Selection criteria

When choosing what to work on:
1. **Does it address observed friction?** Prioritize over theoretical improvements.
2. **Does it enable testing?** (e.g., B enables D which validates/eliminates F)
3. **Is the design settled?** If a design decision is needed, resolve it before coding.
4. **Is it reversible?** Prefer changes that can be undone if wrong.
