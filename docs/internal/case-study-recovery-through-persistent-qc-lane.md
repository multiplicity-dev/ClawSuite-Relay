# Case Study: Recovery Through A Persistent QC Lane

Date: 2026-04-03
Status: internal proof note

## Claim

Relay is useful not only for ordinary delegation, but also for recovering work after a specialist
session fails.

In this episode, a failed CLO session was recovered through the Legal Assistant lane, and the same
lane then continued serving as standing QC without needing the operator to manually script every
step.

## What Happened

The CLO session became context-bloated during a planning+integration turn.

The important Relay-relevant sequence was:

1. Legal Assistant inspected the failing CLO session and recognized that the session was no longer
   executing despite still replying.
2. Legal Assistant generated a compact re-orientation packet for a fresh CLO session after gateway
   reset.
3. The new CLO session resumed work from that orientation instead of requiring a full manual
   re-brief.
4. After resuming, CLO independently dispatched back to Legal Assistant for a QC/planning
   challenge.
5. Legal Assistant returned a structured QC recommendation, and CLO incorporated it into the next
   execution-turn recommendation.

## Why This Matters For Relay

This is useful proof because the organizational behavior survived the reset.

The key point is not merely that a human could restart a session.
The key point is that Relay preserved a meaningful specialist relationship across the interruption:

- Legal Assistant could inspect and orient the work
- the handoff stayed visible
- CLO could continue using Legal Assistant as a standing quality-control lane
- the recovery did not collapse into one-off transient helper behavior

That is closer to persistent organizational continuity than to ordinary spawn-and-forget
delegation.

## Distinguish The Failure From The Relay Value

The underlying failure was broader than Relay:

- a long-running session became context-bloated and stopped executing real work reliably

That is not itself a Relay proof point.

The Relay proof point is what happened next:

- another persistent lane could inspect the state, orient a replacement session, and remain
  available as an active QC role

## Evidence Excerpts

Distilled sequence:

- Legal Assistant identified the failure pattern and said it had the needed context for
  re-orientation.
- After reset, Legal Assistant sent a compact orientation to the new CLO session, including:
  completed work, pending integration, and the next planning obligations.
- The new CLO resumed integration and planning work rather than starting cold.
- CLO then asked Legal Assistant to review the next-wave choice and Legal Assistant returned a
  structured QC response that influenced the next-turn recommendation.

## Best Use For This Note

- internal source for README proof excerpts
- source for a future public case-study paragraph
- source for a website proof trace about recovery and persistent QC lanes

## Caution

The raw exchange contains domain-specific legal-work context and failure-specific detail.

Public-facing proof should preserve the organizational behavior and recovery structure, not the
full operational transcript.
