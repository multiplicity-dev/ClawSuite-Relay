# RELAY-START.md (SOLE ENTRYPOINT)

This is the only document the systems engineer must read on session start.

**User prompt to trigger:** Read RELAY-START.md and proceed.

---

## The problem in one paragraph

The relay loop works: orchestrator dispatches to subagent channel, subagent responds, response is captured by plugin hooks, and forwarded back. But the forward path delivers content via a **Discord message** to #general. A Discord message can only carry channel-visible text. In normal `sessions_spawn`, the orchestrator receives assistant text via **internal injection** (`sessions_send` → `role: "user"` trigger message). The relay has no equivalent internal delivery path. Every hook optimization (capture side) was solving the wrong half — the **delivery side** is the missing piece.

## What must happen

Two paths, not one:
- **(a) Channel output** — subagent posts to its own channel (visible to president). The current mirror to #general is an artifact, not the goal.
- **(b) Internal delivery** — relay plugin delivers last assistant message text to orchestrator's session via internal mechanism (e.g., `sessions_send`), matching the completion announce. This is what the orchestrator actually works from.

The relay currently has only (a). Path (b) does not exist yet.

## What to capture and deliver

- **Capture:** `llm_output` hook → `event.assistantTexts[event.assistantTexts.length - 1]` (last entry = last assistant message).
- **Deliver:** Via internal path, not Discord. The payload should be framed like a completion announce trigger (subagent identity, dispatch correlation, result text, sessionKey for on-demand `sessions_history`).
- **Do not** forward the full `assistantTexts` array or `sessions_history` transcript. The orchestrator's context budget must stay clean for cross-agent synthesis.

## Why we got stuck

The capture hooks work. `llm_output`, `agent_end`, and `before_message_write` all fire and contain assistant text. But every captured payload was delivered via Discord message to #general — reducing it back to channel-visible content. Optimizing extraction logic could never fix a delivery transport problem.

---

## Mandatory reads on session start

1. **This file** (you're reading it).
2. **`facts-established.md`** — control state: goal, blocker, active step, hook ledger.
3. **`phase1-workflow.md`** — execution cadence, anti-duplication rules, per-change loop.

Then execute one cycle from the active step in `facts-established.md`.

## Read when needed (not every turn)

| Doc | When to read |
|---|---|
| `layer-disambiguation.md` | When confused about surfaces, delivery paths, or what the orchestrator receives. **Start here if the problem feels unclear.** Contains: four-surface model, missing vehicle analysis, transport question, verification test design. |
| `dev-log.md` | When reviewing evidence for a specific dispatch or test. Read only the newest relevant section. |
| `live-activation-runbook.md` | When doing restart, config, or smoke-test operations. |
| `implementation-plan.md` | When updating blocker/checklist status. |
| `relay-bot-plan.md` / `technical-design-doc.md` | When checking contract, spec, or architecture decisions. |
| `assistant-text-analysis.md` | When tracing OpenClaw source code for extraction functions or hook internals. |

## Reset recovery protocol

When starting fresh (compaction, session reset, new conversation):

1. Read this file.
2. Read `facts-established.md` and `phase1-workflow.md`.
3. Verify runtime/code state directly (do not rely on chat memory):
   - `git status --short`
   - `git rev-parse --short HEAD`
   - `grep CLAWSUITE_RELAY_ENABLED ~/.config/systemd/user/openclaw-gateway.service.d/clawsuite-relay.conf`
4. Summarize recovered state in one short status block.
5. Execute one cycle from the active step in `facts-established.md`.

## Guardrails

- No process-token invention.
- No asking user to choose document routing.
- No new hypothesis until current active step in `facts-established.md` is resolved.
- If blocked, report blocker + one proposed unblock action.
- If confused about what the orchestrator receives or why forwarded content matches channel text, read `layer-disambiguation.md` before changing code.
