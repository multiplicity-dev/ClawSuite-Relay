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

Current implementation status: Milestone 1 — PRIMARY BLOCKER RESOLVED. Full relay loop operational: dispatch → channel post → `llm_output` capture → gateway injection delivery. Content parity with native `sessions_spawn` verified. Remaining: suppression live test, fail-loud live test, >2000 char payload handling. See `implementation-plan.md` for details.

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
- `llm_output` → **primary capture path**: provides `assistantTexts: string[]` pre-extracted. Relay forwards the last entry (`assistantTexts[assistantTexts.length - 1]`), matching what the completion announce delivers in normal `sessions_spawn` workflows
- `message_received` → subagent response capture (fallback path for external bot messages)
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

## Known deferred UX items
- @mention noise: Relay posts @mention the human user for routing, but this is unnecessary when `requireMention: false` is set. The mention map currently targets the human user, not the OpenClaw bot.
- Visible dispatch markers: `[relay_dispatch_id:...]` in channel messages is functional for correlation but noisy for casual reading. Could be moved to Discord embed metadata in a future phase.
