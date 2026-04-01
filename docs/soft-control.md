# Soft Control for Long Relay Chains

Relay handles transport, channel delivery, and correlation.

That is necessary, but it is not always sufficient.

Once a workflow becomes long, stateful, segmented, or review-heavy, many teams benefit from adding
lightweight behavioral scaffolding on top of Relay. This document describes the durable control
patterns that emerged from real use without treating any one lab-specific protocol as mandatory.

## What this document is

This is guidance for workflows where success depends on discipline across multiple relay turns.

Examples:

- segmented review or quality-control loops
- translator and reviewer ping-pong
- continuous work passed between persistent lanes
- round-robin critique across multiple agents

## What this document is not

This is not:

- a transport requirement
- a claim that every Relay deployment needs formal protocol rules
- a task-specific template for legal, translation, or any other one domain

Many simple relay exchanges work fine without any extra scaffolding. Soft control becomes useful
when the cost of drift is higher than the cost of a little structure.

## Three layers to keep separate

### 1. Relay layer

Relay provides:

- dispatch into a target agent's own channel session
- visible handoff
- correlated return path

### 2. Workflow layer

Workflow discipline defines:

- how work is segmented
- who owns shared state
- what each turn is supposed to produce
- when drift should be rejected instead of tolerated

### 3. Task layer

Task-specific overlays define:

- domain rules
- glossary or terminology constraints
- case-specific file paths
- project-specific review criteria

Keep these layers separate. Otherwise local lab lore starts to look like a product requirement.

## Durable control patterns

### Plan first

For multi-step relay work, decide the execution shape before dispatching the first segment.

Useful artifacts:

- segment list
- ownership model
- tracker/checklist path
- completion rule

The point is not bureaucracy. The point is to stop the workflow from being redefined ad hoc in chat
every two turns.

### Keep boundaries explicit

If the plan defines Segment 03, dispatch Segment 03.

Do not quietly expand the scope to "also handle the next two while you're there." Long relay chains
become brittle when boundaries drift.

### Use file paths, not pasted payloads

When agents share a workspace, dispatches should usually reference files on disk rather than paste
large source content into chat.

That helps preserve:

- shared ground truth
- context budget
- traceability
- update safety when files evolve between turns

### Assign single-writer ownership

Shared state should have a clear owner.

Typical examples:

- one agent owns the tracker/checklist
- one agent owns the master output file
- review agents read and propose; integrating agents write

This prevents silent collisions and conflicting state narratives.

### Prefer one growing artifact over scattered fragments

For workflows that depend on accumulation in context, one master artifact is usually stronger than a
pile of per-segment outputs.

Examples:

- one growing translation file
- one evolving analysis memo
- one checklist that advances monotonically

This is especially useful when later turns need the earlier turns' integrated context.

### Lock the return shape

The receiving agent should know what kind of response the turn expects.

Examples:

- findings only
- approve / reject / revise
- structured review headings
- carry-forward notes
- explicit state confirmation

If every return packet has a different shape, integration gets unreliable.

### Make reject conditions explicit

Soft control works better when protocol drift is rejected clearly instead of half-followed.

Useful reject conditions include:

- scope exceeds the current segment
- required files or tracker are missing
- the dispatch asks for a different mode than the workflow expects
- the sender pasted a large payload when file-based review was assumed

Rejecting a malformed turn is often safer than producing a plausible but protocol-breaking answer.

### Add checkpoints and carry-forward discipline

Long chains benefit from periodic checkpointing:

- recurring terminology decisions
- unresolved ambiguities
- risk flags
- next-step state

Without checkpoints, later turns often re-litigate settled choices or forget why a constraint
exists.

## Observed model variance

In practice, model families vary in how well they maintain relay discipline across long chains.

Simple delegation may work well with little or no extra structure. Segmented review loops,
ping-pong workflows, and other sustained patterns tend to be more reliable when you specify:

- scope
- ownership
- return format
- reject conditions

This should not be read as a claim that any specific model will fail. It is a practical warning:
the more a workflow depends on behavioral consistency across many turns, the more value there is in
lightweight control scaffolding.

## When to add soft control

Consider adding it when:

- turns start getting overloaded
- the same drift pattern appears repeatedly
- review agents start drafting instead of reviewing
- agents silently expand scope
- shared files are updated inconsistently
- you need a reliable audit trail for how the work advanced

## Minimal starter pattern

If you want a lightweight default, start with this:

1. Write a segmentation or turn plan.
2. Designate a single writer for the tracker and master artifact.
3. Dispatch by file path, not by pasted document payload.
4. Define the expected return shape.
5. Tell the receiving agent when to reject drift.

That is often enough to stabilize a long relay chain without turning the workflow into ceremony.
