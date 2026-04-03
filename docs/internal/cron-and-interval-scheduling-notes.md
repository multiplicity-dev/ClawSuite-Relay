# Cron And Interval Scheduling Notes

Status: draft
Audience: internal

## Purpose

This note captures the practical scheduling lessons from the relay cron/interval experiments.

It is not a generic cron tutorial.
It exists to explain:
- why some cadences were clean and others brittle
- where scheduler state becomes fragile
- why payload design and overlap behavior mattered more than first appeared

## Cron Basics

Cron expressions define fire times on a fixed grid of minutes, hours, and days.

Example:

- `15 */2 * * *` means "at minute 15 of every second hour"

The scheduler evaluates the expression against the current time and fires if the time matches.

Important property:

- cron itself is stateless
- the schedule is derivable from expression plus timezone
- no prior run history is needed to know the next expected fire time

## Why 15-Minute Cadence Worked Cleanly But 20-Minute Did Not

Cron expressions operate against the 60-minute hour boundary.

That means some intervals fit the cron grid naturally and others do not.

### 15-minute example

Fifteen divides evenly into sixty.

So the fire times map cleanly:

- `:00`
- `:15`
- `:30`
- `:45`

This makes a repeating 15-minute schedule easy to express with cron.

### 20-minute / 160-minute sequence problem

The problem was not "20 minutes" in isolation.
The problem was the larger repeating cycle being used.

If the full cycle is:

- `20 minutes × 8 slots = 160 minutes`

that cycle does not divide evenly into 60-minute hour boundaries.

So cron cannot naturally express:

- "every 160 minutes in this exact repeating sequence"

That forced the schedule into interval-based timing rather than grid-based timing.

## Interval Scheduling And State Fragility

Once the schedule moved to `every`-style interval timing, state became necessary.

Typical structure:

- `anchorMs` seeds the first fire
- `nextRunAtMs = lastRunAtMs + everyMs`

That creates a very different failure surface from cron.

### Why it is more fragile

- the next fire depends on prior run state
- restarts can shift or confuse the schedule
- stale history can poison future fire times
- old anchors can continue affecting behavior after the intended schedule has changed

In short:

- cron derives timing from the expression
- interval scheduling often derives timing from accumulated scheduler state

That is the key practical distinction.

## Stateless Payloads By Design

Each scheduled job sent only a short prompt such as:

- "Read `README.md`. This turn is execution."

The scheduler did not carry the full turn-sequence specification.

That was intentional.

### Why this was the right shape

It kept the scheduling layer simple while letting the agent read current control files at runtime.

Benefits:

- behavior can change by editing `README.md` rather than changing cron config
- jobs stay simple and mostly identical except for the turn-type tag
- the agent works from current state instead of stale instructions baked into the payload

This is a useful design rule:

- keep scheduler payloads minimal
- keep richer control logic in files the agent reads fresh

## Alternative: Agent-Tracked Turn Counter

Another possible design would be:

- one job every 15 minutes
- the agent keeps a turn counter in a state file
- the counter decides whether the current turn is execution, planning, integration, or reset

That would simplify scheduler configuration.

### Tradeoff

Benefits:

- one scheduled job instead of many
- simpler cron layer

Costs:

- the agent must reliably read, increment, and persist the counter every turn
- a failed turn can desynchronize the sequence
- correctness depends on agent cooperation rather than scheduler determinism

The multi-job approach kept the turn sequence deterministic at the scheduler layer with no agent cooperation needed for ordering.

## Overlap Behavior In OpenClaw Cron Jobs

The earlier interpretation here was too simple.

What actually matters in the current OpenClaw cron setup is that cron jobs are now spawn clones linked to a specific agent session.

If a scheduled fire arrives while the prior run for that linked agent is still active:

- the next run does not start in parallel
- the active run is not cancelled
- the new run queues behind the current one by default

So the practical behavior is:

- no parallel pile-up for the same linked agent
- no passive skip by default
- no destructive interruption by default
- delayed execution through queueing instead

### Practical effect

Worst case:

- a later slot waits behind a longer earlier slot
- timing drifts away from the ideal grid
- the work still runs, but later than the nominal fire time

This is a different tradeoff from skip-on-overlap.

It preserves work more aggressively, but it also means the nominal schedule can become a backlog rather than a strict cadence.

## `timeoutSeconds` Versus Queued Overlap

These mechanisms solve different problems.

### `timeoutSeconds`

- actively aborts the run
- can kill the agent mid-turn
- can interrupt file writes or other partial work

### Queued overlap

- does not kill anything
- does not start a second overlapping run in parallel
- keeps the later run waiting behind the active one

For this use case, queued overlap is much safer than destructive interruption.

The system default timeout remained the only backstop.

## `wakeMode: "now"` On Gateway Restart

This behavior is easy to misread if not documented.

When the gateway starts and a cron job's next fire time is already in the past:

- `wakeMode: "now"` causes it to fire immediately

That means a gateway restart can trigger a burst of jobs at once.

### Why this mattered

It explains why runs sometimes appeared at unexpected times after restarts.

This was not necessarily harmful because:

- linked-agent queueing prevented same-agent parallel pile-up

But it does mean restart behavior is part of scheduler interpretation, not just normal clock timing.

## WebSocket 500s And HTTP Fallback

The logs can make transport failures look worse than they are.

Observed behavior:

- the gateway tries WebSocket streaming first
- if that fails, it falls back to HTTP polling

So a WebSocket `500` in the logs does not necessarily mean the job failed.

Important distinction:

- transport-level errors are not always application-level failures

In the runs that looked failed here, the real disruption came from gateway restarts rather than provider transport errors.

## Practical Takeaways

### 1. Prefer cron when the schedule fits the grid

If the intended cadence aligns naturally with minute/hour boundaries, cron is cleaner and more robust than interval state.

### 2. Treat interval state as a real failure surface

If the schedule requires anchors, accumulated next-run state, or restart-sensitive timing, document and inspect that state explicitly.

### 3. Keep payloads minimal and let agents read current control files

This preserves flexibility and reduces scheduler brittleness.

### 4. Prefer passive overlap handling over destructive interruption when possible

Queued overlap is often safer than timeouts for long stateful turns, but it changes the meaning of the schedule because backlog can replace strict timing.

### 5. Interpret scheduler behavior together with restart behavior

Unexpected fire times are often restart artifacts, not "cron being wrong."

### 6. Do not overread scary transport logs

WebSocket failure messages may coexist with successful completion via fallback transport.

## Related Questions

- when should Relay itself grow stronger watchdog/recovery scheduling patterns?
- when should scheduler state live in files rather than process memory?
- which scheduling behavior belongs in public docs versus internal operational notes?
