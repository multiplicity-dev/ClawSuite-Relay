# Phase 1 Workflow (Single-Operator Control)

## Purpose
Keep Phase 1 execution tractable: one control file, one evidence log, one runbook.

## Documents and roles
1. `facts-established.md` (CONTROL)
   - Canonical goal
   - Non-negotiable facts
   - Hook ledger
   - Current blocker
   - Single active next step

2. `dev-log.md` (EVIDENCE JOURNAL)
   - Chronological command/test evidence
   - Dispatch IDs
   - Hook-source observations
   - Pass/fail outcomes

3. `live-activation-runbook.md` (OPS PROCEDURE)
   - Restart/config/smoke-test steps
   - Operator commands
   - Known blockers checklist

4. `layer-disambiguation.md` (ARCHITECTURE REFERENCE)
   - Four-surface model
   - Source references
   - Why assistantTexts/announce/sessions_history differ

5. `implementation-plan.md` (MILESTONE TRACKING)
   - Phase checklist + blocker status

## Read cadence (so this is not 6-file overhead every turn)
### Every execution turn (mandatory)
- Read `facts-established.md` (control + active step)

### Only when needed
- Read `dev-log.md` only the newest relevant section for the active dispatch/test
- Read `live-activation-runbook.md` only when doing restart/config/smoke operations
- Read `implementation-plan.md` only when updating blocker/checklist status
- Read `layer-disambiguation.md` only when semantic confusion about surfaces appears

### Weekly/major checkpoint
- Reconcile all five docs; remove duplicates and stale statements

## Anti-duplication rule
- Do not duplicate narrative across files.
- Put facts once in `facts-established.md`.
- Put raw event history in `dev-log.md` only.
- Put operational commands in runbook only.

## Per-change loop
1. Update `facts-established.md` (active step + falsification target)
2. Make one code change
3. Run one test
4. Append evidence to `dev-log.md`
5. Update blocker status in `implementation-plan.md`

## Completion condition (Phase 1)
- [x] Assistant-text surfacing behavior is deterministic and evidenced. (`llm_output` → `assistantTexts[last]` → gateway injection. Content parity with native `sessions_spawn` confirmed 2026-02-28.)
- [ ] Relay loop stable in live tests. (Core loop verified; suppression + fail-loud paths untested live.)
- [ ] Blockers in `implementation-plan.md` marked complete with evidence references. (Primary blocker resolved; polish items remain.)
