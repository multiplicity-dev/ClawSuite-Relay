# ClawSuite-Relay

Persistent inter-agent delegation for OpenClaw.

OpenClaw gives agents persistent sessions — but `sessions_spawn` creates transient ones. The subagent forgets, the orchestrator can't audit, and the human sees only the synthesis. ClawSuite-Relay routes delegation through the subagent's main channel session, making inter-agent work persistent, transparent, and auditable — with zero additional token overhead.

## Project docs
- `relay-bot-plan.md` — architecture and rationale
- `technical-design-doc.md` — implementation contract + documentation policy
- `design-decisions.md` — key design rationale, trade-offs, and technical insights
- `envelope-research.md` — agent message envelope standards survey (A2A, AutoGen, IETF, MCP, CloudEvents)
- `layer-disambiguation.md` — four-surface model and content parity verification
- `implementation-plan.md` — milestones and acceptance gates
- `dev-log.md` — chronological decisions/evidence
- `test-validation-plan.md` — validation checklist and evidence format

## Development
```bash
npm install
npm run typecheck
npm test
npm run build
```

Current implementation status: Phase 2 complete, all-directional relay wired. All 13 agents can dispatch to any other via `relay_dispatch`. Naive subject propensity test passed — agents adopt relay from TOOLS.md policy on first contact without priming. Phase 3 (enforcement) likely unnecessary. See `implementation-plan.md` and `feature-backlog.md` for details.

## Prerequisite: Create channel webhooks

ClawSuite-Relay dispatch posting uses Discord incoming webhooks mapped per target channel.

1. Open each target Discord channel settings.
2. Integrations → Webhooks → create webhook.
3. Copy webhook URLs for env config.
4. Optionally set default name/avatar in webhook UI.

Per-message source identity can be overridden in code using `CLAWSUITE_RELAY_SOURCE_PROFILE_MAP_JSON` (`username` and `avatarUrl`).

## Discord transport wiring (env config)
Configure via environment variables (typically in a systemd drop-in):
- `CLAWSUITE_RELAY_WEBHOOK_MAP_JSON` — JSON map of `targetAgentId -> Discord webhook URL`
- `CLAWSUITE_RELAY_SOURCE_PROFILE_MAP_JSON` — optional JSON map of `sourceAgentId -> { username, avatarUrl }` for per-origin identity
- `CLAWSUITE_RELAY_ORCHESTRATOR_CHANNEL_ID` — orchestrator channel id for forwarded subagent responses and suppression scope
- `CLAWSUITE_RELAY_ENABLED` — `1` (default) or `0` to disable runtime hook behavior
- `CLAWSUITE_RELAY_ARM_TTL_MS` — armed dispatch TTL in milliseconds (default `1800000` / 30 minutes)

Example systemd drop-in (`~/.config/systemd/user/openclaw-gateway.service.d/clawsuite-relay.conf`):
```ini
[Service]
Environment=CLAWSUITE_RELAY_ENABLED=1
Environment=CLAWSUITE_RELAY_WEBHOOK_MAP_JSON="{\"systems-eng\":\"https://discord.com/api/webhooks/<id>/<token>\"}"
Environment=CLAWSUITE_RELAY_SOURCE_PROFILE_MAP_JSON="{\"ceo\":{\"username\":\"CEO\",\"avatarUrl\":\"https://example.com/ceo.png\"}}"
Environment=CLAWSUITE_RELAY_ORCHESTRATOR_CHANNEL_ID=1474838614197141729
```

## OpenClaw runtime hook wiring
This repo includes an OpenClaw plugin entrypoint (`index.ts` + `openclaw.plugin.json`) that wires:
- `llm_output` → **capture + delivery**: provides `assistantTexts: string[]` pre-extracted. Relay forwards the last entry via gateway injection, matching what the completion announce delivers in normal `sessions_spawn` workflows
- `message_sending` → announce suppression in orchestrator channel
- `relay_dispatch` tool → orchestrator can dispatch tasks to subagent channels

**Key findings from live testing and source analysis:**
- `llm_output` fires for embedded agent sessions (confirmed in `pi-embedded-NV2C9XdE.js`). Fires AFTER `agent_end`.
- OpenClaw deliberately limits the completion announce to the last assistant message — the orchestrator's context budget must stay clean for cross-agent synthesis. The relay matches this by forwarding only the last `assistantTexts` entry.
- `message_sending` does NOT fire for embedded agent responses.
- `before_message_write` only captures Discord-visible text (truncated), not full response.
- Plugin is re-initialized per agent session — in-memory state does not survive. Arming uses disk persistence.
- See `layer-disambiguation.md` for the four-surface analysis of OpenClaw's subagent output.

Typical local load path:
```bash
openclaw plugins install -l /home/dave/projects/ClawSuite-Relay
openclaw plugins enable clawsuite-relay
openclaw gateway restart
```

## OpenClaw config requirements (`openclaw.json`)

The plugin registers a `relay_dispatch` tool, but OpenClaw requires explicit agent-level configuration for tool visibility and webhook/bot message handling.

### Tool visibility
Each agent that should call `relay_dispatch` needs it in `tools.alsoAllow`:
```json
{
  "id": "ceo",
  "tools": {
    "alsoAllow": ["relay_dispatch"]
  }
}
```

### Webhook message handling
Relay dispatches are posted via Discord webhooks. OpenClaw typically ignores bot/webhook messages by default (`allowBots: false`). To allow relay dispatch messages to reach subagent sessions:

1. Set `allowBots: true` in the discord channel config.
2. Add each webhook's author ID to both `allowFrom` and guild `users`. The author ID is the first path segment of the webhook URL (e.g., `https://discord.com/api/webhooks/1477412870894518356/...` → ID is `1477412870894518356`).

```json
{
  "channels": {
    "discord": {
      "allowBots": true,
      "allowFrom": ["<human_user_id>", "<webhook_id_1>", "<webhook_id_2>", "..."],
      "guilds": {
        "<guild_id>": {
          "users": ["<human_user_id>", "<webhook_id_1>", "<webhook_id_2>", "..."]
        }
      }
    }
  }
}
```

Without the webhook IDs in both lists, OpenClaw silently drops webhook messages — dispatches appear in Discord but agents never process them.

## Dispatch ID correlation path
The `dispatchId` is the correlation key that links a dispatch to its result. It does not appear in Discord channel messages — correlation is handled internally:

1. **Orchestrator** receives the `dispatchId` from the `relay_dispatch` tool result
2. **Armed dispatch file** (disk-persisted) stores the `dispatchId` for the target agent
3. **`llm_output` hook** reads the armed file — no message-content parsing needed
4. **Gateway injection** includes `[relay_dispatch_id:...]` in the message delivered back to the orchestrator's session

Journal logs include `dispatch=<id>` at each step for end-to-end tracing.

## Resolved UX items
- **@mentions removed from relay dispatch posts:** relay messages are posted without user mentions.
- **Dispatch marker removed from Discord:** `[relay_dispatch_id:...]` no longer appears in channel messages. Footer now reads `from <agent>` — provenance preserved, noisy UUID dropped. Gateway-side markers unchanged (orchestrator needs them for correlation).
