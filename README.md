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

Current implementation status: Milestone 1 in progress (contract + state + RelayTransport abstraction + Discord transport adapter scaffold).

## Discord transport wiring (env config)
To use the real Discord relay transport, configure:
- `CLAWSUITE_RELAY_BOT_TOKEN` — relay bot token
- `CLAWSUITE_RELAY_CHANNEL_MAP_JSON` — JSON map of `targetAgentId -> channelId`
- `CLAWSUITE_RELAY_MENTION_MAP_JSON` — optional JSON map of `targetAgentId -> userId` for mention gating
- `CLAWSUITE_RELAY_ORCHESTRATOR_CHANNEL_ID` — orchestrator channel id for forwarded subagent responses

Example:
```bash
export CLAWSUITE_RELAY_BOT_TOKEN="..."
export CLAWSUITE_RELAY_CHANNEL_MAP_JSON='{"systems-eng":"1474868861525557308"}'
export CLAWSUITE_RELAY_MENTION_MAP_JSON='{"systems-eng":"123456789012345678"}'
```
