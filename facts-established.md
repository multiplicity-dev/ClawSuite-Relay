# ClawSuite Relay — FACTS ESTABLISHED (Control File)

Entrypoint: see `RELAY-START.md` (sole startup doc).

Last audited: 2026-02-28

## Primary Goal (canonical)
Make orchestrator receive and use the same richer assistant/session context that exists in normal OpenClaw flows, via relay.

## Operating Target for Phase 1
Surface the subagent **assistant text** in relay flow using OpenClaw-native hooks, without redefining OpenClaw semantics.

## Non-negotiable facts
- Assistant text exists.
- Assistant text is capturable in OpenClaw surfaces.
- User-observed runtime behavior is authoritative.
- Do not re-run failed hook paths without new evidence.

## OpenClaw surfaces (disambiguated)
1. `llm_output.assistantTexts[]` = model-produced assistant text blocks.
2. Completion announce = last assistant message text (default orchestrator trigger path).
3. `sessions_history` = richer on-demand transcript (includes more context; optional).
4. JSONL = raw full transcript on disk.

## Hook/path ledger (to prevent loops)
| Hook/path | Result summary | Status |
|---|---|---|
| `message_sent` | instability/corruption reports | FROZEN |
| `message_sending` | channel-visible capture; not sufficient target | FROZEN (fallback only) |
| `before_message_write` | historical success window evidence (`a78db81a...`) | ACTIVE (forensic replay path) |
| `message_received` | envelope capture only | MAINTENANCE ONLY |
| `agent_end` | works; payload/source inconsistent | ACTIVE (fallback) |
| `llm_output` | native assistantTexts hook; source can win | ACTIVE (primary) |
| mixed no-guard | duplicate forwards | FROZEN |
| mixed with guards | duplicates reduced | ACTIVE |

## Verified dispatch snapshots
- `74c3748f...` -> source `agent_end`, payload `M1_OK`
- `7adc2a78...` -> source `llm_output`, payload `M2_OK`
- `9332aefa...` -> source `agent_end`, payload `M3_OK`
- `7a364d99...` -> source `llm_output`, prose payload channel-equivalent
- `447a218f...` -> source `agent_end`, payload `ALPHA BETA + D1_OK`
- `a78db81a...` (historical) -> `before_message_write` captured dispatch (journal evidence)

## Current blocker (precise)
Deterministically capture and forward the intended assistant-text surface for each dispatch (no source flip ambiguity), then verify orchestrator uses that payload as expected.

## Single active next step
Run one discriminating test on current build and record:
- winning hook
- forwarded payload
- whether payload equals channel-visible output or richer assistant/session surface

## Stop rule
After 2 failed hypotheses in a row: freeze code changes and present options.
