# ClawSuite Relay — FACTS ESTABLISHED (Control File)

Entrypoint: see `RELAY-START.md` (sole startup doc).

Last audited: 2026-02-28

## Primary Goal (canonical)
Deliver the subagent's last assistant message to the orchestrator via internal gateway injection, matching what the completion announce delivers in native `sessions_spawn` flows. Content richness comes from the CEO's prompting style, not from the transport.

## Operating Target for Phase 1
Capture `assistantTexts[last]` via `llm_output` hook and deliver to orchestrator session via `openclaw gateway call agent`. Both paths (a: channel output, b: internal delivery) operational.

## Non-negotiable facts
- Assistant text exists.
- Assistant text is capturable in OpenClaw surfaces.
- `assistantTexts[last]` is content-equivalent to what the completion announce delivers. Source code verified: thinking tokens stripped at every level, no provider-specific gating. This is NOT a limitation — it is correct behavior.
- The orchestrator can call `sessions_history` on-demand for deeper context. The relay provides the subagent's `sessionKey` as metadata.
- Content richness depends on how the orchestrator prompts the subagent. The CEO's natural dispatch style evokes extensive responses — the relay preserves this because the same prompt is posted to the channel.
- User-observed runtime behavior is authoritative.
- Do not re-run failed hook paths without new evidence.

## OpenClaw data surfaces (four independent access paths)
1. **`assistantTexts` array** (via `llm_output` hook) — all model-produced text blocks across the run. Channel delivery iterates ALL entries. Relay takes only the LAST entry.
2. **Completion announce** — last assistant message text only. This is the default orchestrator trigger in native `sessions_spawn`. Relay's gateway injection matches this content scope.
3. **`sessions_history`** — filtered transcript, on-demand. Truncated, capped at 80KB. Available to any agent with the `sessionKey`.
4. **Raw JSONL** — everything on disk, unfiltered. Direct file access only.

These are independent views with different filters on the same source data, not hierarchical layers.

## Hook/path ledger (to prevent loops)
| Hook/path | Result summary | Status |
|---|---|---|
| `message_sent` | instability/corruption reports | FROZEN |
| `message_sending` | announce suppression only | FROZEN (announce-suppress only) |
| `before_message_write` | historical success window evidence (`a78db81a...`) | SUPERSEDED by `llm_output` |
| `message_received` | envelope capture only | MAINTENANCE ONLY |
| `agent_end` | works; gated behind env flag | FALLBACK (env flag `CLAWSUITE_RELAY_USE_AGENT_END_FALLBACK=1`) |
| `llm_output` | capture + gateway delivery working | **PRIMARY** — verified live |
| mixed no-guard | duplicate forwards | FROZEN |
| mixed with guards | duplicates reduced | FROZEN |

## Verified dispatch snapshots
- `74c3748f...` -> source `agent_end`, payload `M1_OK`
- `7adc2a78...` -> source `llm_output`, payload `M2_OK`
- `9332aefa...` -> source `agent_end`, payload `M3_OK`
- `7a364d99...` -> source `llm_output`, prose payload channel-equivalent
- `447a218f...` -> source `llm_output`, payload `ALPHA BETA + D1_OK`
- `a78db81a...` (historical) -> `before_message_write` captured dispatch (journal evidence)
- Live test (2026-02-28) -> source `llm_output`, gateway delivery successful, CEO received and processed result

## Current blocker (precise)
~~Deterministically capture and forward the intended assistant-text surface for each dispatch.~~ **RESOLVED.** `llm_output` → `assistantTexts[last]` → gateway injection. Clean loop verified live. Content parity with native `sessions_spawn` confirmed via source code trace.

Remaining work is reliability and polish (see `implementation-plan.md`).

## Stop rule
After 2 failed hypotheses in a row: freeze code changes and present options.
