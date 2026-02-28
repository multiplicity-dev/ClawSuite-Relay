# Setup Runbook — ClawSuite-Relay

Everything needed to set up, extend, and verify the relay from scratch.

---

## 1. Discord Bot Creation

The relay uses a **separate** Discord bot from the main OpenClaw bot. This is required because OpenClaw drops its own bot's messages.

1. Go to [Discord Developer Portal](https://discord.com/developers/applications) → New Application → name it (e.g., "ClawSuite-Relay").
2. **Bot** tab → Reset Token → copy the token. This becomes `CLAWSUITE_RELAY_BOT_TOKEN`.
3. **Bot** tab → enable Message Content Intent (required to read message content).
4. **OAuth2** tab → URL Generator:
   - Scopes: `bot`
   - Bot permissions: `2048` (Send Messages)
   - Copy the generated URL, open in browser, select your guild, authorize.
5. **Decode the bot user ID** from the token: the base64 segment before the first `.` is the user ID. Example: `MTQ3NjgwOTU4OTU5MTc3MzI5NQ` → `1476809589591773295`. This ID goes into OpenClaw's `allowFrom` and `users` allowlists.

---

## 2. OpenClaw Global Prerequisites

These apply to ALL agents — they're configured once in the global `openclaw.json` Discord channel config.

### In `openclaw.json` (Discord provider config)

```json
{
  "discord": {
    "allowBots": true,
    "allowFrom": ["1476809589591773295"],
    "users": { "1476809589591773295": "ClawSuite-Relay" }
  }
}
```

- `allowBots: true` — lets the gateway process messages from bot users.
- `allowFrom` — allowlist of bot user IDs whose messages are accepted.
- `users` — maps bot user IDs to display names for logging.

### In the CEO's agent config (`openclaw.json`)

```json
{
  "tools": {
    "alsoAllow": ["relay_dispatch"]
  }
}
```

Only the CEO (orchestrator) needs `relay_dispatch` in `tools.alsoAllow`. Subagents receive relay dispatches as normal Discord messages — they don't need tool configuration.

---

## 3. Agent Registration Procedure

To add a new relay-bound agent:

### a. Get the channel ID

From Discord: right-click the channel → Copy Channel ID (requires Developer Mode in Discord settings). Or reference the channel table in CEO's TOOLS.md.

### b. Update channel map

In `~/.config/systemd/user/openclaw-gateway.service.d/clawsuite-relay.conf`, add the agent to `CLAWSUITE_RELAY_CHANNEL_MAP_JSON`:

```ini
Environment=CLAWSUITE_RELAY_CHANNEL_MAP_JSON="{\"agent-id\":\"channel-id\", ...}"
```

### c. Update CEO's TOOLS.md

- Add the agent to the "Relay-bound agents" list in the Relay Bot section.
- Add a row to the Relay Session Keys table with the agent's session key: `agent:<agent-id>:discord:channel:<channel-id>`.

### d. Gateway restart

```bash
systemctl --user daemon-reload
systemctl --user restart openclaw-gateway.service
```

### e. Verify

See "Verification Checklist" below.

---

## 4. Environment Variables Reference

All variables are set in the systemd drop-in: `~/.config/systemd/user/openclaw-gateway.service.d/clawsuite-relay.conf`

| Variable | Required | Description |
|---|---|---|
| `CLAWSUITE_RELAY_ENABLED` | Yes | Set to `1` to enable the relay plugin |
| `CLAWSUITE_RELAY_BOT_TOKEN` | Yes | Discord bot token for ClawSuite-Relay |
| `CLAWSUITE_RELAY_CHANNEL_MAP_JSON` | Yes | JSON object mapping agent IDs to Discord channel IDs |
| `CLAWSUITE_RELAY_ORCHESTRATOR_CHANNEL_ID` | Yes | Discord channel ID of the orchestrator's channel (#general) |
| `CLAWSUITE_RELAY_DEBUG_OUTBOUND` | No | Set to `1` for verbose outbound logging |
| `CLAWSUITE_RELAY_AUTO_DELETE_ORCHESTRATOR_ENVELOPES` | No | Set to `1` to auto-delete trigger messages from orchestrator channel |
| `CLAWSUITE_RELAY_FORWARD_MODE` | No | Forward mode: `turn_rich` (default) includes full turn context |

---

## 5. Verification Checklist

After setup or changes, verify:

### Gateway started cleanly

```bash
systemctl --user is-active openclaw-gateway.service
# Expected: active

journalctl --user -u openclaw-gateway.service --since "2 min ago" | grep -i "clawsuite-relay"
# Expected: plugin loaded, no errors
```

### Channel map parsed correctly

Dispatch to a mapped agent and check logs:

```bash
journalctl --user -u openclaw-gateway.service --since "5 min ago" | grep "dispatch.posted"
# Expected: targetAgentId matches, postedMessageId present
```

### End-to-end dispatch

1. CEO calls `relay_dispatch(targetAgentId="<agent>", task="ping test")`
2. Check the agent's Discord channel — task should appear with envelope footer
3. Wait for agent response
4. Check orchestrator channel — relay result should arrive via gateway injection

```bash
journalctl --user -u openclaw-gateway.service --since "10 min ago" | grep -E "dispatch\.(created|posted|completed)"
```

### Announce suppression

After a dispatch completes, verify no redundant transient announce in #general:

```bash
journalctl --user -u openclaw-gateway.service --since "10 min ago" | grep -i "suppress"
```

---

## 6. Troubleshooting

### Dispatch rejected: "No channel mapping for \<agent\>"

Agent ID not in `CLAWSUITE_RELAY_CHANNEL_MAP_JSON`. Check spelling matches exactly (case-sensitive).

### Bot token invalid / 401 Unauthorized

Token may have been regenerated in Discord Developer Portal. Update `CLAWSUITE_RELAY_BOT_TOKEN` and restart gateway.

### Agent doesn't respond to relay task

- Check agent's channel — did the message appear?
- Check `allowBots: true` in openclaw.json
- Check relay bot user ID is in `allowFrom` array
- Check the agent session is active (not idle/disconnected)

### Gateway injection fails (no relay result returned)

```bash
journalctl --user -u openclaw-gateway.service --since "10 min ago" | grep -E "forward|gateway.call"
```

Check that `CLAWSUITE_RELAY_ORCHESTRATOR_CHANNEL_ID` is set to the correct #general channel ID.

### Dispatch stuck in POSTED_TO_CHANNEL

The subagent hasn't responded yet, or the `llm_output` hook didn't fire. Check:

```bash
# Armed dispatch file:
ls /tmp/clawsuite-relay-dispatch/armed/
cat /tmp/clawsuite-relay-dispatch/armed/<agent-id>.json

# Look for llm_output events:
journalctl --user -u openclaw-gateway.service --since "10 min ago" | grep "llm_output"
```

### Idempotent replay vs new dispatch

If you dispatch with the same `requestId` and the prior dispatch is in a replayable state (POSTED_TO_CHANNEL, SUBAGENT_RESPONDED, COMPLETED), you'll get the existing dispatchId back. If the prior dispatch FAILED, a new dispatch is created.

---

## Current Agent Registry

| Agent | Channel | Channel ID | Mention User |
|---|---|---|---|
| systems-eng (CTO) | #tech | 1474868861525557308 | 794579141801934879 |
| clo (CLO) | #legal | 1474868554388996166 | 794579141801934879 |
| cfo (CFO) | #finance | 1474868675419963513 | 794579141801934879 |
| security-eng | #security | 1474868896371839308 | 794579141801934879 |
| doctor | #health | 1474868727395913922 | 794579141801934879 |
| life-coach | #coaching | 1474868828193165342 | 794579141801934879 |
| trainer | #fitness | 1474868801999863848 | 794579141801934879 |
| biographer | #biography | 1474868963337834567 | 794579141801934879 |
| pr-manager | #pr | 1474868920019062814 | 794579141801934879 |
| marketing-strat | #marketing | 1474868938721595573 | 794579141801934879 |
| learning-architect | #learning | 1474868986926596178 | 794579141801934879 |
| pa | #assistant | 1474869013824933941 | 794579141801934879 |
