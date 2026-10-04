# Checkpoint 4 Audit (Issue #51)

Date: 2026-10-04

This document records the acceptance audit for Milestone 4 (Persistence and analytics MVP).

Checkpoint outcome: blockers found. Milestone 4 is not closed yet.

## Scope reviewed

The audit reviewed Phase 4 requirements in the master plan and milestone documents, including:

- IndexedDB schema and migration fixtures.
- Legacy migration idempotency and stale-remigration prevention.
- Persistence across reload/restart.
- Interrupted-session recovery.
- Learn and Practice durable attempt boundaries.
- Retry and write-failure behavior.
- Active-time behavior across idle, hidden, midnight, DST, timezone travel, and wall-clock anomalies.
- Advancement and mastery persistence invariants.
- Projection rebuild equivalence.
- Hand-calculated metrics fixtures.
- Backup -> reset -> replace-import equivalence and import rejection safety.
- 100k-attempt performance evidence.

## Audit disposition

The audit identified substantive remaining requirements that block Checkpoint 4 closure.

Tracking issues:

- #57 — Milestone 4 blocker: complete Progress dashboard contract and analytics semantics.
- #58 — Milestone 4 blocker: finish IndexedDB lifecycle hardening and browser acceptance checks.

Required execution order before checkpoint closure:

1. #57
2. #58
3. #51 (re-run closeout audit)
4. #52 (Phase 5 kickoff)

## Automated validation evidence

Executed on 2026-10-04:

- npm test
- npm run typecheck
- npm run lint
- npm run format:check
- npm run build
- npm run benchmark:data

Result: all commands passed.

Notes:

- Known jsdom warning still appears during one Settings test (`navigation (except hash changes)`), but the test itself passes and does not fail the suite.
- Vite build reports non-blocking chunk-size warnings.

## Representative benchmark evidence (100k mixed RX/TX)

From `npm run benchmark:data` on 2026-10-04:

- source serialized record size: 115,615,766 bytes
- projection serialized record size: 222,422 bytes
- portable backup serialized record size: 115,617,557 bytes
- projection rebuild: 2,362.70 ms
- daily query: 4.83 ms
- RX character query: 8.81 ms
- TX character query: 7.60 ms
- confusion query: 1.46 ms
- portable export: 4,164.66 ms

Budget check:

- bounded projection queries <= 500 ms: pass
- portable export <= 5,000 ms: pass

## Documentation currency checks

Confirmed current for the completed subset:

- `docs/data-model.md`
- `docs/metrics.md`

Repository-level milestone status documents must remain in "Milestone 4 in progress"
state until #57 and #58 are complete and #51 is re-run.

## Defect handling outcome

Substantive blockers were identified and tracked as focused issues (#57, #58).
Checkpoint closure is deferred until those blockers are resolved.

## Manual verification status and limitations

Still manual by nature and outside deterministic unit coverage:

- real-device audio quality and timing under mobile/browser variability;
- cross-browser output-device routing behavior where APIs differ;
- physical hardware input behavior on real devices.

These manual areas still require explicit checkpoint evidence and remain part of
the #58 acceptance work.

## Conclusion

Checkpoint 4 acceptance criteria are not yet fully satisfied. Milestone 4
remains in progress pending blocker completion (#57, #58), after which #51
should be re-run for final acceptance closure.
