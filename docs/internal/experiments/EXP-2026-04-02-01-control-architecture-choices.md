# Experiment ID: EXP-2026-04-02-01
Status: Planned
Type: mixed
Date opened: 2026-04-02

## Question

Which control architecture choices most improve long relay-chain reliability without making the system too heavy or brittle?

## Why This Matters

This sits at the intersection of:

- product evolution
- practical operator reliability
- experimental analysis of agent/control behavior

It is exactly the kind of work that is currently easy to reduce to anecdote.

## Candidate Conditions

Possible conditions to compare:

- manual soft-control headers only
- persistent control-file injection
- route-specific control overlays
- minimal versus richer reject conditions
- single receiving lane versus shared-workspace second lane
- ping-pong QC versus no QC lane

## Constants

To be defined per run, but ideally:

- similar task complexity
- similar model pairings
- similar workspace structure
- similar stopping conditions

## Outcome Measures

Possible measures:

- total relay length before meaningful breakdown
- number of missed or malformed handoffs
- number of human corrections required
- protocol drift
- output usability at the end of the chain
- operator burden

## Procedure

Runs should be logged when the architecture is intentionally varied rather than changed casually.

## Runs

No structured runs logged yet.

## Observations

Current pre-structured state:

- evidence exists in lived use and notes
- not yet normalized into a run-based comparison format

## Preliminary Interpretation

No formal interpretation yet.

## Product Implications

This experiment is likely to influence:

- dispatch augmentation
- control-file design
- documentation for soft control
- relay defaults and examples

## Open Questions

- Which measures are realistic to capture consistently?
- How much qualitative judgment should remain acceptable?
- Which model pairs should be treated as representative?
