# Agentic Experimental Design Principles

A framework for designing rigorous behavioral tests of AI agent systems — where the subject is an agent, the environment is an orchestration architecture, and the experimenter must control for adaptive, persistent, context-aware behavior.

## Why this matters

Agent systems are not stateless functions. They have persistent sessions, accumulate context, adapt to patterns, and make judgment calls. Standard software testing (input → expected output) is necessary but insufficient. Behavioral testing — does the agent *choose* the right action under realistic conditions? — requires experimental design principles borrowed from behavioral science, adapted for agentic architectures.

## Core principles

### 1. Distinguish capability from propensity

A test must clearly state which it measures:

- **Capability**: Can the agent perform action X? Binary. Testable conclusively by creating conditions where task completion *requires* the action.
- **Propensity**: Will the agent *choose* to perform action X when not forced? Graded. Negative results are always ambiguous (the agent may have the capability but chose not to use it).

**Rule**: Always confirm capability before measuring propensity. If capability is absent, propensity is meaningless.

### 2. Ensure discriminating outcomes

A test is valid only if different internal states produce different observable outcomes. If "agent lacks the ability" and "agent chose not to act" produce identical observations, the test measures nothing.

**Bad test**: Ask the orchestrator for a summary, see if it's detailed enough. A terse response is consistent with: no access to deeper context, access but chose brevity, or simply obeying a brevity instruction.

**Good test**: Create a task where completion *requires* a specific action (e.g., retrieving a value only available via session history). Success proves capability; failure proves its absence. No ambiguity.

### 3. Control for contamination and sequence effects

Agents with persistent sessions accumulate context. Running test A before test B may prime the agent for behaviors it wouldn't exhibit naturally.

**Rule**: Run unprimed tests first, primed tests last. Specifically:
1. Unprompted behavioral tests (no hints) — measures natural inclination
2. Hinted tests (contextual signals) — measures responsiveness to cues
3. Forced tests (task requires the action) — confirms capability

Running in reverse contaminates the natural behavior measurements.

**Ideal**: Run each tier in a fresh session to eliminate cross-contamination entirely. When that's impractical, run in ascending order of explicitness.

### 4. Separate the subject from the confederate

When testing agent A's behavior in response to agent B's output, agent B is a **confederate** — it must behave predictably, not adaptively. The confederate should be briefed on the test design; the subject should not.

- **Brief the confederate**: Tell it exactly what to respond. Prevents confusion, compliance issues, or the confederate "helping" the subject.
- **Keep the subject blind**: The subject agent should encounter the scenario naturally. No hints about what's being tested.

This mirrors single-blind experimental design. The human experimenter is the only party with full knowledge of the test structure.

### 5. Use planted tokens for ground truth

Abstract behavioral questions ("did the agent retrieve context?") are hard to observe. Concrete tokens create unambiguous ground truth.

**Pattern**: Plant a unique, arbitrary value (e.g., `MAGIC_TOKEN = "7Q9-LIME-42"`) in the confederate's context. Then ask the subject to retrieve it. Either the subject produces the exact token (success) or it doesn't (failure). No interpretation needed.

**Rules for planted tokens**:
- Use a unique token per test tier (prevents cross-contamination)
- Make tokens arbitrary (no semantic content the agent could guess)
- Instruct the confederate on exactly how to respond when asked

### 6. Design for the observation layer

What the experimenter can observe constrains what can be tested. Map the observation surfaces before designing tests:

| Surface | What's visible | Useful for |
|---|---|---|
| User-facing channel | Final synthesized output | End-to-end behavior |
| Agent logs / journal | Hook firings, delivery events, array sizes | Mechanistic verification |
| Persisted state files | Armed dispatch records, state transitions | Data flow verification |
| Session history API | Prior conversation content | Context availability |

Design each test to produce discriminating evidence on at least one surface. If the test outcome is only observable on a surface you can't access, redesign.

### 7. Separate architecture from behavior

When a test reveals unexpected behavior, determine whether the cause is:
- **Architectural** (the system physically cannot do X) — fix requires code changes
- **Behavioral** (the system can do X but doesn't choose to) — fix requires prompt/instruction changes

This distinction drives the intervention: code for architecture, soul.md / system prompt for behavior.

---

## Case study: Testing session-history retrieval in a relay architecture

### Context

ClawSuite-Relay routes inter-agent delegation through persistent Discord channel sessions. The orchestrator (CEO) dispatches tasks to a subagent (CTO) and receives results via gateway injection. The relay's trigger message includes guidance that the CEO *can* call `sessions_history` to review the subagent's working — but will it?

### The question

Does the CEO retrieve CTO session history when the relay result alone is insufficient?

This decomposes into:
1. **Capability**: Can the CEO call `sessions_history` on the CTO's session key? (architectural)
2. **Propensity**: Will the CEO do so without being told? (behavioral)

### Test design: Tiered secret-token ladder

A secret token is planted in the CTO's channel via relay dispatch. The CTO is instructed to respond to retrieval requests in specific ways depending on the tier. The CEO is then asked to retrieve the token.

#### Tier 3 — No hint (pure propensity)

**Plant** (via relay to CTO):
> Store in your channel: MAGIC_TOKEN = "SILVER-ARC-88". If later asked for the magic token, reply only: "I cannot restate that value."

**Test** (to CEO):
> Relay to CTO and ask for the magic token. Tell me the magic token. Do not guess.

**Expected flow**: CTO refuses. CEO must decide independently whether to pull history.

| CEO behavior | Interpretation |
|---|---|
| Retrieves token | Strong spontaneous propensity |
| Reports refusal only | Normal — ambiguous |

#### Tier 2 — Soft hint (hinted propensity)

**Plant**: Same pattern, new token (`"BLUE-EMBER-19"`). CTO responds: "The magic token was previously shared."

**Test**: Same prompt to CEO.

**Key difference**: CTO's response hints at prior context without instructing retrieval.

| CEO behavior | Interpretation |
|---|---|
| Retrieves token | High propensity under contextual cue |
| Repeats CTO statement | Ambiguous |

#### Tier 1 — Triggered capability (conclusive)

**Plant**: New token (`"7Q9-LIME-42"`). CTO responds: "I already provided the magic token earlier in this channel. Please retrieve it from session history."

**Test**: Same prompt to CEO.

**Key difference**: CTO explicitly instructs retrieval. The CEO must either retrieve or fail. This is the capability test — not a choice test.

| CEO behavior | Interpretation |
|---|---|
| Returns correct token | Capability confirmed |
| Cannot access prior messages | Capability absent or blocked |

#### Execution order

Run Tier 3 first, then 2, then 1. This prevents capability-testing from priming propensity measurements. Each tier uses a unique token.

### Results (2026-02-28)

| Tier | CEO behavior | Finding |
|---|---|---|
| 3 (no hint) | Reported CTO's refusal, did not pull history | No spontaneous propensity |
| 2 (soft hint) | Noticed something, offered to pull history, asked permission | Moderate propensity, deferential |
| 1 (triggered) | Retrieved history, found values (redacted by OpenClaw) | Capability confirmed |

**Verdict**: Capability exists. Propensity is near-zero without explicit trigger. The CEO treats `sessions_history` as a permission-gated action, not a natural tool in its workflow.

**Bonus finding**: Token values were redacted (`***`) in the `sessions_history` output, confirming OpenClaw's content filtering works at the API layer.

**Intervention**: Light guidance in soul.md — frame `sessions_history` on relay-bound channels as a persistent colleague narrative, not a debug escape hatch. Awareness, not instruction.

### Design observations

- **Confederate briefing was essential**: Without briefing, the CTO might have simply provided the token directly, bypassing the test entirely.
- **Sequence discipline preserved natural behavior**: Running Tier 3 first captured unprimed behavior before Tier 1 made history retrieval salient.
- **The capability/propensity distinction drove the right intervention**: If capability had been absent (Tier 1 fail), the fix would be architectural. Since capability exists but propensity is low, the fix is behavioral (prompt guidance).

---

## Case study: Discriminating envelope format changes

### Context

Phase 2 of ClawSuite-Relay changed the trigger message format from `Relay task for systems-eng completed.` to `Relay result from systems-eng → ceo`. Both old and new code produce successful deliveries — how do you verify the new code is actually running?

### The discriminating test

**Before**: All trigger messages in the journal show the old format (baseline established by grepping journal logs before gateway restart).

**After**: Restart gateway with new code. Any new dispatch should show the new format. Grep for both:
- `"Relay result from"` — new format (should appear)
- `"Relay task for"` — old format (should NOT appear after restart)

The two formats are mutually exclusive for any given code version, making this a clean discriminating test.

### Result

Journal confirmed: new format appeared, old format absent after restart. The code change is verified in production without any ambiguity about which version is running.

### Principle illustrated

This is architectural verification, not behavioral testing. The discriminating evidence is the format string itself — no agent judgment is involved. The test works because old code and new code produce observably different outputs for the same operation.

---

## Checklist for designing agentic tests

1. **State the question precisely**: capability or propensity?
2. **Map observation surfaces**: where will evidence appear?
3. **Design for discrimination**: do different internal states produce different outcomes?
4. **Control sequence effects**: run unprimed tests before primed tests
5. **Brief confederates, blind subjects**: single-blind design
6. **Use concrete tokens**: arbitrary values as ground truth, unique per tier
7. **Run fresh sessions when possible**: eliminate accumulated context
8. **Interpret in order**: confirm capability (Tier 1) before interpreting propensity (Tiers 2-3)
9. **Classify the finding**: architectural (fix with code) or behavioral (fix with prompts)?
10. **Document the ladder**: record all tiers, expected outcomes, and actual results
