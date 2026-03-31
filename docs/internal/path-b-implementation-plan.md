# Path (B) Implementation Plan — Internal Delivery via Gateway Injection

## Takeaway

The relay captures assistant text but delivers it via Discord message — which can only carry channel-visible text. Normal `sessions_spawn` delivers via internal session injection (`callGateway({ method: "agent" })`). This plan adds the missing internal delivery path.

**Target**: Inject the **last assistant message** into the orchestrator's session via `callGateway({ method: "agent" })`, matching what `sendSubagentAnnounceDirectly` does natively. See `layer-disambiguation.md` for the full "missing vehicle" analysis.

---

## Two-path model (recap)

- **(a) Channel output** — subagent posts to its own channel (visible to president). Already works.
- **(b) Internal delivery** — relay delivers last assistant message text to orchestrator's session via gateway injection. **This is what we're building.**

Both paths run independently. Failure of (b) does not block (a).

---

## Technical foundations

### `llm_output` hook — fires once per agent run

Source: `pi-embedded-NV2C9XdE.js:79339`. Fires AFTER `agent_end`, once per run (not per LLM call). Provides:
- `assistantTexts: string[]` — all accumulated model text
- `lastAssistant` — the actual last assistant message object
- Context: `{ agentId, sessionKey, sessionId }`

We use `assistantTexts[assistantTexts.length - 1]` — the last entry, matching completion announce behavior.

### `callGateway({ method: "agent" })` — session injection

Source: `subagent-registry-C6qDcjAh.js:73431`. The same mechanism `sendSubagentAnnounceDirectly` uses:
```
callGateway({
  method: "agent",
  params: {
    sessionKey: <orchestrator's session key>,
    message: <trigger text>,
    deliver: false  // internal only, no Discord post
  }
})
```

The `callGateway` function is exported from `plugin-sdk/gateway/call.d.ts`. URL defaults to `ws://127.0.0.1:18789`, token from `OPENCLAW_GATEWAY_TOKEN` env or `~/.openclaw/openclaw.json`.

### `OpenClawPluginToolFactory` — captures orchestrator context

Source: `plugin-sdk/plugins/types.d.ts:58-68`. When `registerTool` receives a function instead of a static tool, OpenClaw calls it with `OpenClawPluginToolContext` containing `sessionKey`, `agentId`, etc. The orchestrator's `sessionKey` is available because the orchestrator is the caller of `relay_dispatch`.

---

## Implementation steps

### Step 1. Extend `ArmedDispatchRecord` with orchestrator session key

**File**: `src/state.ts`

Add `orchestratorSessionKey?: string` to `ArmedDispatchRecord`. Update `setArmedDispatch()` to accept and persist it. This carries the orchestrator's identity from dispatch time to delivery time.

### Step 2. Switch `relay_dispatch` tool to factory pattern

**Files**: `src/relay-dispatch-tool.ts`, `src/index.ts`, `src/openclaw-plugin.ts`

- **`relay-dispatch-tool.ts`**: Export factory function. Factory receives `ctx.sessionKey` and passes it through.
- **`index.ts`**: Add `orchestratorSessionKey?: string` to `RelayDispatchDeps`. Pass to `setArmedDispatch()`.
- **`openclaw-plugin.ts`**: Change `api.registerTool(createRelayDispatchTool(...))` to pass the factory.

### Step 3. Create gateway forward transport

**New file**: `src/transport-gateway.ts`

- Import `callGateway` from the installed OpenClaw package
- `GatewayForwardTransport` implements `ForwardTransport`
- `buildRelayTriggerMessage()` formats like a completion announce:
  ```
  [System Message] [relay-dispatch: <dispatchId>] Relay task for <agentId> completed.

  Result:
  <last_assistant_text>

  [relay_dispatch_id:<dispatchId>]
  ```
- `deliver: false`, `expectFinal: false` (fire and forget)

### Step 4. Add `llm_output` hook as primary capture + delivery

**File**: `src/openclaw-plugin.ts`

```
llm_output handler:
  1. Check relayEnabled, resolve agentId from ctx
  2. Check if agentId is in channelMap (is a relay target)
  3. Load armed dispatch (with TTL check)
  4. Extract assistantTexts[last] from event
  5. Path (a): Discord forward via captureOutboundResponse
  6. Path (b): If armed.orchestratorSessionKey exists → GatewayForwardTransport.forwardToOrchestrator()
  7. Disarm dispatch
```

### Step 5. Gate `agent_end` hook behind env flag

**File**: `src/openclaw-plugin.ts`

Wrap existing `agent_end` handler with `CLAWSUITE_RELAY_USE_AGENT_END_FALLBACK=1` check. Default: off.

### Step 6. Verify `callGateway` import resolution

Test bare import first. Fallback: dynamic import with absolute path `/usr/lib/node_modules/openclaw/dist/plugin-sdk/gateway/call.js`.

---

## Files modified

| File | Change |
|---|---|
| `src/state.ts` | Add `orchestratorSessionKey` to `ArmedDispatchRecord` |
| `src/relay-dispatch-tool.ts` | Switch to factory pattern |
| `src/index.ts` | Pass `orchestratorSessionKey` through deps |
| `src/openclaw-plugin.ts` | Add `llm_output` hook, dual delivery, gate `agent_end`, use factory |
| `src/transport-gateway.ts` | **New** — `GatewayForwardTransport`, trigger message builder |
| `tsconfig.json` | Possibly add OpenClaw import paths |

## Key source references

| Reference | Location |
|---|---|
| `OpenClawPluginToolFactory` | `plugin-sdk/plugins/types.d.ts:68` |
| `OpenClawPluginToolContext.sessionKey` | `plugin-sdk/plugins/types.d.ts:58-63` |
| `callGateway` export | `plugin-sdk/gateway/call.d.ts:63` |
| `llm_output` hook firing | `pi-embedded-NV2C9XdE.js:79339` |
| `sendSubagentAnnounceDirectly` | `subagent-registry-C6qDcjAh.js:73431` |
| `ForwardTransport` interface | `src/forward.ts:12` |

## Verification

1. **Build**: TypeScript compiles including `callGateway` import
2. **Integration**: Restart gateway → trigger dispatch → journal shows:
   - `llm_output` hook fired
   - `gateway.forward.delivered` log
   - Orchestrator session receives trigger message
   - Discord channel still shows subagent output (path a intact)
3. **Discriminating test**: Task subagent with reasoning problem; check if orchestrator's response betrays knowledge of the reasoning (confirms internal delivery carries more than channel-visible text)

## Risks

| Risk | Mitigation |
|---|---|
| `callGateway` import fails at runtime | Fallback to dynamic import with absolute path |
| `method: "agent"` rejects relay messages | Format trigger to match completion announce pattern |
| Orchestrator sessionKey stale at delivery time | Log warning, fall back to Discord-only; future: resolve via `sessions.list` |
