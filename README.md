# ClawSuite Relay

Persistent inter-agent delegation for Discord-backed OpenClaw deployments.

ClawSuite Relay is an OpenClaw plugin for work that should stay in an agent's main Discord channel
session instead of disappearing into transient helper sessions.

It exists for a specific failure mode:

- one specialist hands work to another
- the handoff disappears into private orchestration
- the receiving agent loses continuity
- the operator loses the trail of who did what and why

Relay keeps that crossing visible. It dispatches into the target agent's own channel session, preserves correlation across the handoff, and returns the result through a traceable relay path.

Current implementation note:

- Relay is currently built for OpenClaw deployments that use Discord channels and webhooks as the
  relay surface
- the public docs should be read as describing that OpenClaw-plus-Discord shape, not a
  channel-agnostic orchestration framework

## What it is good for

- persistent specialist delegation
- readable operator oversight
- cross-model or cross-role work over multiple turns
- quality-control or review lanes
- round-robin and ping-pong patterns that need continuity instead of arbitrary queuing

For longer chains, segmented review loops, or persistent quality-control workflows, lightweight
workflow scaffolding can improve reliability. See [docs/soft-control.md](docs/soft-control.md).

## Canonical use cases

### 1. Continuous work across persistent lanes

One recurring pattern is to keep a workstream moving across two agents that share the same
workspace but keep separate channel sessions.

That gives you:

- continuity in the shared working files
- separate histories for the participating roles
- a visible handoff instead of invisible orchestration
- relief from trying to keep everything alive inside one overstretched turn

This can be implemented as true specialist-to-specialist delegation, but it does not require two
deeply different agents. In some deployments the second lane is mainly there to let the primary
agent continue naturally without stretching a single session until quality degrades.

### 2. Persistent quality-control lane

Another strong fit is a standing review or quality-control role.

Instead of spawning a disposable reviewer, Relay lets the reviewer work in its own persistent
channel, challenge the work, and send it back through a readable exchange.

That pattern works for:

- two-agent ping-pong review
- multi-agent round-robin critique
- cross-model checking where a different model is better at pressure-testing than initiating

The key distinction is that review becomes an ongoing role with continuity rather than a one-shot
subagent call.

## Example topology

The canonical example configuration uses named organizational roles:

- `ceo` as orchestrator
- `systems-eng` or `cto` as technical specialist
- `cfo`, `clo`, and other functional roles as additional specialists

That framing is intentional. It is one of the clearest ways to demonstrate why Relay matters.

It is still just an example topology. Your deployment can use any agent names and channel structure you want.

## Why not just use `sessions_spawn`?

OpenClaw's transient subagent flow is useful for one-shot parallel work.

Relay is for a different shape of task:

- the specialist should work in its existing channel context
- the handoff should stay visible
- the operator should be able to audit what happened
- the same specialist may need to respond again later without losing the thread

## Why not just use hooks or cron?

Hooks and cron can sequence work, but they do not by themselves provide a persistent organizational
lane for the receiving agent.

That matters when the receiving role needs:

- its own ongoing session history
- its own channel or operator-visible work surface
- back-and-forth rather than fire-and-forget delivery
- continuity strong enough to preserve review, authority, or caution across turns

If the only problem is "run the next thing after this thing," hooks may be enough. Relay is for
cases where sequencing is not the hard part; preserving identity, continuity, and visible handoff
is.

## Soft control for long chains

Some relay patterns work out of the box with little extra structure. Others benefit from explicit
workflow discipline once the chain gets long or stateful.

Observed in practice:

- model families vary in how well they maintain relay discipline across long chains
- segmented review and ping-pong workflows are more reliable when scope, ownership, and return
  shape are explicit
- this is workflow guidance, not a transport requirement

See [docs/soft-control.md](docs/soft-control.md) for a reusable control pattern that separates
Relay mechanics from task-specific protocol overlays.

Planned next step:

- a user-owned control-file injection surface for long-chain workflows, allowing Relay to attach
  operator-defined control headers or workflow envelopes at dispatch time

Conceptually, this plays a role similar to `SOUL.md` or other workspace guidance files: the user
owns the text, Relay applies it consistently, and the default state can be blank or absent. The
goal is to make high-discipline relay patterns more reliable without turning the control layer into
hidden behavior. This is intended to be explicit, inspectable, and opt-in.

## Current installation model

This repo is currently a **clone-and-install local plugin** for OpenClaw.

It is not yet published as an npm package. The expected path today is:

1. clone the repo
2. install dependencies
3. install it into OpenClaw as a local plugin
4. configure Discord webhook and channel mapping

## Quickstart

See [docs/quickstart.md](docs/quickstart.md) for the public setup path.

Minimal development commands:

```bash
npm install
npm run typecheck
npm test
npm run build
```

## What the plugin does

ClawSuite Relay wires three main behaviors into OpenClaw:

- `relay_dispatch` tool registration for orchestrator-side dispatch
- outbound dispatch posting into mapped Discord channels
- return-path capture and delivery back to the orchestrator session

Operationally, that supports patterns like:

- dispatch to a specialist
- visible approval / restart / confirmation loops
- round-robin review between multiple agents
- cross-model continuous work without throwing away specialist context

## Key behaviors

### Dispatch correlation

Each accepted dispatch receives a `dispatchId`. That ID is used internally to correlate:

- the original relay request
- the armed target state
- the captured response
- the orchestrator-side delivery

### Dispatch semantics

- `requestId` should be unique per intended relay step
- reusing a live `requestId` now fails closed with `DISPATCH_IN_FLIGHT`
- stale replayable dispatches can expire instead of matching forever
- missing source identity/profile fails loudly instead of posting under generic relay branding

### Source identity

Per-origin identity is driven by `CLAWSUITE_RELAY_SOURCE_PROFILE_MAP_JSON`.

In practical terms, if an agent is expected to dispatch via Relay, it should have an explicit source profile. Current behavior fails closed rather than silently branding the post as generic `relay`.

## Known constraints

- Discord's message size limit can split long responses across multiple messages. If that happens, downstream model behavior may not always treat the sequence as a single coherent return. This should be treated as a current limitation, not a solved problem.
- Relay is stronger for continuity than cron-style sequencing, but stalled exchanges and long chains still need explicit monitoring and recovery strategy.
- Some of the most interesting use cases, including watchdog-assisted resume of broken ping-pongs or round robins, are still roadmap territory.

## Documentation map

- [docs/quickstart.md](docs/quickstart.md) — public setup path
- [docs/soft-control.md](docs/soft-control.md) — workflow discipline for long relay chains
- [technical-design-doc.md](technical-design-doc.md) — implementation contract and design constraints
- [implementation-plan.md](implementation-plan.md) — milestone history and remaining work
- [feature-backlog.md](feature-backlog.md) — backlog and follow-on ideas
- [design-decisions.md](design-decisions.md) — major trade-offs and rationale
- [assistant-text-analysis.md](assistant-text-analysis.md) — deep dive on assistant text capture surfaces
- [layer-disambiguation.md](layer-disambiguation.md) — analysis of relay surfaces and delivery semantics

Some of these documents still reflect the project's internal evolution and example topology. They are being cleaned up for broader public readability rather than treated as private by default.

## Public release status

Relay is already in active internal use.

This repo is being prepared for a proper public release:

- clearer public framing
- sanitized setup path
- public license
- tighter separation between public docs and internal operating notes

## License

Apache-2.0. See [LICENSE](LICENSE).
