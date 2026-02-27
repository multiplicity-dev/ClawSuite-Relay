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

Current implementation status: Milestone 1 live activation in progress (dispatch path verified, capture/forward/suppression live tests pending).

## Discord transport wiring (env config)
To use the real Discord relay/forward transports, configure:
- `CLAWSUITE_RELAY_BOT_TOKEN` — relay bot token (a second Discord bot, separate from the main OpenClaw bot)
- `CLAWSUITE_RELAY_CHANNEL_MAP_JSON` — JSON map of `targetAgentId -> channelId`
- `CLAWSUITE_RELAY_MENTION_MAP_JSON` — optional JSON map of `targetAgentId -> userId` for mention gating
- `CLAWSUITE_RELAY_ORCHESTRATOR_CHANNEL_ID` — orchestrator channel id for forwarded subagent responses and suppression scope
- `CLAWSUITE_RELAY_ENABLED` — `1` (default) or `0` to disable runtime hook behavior

Example:
```bash
export CLAWSUITE_RELAY_BOT_TOKEN="..."
export CLAWSUITE_RELAY_CHANNEL_MAP_JSON='{"systems-eng":"1474868861525557308"}'
export CLAWSUITE_RELAY_MENTION_MAP_JSON='{"systems-eng":"123456789012345678"}'
export CLAWSUITE_RELAY_ORCHESTRATOR_CHANNEL_ID="1474838614197141729"
export CLAWSUITE_RELAY_ENABLED="1"
```

## OpenClaw runtime hook wiring
This repo includes an OpenClaw plugin entrypoint (`index.ts` + `openclaw.plugin.json`) that wires:
- `message_received` → subagent response capture + forward flow
- `message_sending` → transient orchestrator announce suppression predicate
- `relay_dispatch` tool → orchestrator can dispatch tasks to subagent channels

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
- Bot identity: Both dispatches and subagent replies display as the Discord bot name ("openclaw"), not per-agent identity. Would require webhook-based posting or multiple bot tokens.
- @mention noise: Relay posts @mention the human user for routing, but this is unnecessary when `requireMention: false` is set.
- Visible dispatch markers: `[relay_dispatch_id:...]` in channel messages is functional for correlation but noisy for casual reading.
