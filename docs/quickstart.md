# Quickstart

This is the shortest public path to getting ClawSuite Relay running as a local OpenClaw plugin.

## What you need

- OpenClaw installed and working
- a Discord-backed OpenClaw deployment
- at least one orchestrator agent and one specialist agent
- a Discord webhook for each target specialist channel that should receive relay dispatches

## Install the plugin

Clone the repo and install dependencies:

```bash
git clone <your-repo-url> ClawSuite-Relay
cd ClawSuite-Relay
npm install
npm run build
```

Install it into OpenClaw as a local plugin:

```bash
openclaw plugins install -l /path/to/ClawSuite-Relay
openclaw plugins enable clawsuite-relay
```

## Configure Relay

Relay needs three things:

1. a webhook map for target specialist channels
2. a source-profile map for agents that dispatch through Relay
3. the orchestrator channel ID

Example environment values:

```ini
CLAWSUITE_RELAY_ENABLED=1
CLAWSUITE_RELAY_WEBHOOK_MAP_JSON={"systems-eng":"https://discord.com/api/webhooks/<id>/<token>"}
CLAWSUITE_RELAY_SOURCE_PROFILE_MAP_JSON={"ceo":{"username":"CEO","avatarUrl":"https://example.com/ceo.png"}}
CLAWSUITE_RELAY_ORCHESTRATOR_CHANNEL_ID=<orchestrator_channel_id>
```

Useful optional settings:

```ini
CLAWSUITE_RELAY_ARM_TTL_MS=1800000
CLAWSUITE_RELAY_REPLAYABLE_TTL_MS=21600000
```

## OpenClaw configuration

### Tool visibility

Agents that should call `relay_dispatch` need the tool explicitly allowed.

Example:

```json
{
  "id": "ceo",
  "tools": {
    "alsoAllow": ["relay_dispatch"]
  }
}
```

### Webhook/bot message handling

Relay dispatches arrive via Discord webhooks. OpenClaw must be configured to accept them.

At minimum:

- `allowBots: true`
- each webhook author ID included in the relevant allowlists

The exact structure depends on your OpenClaw Discord provider config.

## First validation

Build and test first:

```bash
npm run typecheck
npm test
npm run build
```

Then restart the OpenClaw gateway and send a small dispatch:

```text
relay_dispatch(targetAgentId="systems-eng", task="ping test")
```

Expected result:

1. the dispatch appears in the target agent's Discord channel
2. the target agent responds in its own channel
3. the orchestrator receives the relayed result
4. logs show a correlated dispatch lifecycle

## What to watch for

- If the dispatch appears in Discord but the target agent never processes it, your webhook/bot allowlist path is the first place to check.
- If long replies get split by Discord, downstream behavior may not always treat the sequence as one coherent return. This is a known limitation.
- If the source agent has no configured source profile, Relay should now fail closed instead of posting under generic branding.

## Next documents

- [../README.md](../README.md)
- [../technical-design-doc.md](../technical-design-doc.md)
- [../implementation-plan.md](../implementation-plan.md)
