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

**Ideal**: Clear context between tests entirely (fresh sessions). When that's impractical, run in ascending order of explicitness — this controls for carryover effects without requiring isolation. The sequence reversal is a practical mitigation, not a substitute for true independence.

**Context clearing options** (strongest to weakest):
- Fresh agent session — full isolation, no carryover
- New conversation within same session — partial isolation, system prompt persists
- Ascending explicitness within same conversation — controls direction of contamination but doesn't eliminate it

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

### 8. Use naive subjects for generalization

A behavior observed in one agent may not generalize. An agent that has been repeatedly prompted to use a tool ("relay this to CTO") is a **primed subject** — its behavior tells you about learned compliance, not natural tendency.

To test whether a behavior generalizes:
- Introduce a **naive subject**: an agent with no prior exposure to the feature being tested
- The naive agent should have only the standard configuration (soul.md, tool availability) — no conversational history mentioning the feature
- Compare naive behavior to primed behavior to separate tool adoption from instruction compliance

**Example**: Testing whether agents naturally use `relay_dispatch` vs `sessions_spawn`. The CEO has been explicitly told "relay this" dozens of times — it's contaminated. A newly relay-bound agent (e.g., CLO) with only a soul.md mention provides a clean read on natural tool selection.

### 9. Pilot before committing

Run a lightweight version of the test before investing in the full protocol. Pilot testing reveals:
- Whether the observation surfaces actually capture the evidence you need
- Whether the confederate instructions produce the intended behavior
- Whether the test design has confounds you didn't anticipate

Pilots are cheap. Redesigning a contaminated full test is expensive — especially with persistent agents where you can't easily reset context.

### 10. Generalize across subjects and conditions

A single positive result from one agent in one context is an anecdote, not a finding. To establish that a behavior is robust:
- Test with multiple agents (different roles, different system prompts)
- Test under varied conditions (different task types, different phrasing)
- Test at different points in session lifetime (fresh session vs deep conversation)

Agentic systems make this easier than human experiments in one respect: you can spin up new agents cheaply. But they make it harder in another: each agent has a unique system prompt and accumulated context that creates uncontrolled variation.

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

## Case study: Propensity testing with contaminated subjects and behavioral coordination

### Context

After generalizing ClawSuite-Relay from single-agent to 12 agents, two questions needed answers:

1. **Tool selection propensity**: Does the CEO naturally use `relay_dispatch` for relay-bound agents, or drift to `sessions_spawn`?
2. **Multi-dispatch coordination**: Can the CEO track and synthesize results from multiple parallel relay dispatches without scripted infrastructure?

### The contamination problem (principles 3, 8)

The CEO was heavily contaminated as a test subject for propensity:
- It had spent an entire session developing and testing the relay
- It had been explicitly told "relay this to CTO" dozens of times
- It had **self-edited its own TOOLS.md** to list all 12 relay-bound agents — before being asked to

When prompted "Ask CLO to review the README for IP/licensing concerns" (no mention of relay), the CEO immediately used `relay_dispatch`. But this tells us about learned compliance, not natural tendency.

The CEO's self-report when asked why:
> "I used relay because we've been testing it all morning, it was top of mind, and CLO is one of the relay-bound agents listed in my TOOLS.md. I didn't consciously weigh relay vs spawn. I just reached for relay."

This is principle 3 (contamination) in action. The CEO acknowledges it didn't reason about the choice — it defaulted based on recency and priming. The test measured habit formation, not tool preference.

**Lesson**: Self-report from a contaminated subject can be informative about the *mechanism* of contamination (recency, task salience, reference material) even when the behavioral outcome is non-discriminating. But it cannot substitute for naive-subject testing.

**Next step**: Test with agents who have relay in their `tools.alsoAllow` and soul.md documentation but zero prior relay conversation history. This is the acid test for whether TOOLS.md documentation alone is sufficient to drive tool adoption.

### The coordination surprise (principles 1, 7)

The multi-dispatch tests produced an unexpected finding. The scripted fan-in coordination feature (backlog K) was planned because "wait for all results" text instructions were assumed unreliable. Live testing showed otherwise:

| Test | Dispatches | Result |
|---|---|---|
| Doctor + Trainer (parallel) | 2 | Both returned, CEO reported incrementally |
| Life-coach + Security (sum of random numbers) | 2 | CEO held synthesis until both returned, summed correctly |
| PR + Marketing + Biographer + Learning (5th word alphabetically) | 4 | All returned within seconds, CEO extracted, sorted, reported correctly |

The CEO tracked dispatch IDs across async system messages and made correct coordination decisions — reporting partial results when appropriate, holding synthesis when the task required all inputs.

**Analysis through principle 7 (architecture vs behavior):**

The original assumption was architectural: "soft instructions are unreliable, we need a coded synchronization primitive." Live testing showed the behavior is robust — the CEO coordinates multiple async results using conversational awareness of dispatch IDs.

This doesn't mean scripted fan-in is worthless. It means the **threshold** for needing it is higher than expected. Behavioral coordination works for:
- Up to 4 parallel dispatches (tested)
- Tasks where the synthesis requirement is clear from the prompt
- An orchestrator with strong context tracking (long context window, good working memory)

It might fail for:
- Many more parallel dispatches (10+?)
- Complex dependency chains between dispatches
- Less capable orchestrator models
- Tasks where the synthesis requirement is ambiguous

**Lesson**: Don't build architectural solutions for behavioral problems until you've tested whether the behavior actually fails. The 4-way parallel test was a capability test (principle 1) for behavioral coordination — it confirmed capability, shifting fan-in from "needed" to "nice-to-have."

### Design observations

- **Contamination was unavoidable in context**: The CEO developed the relay — you can't un-prime it. The correct response is not to force a clean test on a dirty subject, but to defer to naive subjects and note the contamination explicitly.
- **Self-report has value even from contaminated subjects**: The CEO identified that it didn't reason about the choice, which reveals that relay adoption is driven by reference material (TOOLS.md) and recency, not deep evaluation. This informs the soul.md strategy: keep it prominent and simple.
- **Scaling tests are cheap and high-value**: Testing 1→2→4 parallel dispatches took 5 minutes and revealed that scripted fan-in may be unnecessary — avoiding potentially days of engineering work.
- **The "acid test" is deferred, not abandoned**: Naive subject testing is the clean measure. It requires: (a) adding `relay_dispatch` to other agents' `tools.alsoAllow`, (b) soul.md updates for those agents, (c) dispatching to them without any relay priming in the conversation.

---

## Checklist for designing agentic tests

1. **State the question precisely**: capability or propensity?
2. **Map observation surfaces**: where will evidence appear?
3. **Design for discrimination**: do different internal states produce different outcomes?
4. **Pilot first**: run a lightweight version before committing to the full protocol
5. **Control sequence effects**: run unprimed tests before primed tests; clear context when possible
6. **Brief confederates, blind subjects**: single-blind design
7. **Use concrete tokens**: arbitrary values as ground truth, unique per tier
8. **Use naive subjects**: test with agents that have no prior exposure to the feature
9. **Run fresh sessions when possible**: eliminate accumulated context
10. **Interpret in order**: confirm capability (Tier 1) before interpreting propensity (Tiers 2-3)
11. **Generalize**: test across multiple agents, conditions, and session states
12. **Classify the finding**: architectural (fix with code) or behavioral (fix with prompts)?
13. **Document the ladder**: record all tiers, expected outcomes, and actual results
