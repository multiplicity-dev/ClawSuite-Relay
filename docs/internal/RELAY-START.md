# RELAY-START.md (SOLE ENTRYPOINT)

This is the only document the systems engineer must read on session start.

**User prompt to trigger:** Read RELAY-START.md and proceed.

---

## Current state (2026-02-28)

The relay loop is complete. Both paths operational:
- **(a) Channel output** — subagent posts to its own channel (visible to president). No mirror to #general.
- **(b) Internal delivery** — relay plugin captures `assistantTexts[last]` via `llm_output` hook and delivers to orchestrator's session via `openclaw gateway call agent` (gateway injection). This matches the completion announce in native `sessions_spawn`.

Content parity with native `sessions_spawn` confirmed via source code trace. `assistantTexts[last]` is content-equivalent to what the completion announce delivers — thinking tokens stripped at every level, no provider-specific gating. Content richness comes from the CEO's prompting style, not from the transport.

## Architecture summary

```
President → #general → CEO processes → CEO calls relay_dispatch tool
                                    ↓
                            Tool factory captures CEO's sessionKey
                            Relay bot posts prompt to #it (mentions CTO)
                                    ↓
                            CTO responds in #it (main session, persistent)
                                    ↓
                            llm_output hook fires with assistantTexts[]
                                    ↓
                    ┌───────────────┴───────────────┐
                    ↓                               ↓
            (a) Channel output              (b) Gateway injection
            CTO's response stays            assistantTexts[last] →
            in #it (no #general mirror)     openclaw gateway call agent →
                                            trigger message injected into
                                            CEO's session as role: "user"
                                    ↓
                            CEO synthesizes in #general
```

## What the orchestrator receives (trigger message format)

```
[System Message] [relay-dispatch: <dispatchId>] Relay task for <agentId> completed.

Result:
<last assistant message text>

[relay_dispatch_id:<dispatchId>]
[relay_subagent_message_id:<subagentMessageId>]
[relay_subagent_session_key:<sessionKey>]

Reply based on the result above. If multiple relay tasks are outstanding, wait for all to complete before synthesizing.
```

The `sessionKey` metadata allows the orchestrator to call `sessions_history` on-demand for deeper context, matching the native `sessions_spawn` completion announce behavior.

## Key implementation files

| File | Role |
|---|---|
| `src/openclaw-plugin.ts` | Plugin entry: hooks (`llm_output`, `message_received`, `message_sending`), tool registration |
| `src/transport-gateway.ts` | Gateway injection transport: `buildRelayTriggerMessage`, `GatewayForwardTransport` |
| `src/relay-dispatch-tool.ts` | Tool factory: captures orchestrator's `sessionKey` at dispatch time |
| `src/index.ts` | `relay_dispatch` core logic: validation, state management, transport call |
| `src/state.ts` | Disk-persisted dispatch + armed dispatch state |
| `src/transport-discord.ts` | Discord relay bot transport (outbound prompt posting) |

## Reference docs (read when needed)

| Doc | When to read |
|---|---|
| `design-decisions.md` | Key design rationale and trade-offs. Start here to understand WHY the system works this way. |
| `envelope-research.md` | Agent message envelope standards survey. Read before designing or modifying the relay message format. |
| `layer-disambiguation.md` | When confused about surfaces, delivery paths, or content parity. Contains: four-surface model, content parity verification, test design. |
| `assistant-text-analysis.md` | When tracing OpenClaw source code for extraction functions or hook internals. |
| `dev-log.md` | When reviewing evidence for a specific dispatch or test. |
| `live-activation-runbook.md` | When doing restart, config, or smoke-test operations. |
| `implementation-plan.md` | When updating blocker/checklist status. |
| `relay-bot-plan.md` / `technical-design-doc.md` | When checking contract, spec, or architecture decisions. |

## Reset recovery protocol

When starting fresh (compaction, session reset, new conversation):

1. Read this file.
2. Read `facts-established.md`.
3. Verify runtime/code state directly (do not rely on chat memory):
   - `git status --short`
   - `git rev-parse --short HEAD`
   - `grep CLAWSUITE_RELAY_ENABLED ~/.config/systemd/user/openclaw-gateway.service.d/clawsuite-relay.conf`
4. Summarize recovered state in one short status block.
5. Check `implementation-plan.md` for remaining work items.

## Guardrails

- No process-token invention.
- No asking user to choose document routing.
- If blocked, report blocker + one proposed unblock action.
- If confused about what the orchestrator receives or content scope, read `layer-disambiguation.md` before changing code.
