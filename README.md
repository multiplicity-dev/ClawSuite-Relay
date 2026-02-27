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

Current implementation status: Milestone 1 skeleton started (contract + state + logging + baseline tests).
