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

- #58 — Milestone 4 blocker: finish IndexedDB lifecycle hardening and browser acceptance checks.

Issue status update:

- #57: completed and merged (PR #59)
- #58: lifecycle implementation and deterministic coverage added; manual-browser
  gate items recorded below

Required execution order before checkpoint closure:

1. #58
2. #51 (re-run closeout audit)
3. #52 (Phase 5 kickoff)

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
state until #58 is complete and #51 is re-run.

## Issue #58 storage lifecycle implementation evidence

Implemented in code:

- closes IndexedDB connection on `versionchange`
- emits cross-tab lifecycle signals over `BroadcastChannel` where supported
  (`upgrade-blocked`, `connection-closed-for-upgrade`, `reload-required`)
- surfaces clear bootstrap/runtime guidance for blocked upgrades, reload-required
  state, and unavailable IndexedDB startup failures
- blocks startup retry while upgrade blockers remain active
- adds persistent-storage request/status UX under Settings data management
  (`navigator.storage.persisted()` + `navigator.storage.persist()` after user
  gesture), including granted/denied/unsupported/error states

Deterministic coverage added:

- `src/data/storage-lifecycle.test.ts`
- `src/ui/screens/SettingsScreen.test.tsx` (persistent-storage request/support)

Existing deterministic evidence for unsaved/quota retry behavior remains in:

- `src/ui/screens/LearnScreen.test.tsx`
- `src/ui/hooks/practice-work-queue.test.ts`

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

## Browser acceptance matrix for #58

Recorded on 2026-10-04:

- migration from existing localStorage state: pass (manual). Seeded legacy
  `k1frx.settings.v1`/`k1frx.curriculum.v2`/`k1frx.introduced.v1`, reloaded,
  observed migrated 3-character onboarding state, migration marker and rollback
  marker creation, and legacy key cleanup.
- stale rollback-state remigration prevention: pass (manual). After migration
  marker creation, injected stale legacy curriculum/settings values and reloaded;
  persisted portable settings remained unchanged (`charWpm` stayed at migrated
  value) and stale legacy payload was ignored.
- normal and interrupted Learn sessions: pass (manual smoke). Started Learn and
  ended session early; summary persisted and returned retry actions without
  runtime failure.
- Copy and Send Practice attempt recording: pass (manual smoke). Completed one
  Copy check and one Send keying attempt; both showed save activity and History
  attempt totals/character metrics updated.
- dashboard refresh and low-sample states: pass (manual). Verified initial
  low-sample/empty-state History rendering, then verified live refresh to
  non-empty bounded summaries after Practice attempts.
- export -> reset -> import round trip: partial. Reset path and import-rejection
  behavior were manually exercised; full user-visible export-to-file then
  replace-import round trip remains covered by deterministic repository/UI tests
  (`src/data/repository.test.ts`, `src/ui/screens/SettingsScreen.test.tsx`).
- blocked-upgrade and competing-tab behavior: pass (manual + deterministic).
  Real multi-tab IndexedDB upgrade request triggered competing-tab versionchange
  closure and displayed reload-required banner; blocked-upgrade banner verified
  via cross-tab lifecycle signal. Deterministic lifecycle channel coverage is in
  `src/data/storage-lifecycle.test.ts`.
- unavailable/quota-exceeded storage behavior: partial. Quota/retry persistence
  diagnostics remain covered by deterministic Learn persistence tests
  (`src/ui/screens/LearnScreen.test.tsx`), but true browser-level unavailable
  IndexedDB context could not be forced in this environment.
- malformed/future-version import rejection: pass (manual + deterministic).
  Malformed JSON and incompatible backup payload were rejected in Settings UI;
  parser/validation rejection remains covered by `src/data/backup-repository.test.ts`.
- reset preservation of audio output selection: pass (manual). Set
  `k1frx.audioOutput.v1`, executed reset, and confirmed the audio-output key was
  preserved while portable training data reset to defaults.
- no runtime console errors or layout overflow: pass with caveat. No app runtime
  errors were observed during manual flows; expected Dexie competing-connection
  warnings appeared during upgrade/delete scenarios. Desktop and narrow-mobile
  viewport checks on Learn/Practice/History/Settings showed no horizontal
  overflow in this run.

## Conclusion

Checkpoint 4 acceptance criteria are not yet fully satisfied. Milestone 4
remains in progress pending blocker completion (#57, #58), after which #51
should be re-run for final acceptance closure.
