# Control-File Injection Plan

Date: 2026-04-01
Status: active design direction

## Purpose

Make long-chain soft control more reliable by letting users define control text in files that Relay
can attach automatically at dispatch time.

This is the planned evolution from manual per-message protocol headers to a user-owned, explicit,
inspectable control surface.

## Concept

The intended operator experience should rhyme with persistent guidance files such as `SOUL.md` or
`TOOLS.md`:

- the user owns the text
- the file can be absent or blank by default
- if present, Relay carries it consistently
- the mechanism remains visible to the operator

The implementation is different: this is Relay-side dispatch augmentation, not OpenClaw workspace
injection.

## Design goals

- user-owned, not Relay-authored
- opt-in, not universal
- blank or absent by default
- visible and inspectable
- simple MVP first
- extensible to named profiles and route-specific overlays later

## Preferred rollout

### MVP

Support one optional control file, for example:

```text
relay/
  CONTROL.md
```

Behavior:

1. If the file is absent or blank, Relay behaves exactly as it does now.
2. If the file is present and non-empty, Relay prepends a labeled control block to the dispatch.
3. Relay logs that the file was attached.

### Next step

Add named profiles:

```text
relay/
  CONTROL.md
  patterns/
    qc-review.md
    pingpong.md
    continuous-work.md
```

### Later, only if needed

Add route-specific overlays:

```text
relay/
  routes/
    clo__translator.md
    ceo__systems-eng.md
```

## Guardrails

- no file, no behavior
- preserve clear authorship: the user wrote the text, Relay attached it
- keep the attachment visible in outbound messages and logs
- do not bake one internal lab protocol into the plugin
- do not silently mutate the task body beyond additive control text

## Public framing

Describe this as:

- user-owned control files
- optional dispatch augmentation
- explicit workflow scaffolding for high-discipline relay patterns

Avoid framing that makes it sound like hidden prompt manipulation.
