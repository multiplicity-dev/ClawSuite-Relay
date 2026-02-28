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

## Prerequisite: Create a second Discord bot

ClawSuite-Relay requires a **separate Discord bot** from the main OpenClaw bot. OpenClaw unconditionally filters its own messages (self-message filter), so a second bot identity is needed for relay messages to be visible to subagent sessions.

1. Go to https://discord.com/developers/applications → "New Application"
2. Name it (e.g., "ClawSuite-Relay")
3. Go to Bot tab → "Reset Token" → copy the token
4. Go to OAuth2 → URL Generator → select `bot` scope → set permissions to `2048` (Send Messages)
5. Use the generated invite URL to add the bot to your Discord server
6. Decode the bot's user ID for config: `echo -n "<token_prefix_before_first_dot>" | base64 -d`

The relay bot appears with its own name and visual styling in Discord, which provides clear visual distinction between orchestrator relay dispatches and direct subagent messages.

## Discord transport wiring (env config)
Configure via environment variables (typically in a systemd drop-in):
- `CLAWSUITE_RELAY_BOT_TOKEN` — the **relay bot's** token (not the main OpenClaw bot token)
- `CLAWSUITE_RELAY_CHANNEL_MAP_JSON` — JSON map of `targetAgentId -> channelId`
- `CLAWSUITE_RELAY_ORCHESTRATOR_CHANNEL_ID` — orchestrator channel id for forwarded subagent responses and suppression scope
- `CLAWSUITE_RELAY_ENABLED` — `1` (default) or `0` to disable runtime hook behavior
- `CLAWSUITE_RELAY_ARM_TTL_MS` — armed dispatch TTL in milliseconds (default `1800000` / 30 minutes)

Example systemd drop-in (`~/.config/systemd/user/openclaw-gateway.service.d/clawsuite-relay.conf`):
```ini
[Service]
Environment=CLAWSUITE_RELAY_ENABLED=1
Environment=CLAWSUITE_RELAY_BOT_TOKEN=<relay_bot_token>
Environment=CLAWSUITE_RELAY_CHANNEL_MAP_JSON="{\"systems-eng\":\"1474868861525557308\"}"
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

The plugin registers a `relay_dispatch` tool, but OpenClaw requires explicit agent-level configuration for tool visibility and bot message handling.

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

### Bot message handling
The relay bot uses a separate Discord bot token. By default, OpenClaw ignores bot messages (`allowBots: false`). To allow the relay bot's messages to reach subagent sessions:
```json
{
  "channels": {
    "discord": {
      "allowBots": true,
      "allowFrom": ["<human_user_id>", "<relay_bot_user_id>"],
      "guilds": {
        "<guild_id>": {
          "users": ["<human_user_id>", "<relay_bot_user_id>"]
        }
      }
    }
  }
}
```
The relay bot's user ID can be decoded from its token: `echo -n "<token_prefix_before_first_dot>" | base64 -d`.

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
