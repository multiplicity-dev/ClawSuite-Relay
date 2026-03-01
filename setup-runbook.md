# Setup Runbook — ClawSuite-Relay

Everything needed to set up, extend, and verify the relay from scratch.

---

## 1. Discord Webhook Setup

Dispatch posting uses Discord incoming webhooks mapped by target agent.

1. Open each target channel in Discord.
2. Channel settings → Integrations → Webhooks → New Webhook.
3. Copy each webhook URL and store it in `CLAWSUITE_RELAY_WEBHOOK_MAP_JSON`.
4. Optionally set default webhook name/avatar in Discord UI for fallback identity.

---

## 2. OpenClaw Global Prerequisites

These apply to ALL agents — they're configured once in the global `openclaw.json` Discord channel config.

### In `openclaw.json` (Discord provider config)

```json
{
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
```

- `allowBots: true` — lets the gateway process bot/webhook-authored relay dispatch messages.
- `allowFrom` + `users` — each webhook's author ID (first path segment of the webhook URL) must be in both lists, otherwise OpenClaw silently drops the message.

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

### b. Update webhook map

In `~/.config/systemd/user/openclaw-gateway.service.d/clawsuite-relay.conf`, add the agent to `CLAWSUITE_RELAY_WEBHOOK_MAP_JSON`:

```ini
Environment=CLAWSUITE_RELAY_WEBHOOK_MAP_JSON="{\"agent-id\":\"https://discord.com/api/webhooks/<id>/<token>\", ...}"
Environment=CLAWSUITE_RELAY_SOURCE_PROFILE_MAP_JSON="{\"ceo\":{\"username\":\"CEO\",\"avatarUrl\":\"https://example.com/ceo.png\"}}"
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
| `CLAWSUITE_RELAY_WEBHOOK_MAP_JSON` | Yes | JSON object mapping target agent IDs to Discord webhook URLs |
| `CLAWSUITE_RELAY_SOURCE_PROFILE_MAP_JSON` | No | JSON object mapping source agent IDs to `{ username, avatarUrl }` overrides |
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

### Webhook map parsed correctly

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

### Dispatch rejected: "No webhook mapping for \<agent\>"

Agent ID not in `CLAWSUITE_RELAY_WEBHOOK_MAP_JSON`. Check spelling matches exactly (case-sensitive).

### Agent doesn't respond to relay task

- Check agent's channel — did the message appear?
- Check `allowBots: true` in openclaw.json
- Check each webhook's author ID is in both `allowFrom` and guild `users` (extract from webhook URL: first segment after `/webhooks/`)
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

| Agent | Channel | Channel ID |
|---|---|---|
| systems-eng (CTO) | #tech | 1474868861525557308 |
| clo (CLO) | #legal | 1474868554388996166 |
| cfo (CFO) | #finance | 1474868675419963513 |
| security-eng | #security | 1474868896371839308 |
| doctor | #health | 1474868727395913922 |
| life-coach | #coaching | 1474868828193165342 |
| trainer | #fitness | 1474868801999863848 |
| biographer | #biography | 1474868963337834567 |
| pr-manager | #pr | 1474868920019062814 |
| marketing-strat | #marketing | 1474868938721595573 |
| learning-architect | #learning | 1474868986926596178 |
| pa | #assistant | 1474869013824933941 |
