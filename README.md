# ClawSuite-Relay

Relay-first orchestration bridge for OpenClaw.

Routes orchestrator delegation into subagent channels for transparent prompt/response visibility, persistent subagent context, and fail-loud reliability.

## Project docs
- `relay-bot-plan.md` — architecture and rationale
- `technical-design-doc.md` — implementation contract + documentation policy
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

Current implementation status: Milestone 1 — dispatch path verified, return path (capture/forward) BLOCKED. See `live-activation-runbook.md` for details.

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
- `CLAWSUITE_RELAY_MENTION_MAP_JSON` — optional JSON map of `targetAgentId -> userId` for mention gating
- `CLAWSUITE_RELAY_ORCHESTRATOR_CHANNEL_ID` — orchestrator channel id for forwarded subagent responses and suppression scope
- `CLAWSUITE_RELAY_ENABLED` — `1` (default) or `0` to disable runtime hook behavior
- `CLAWSUITE_RELAY_AUTO_DELETE_ORCHESTRATOR_ENVELOPES` — `1` (default) to auto-delete relay envelope messages in orchestrator channel after receipt

Example systemd drop-in (`~/.config/systemd/user/openclaw-gateway.service.d/clawsuite-relay.conf`):
```ini
[Service]
Environment=CLAWSUITE_RELAY_ENABLED=1
Environment=CLAWSUITE_RELAY_BOT_TOKEN=<relay_bot_token>
Environment=CLAWSUITE_RELAY_CHANNEL_MAP_JSON="{\"systems-eng\":\"1474868861525557308\"}"
Environment=CLAWSUITE_RELAY_MENTION_MAP_JSON="{\"systems-eng\":\"794579141801934879\"}"
Environment=CLAWSUITE_RELAY_ORCHESTRATOR_CHANNEL_ID=1474838614197141729
```

## OpenClaw runtime hook wiring
This repo includes an OpenClaw plugin entrypoint (`index.ts` + `openclaw.plugin.json`) that wires:
- `message_received` → subagent response capture (for messages from external bots)
- `message_sending` → outbound capture (for agent responses to subagent channels) + announce suppression
- `relay_dispatch` tool → orchestrator can dispatch tasks to subagent channels

**Note:** The `message_sending` hook pipeline is confirmed working for all outbound messages (verified via gateway source analysis). The current blocking issue is that systems-eng (GPT-5.3) posts empty-content responses to relay dispatches. See `live-activation-runbook.md` for details and investigation next steps.

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

## Known deferred UX items
- @mention noise: Relay posts @mention the human user for routing, but this is unnecessary when `requireMention: false` is set. The mention map currently targets the human user, not the OpenClaw bot.
- Visible dispatch markers: `[relay_dispatch_id:...]` in channel messages is functional for correlation but noisy for casual reading. Could be moved to Discord embed metadata in a future phase.
