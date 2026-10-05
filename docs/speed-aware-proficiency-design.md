# Speed-Aware Proficiency Design (Issue #60)

## Status

Draft design and implementation plan for issue #60.

This document defines a deterministic model that separates global character
knowledge from speed-conditioned receive proficiency while moving all runtime
WPM controls to shared discrete ladders.

## Goals

- Keep character unlock state global and monotonic (never relock).
- Evaluate proficiency relative to receive speed in bounded speed bands.
- Eliminate arbitrary per-WPM fragmentation from settings and analytics.
- Preserve current default behavior (`charWpm=20`, `effectiveWpm=12`).
- Keep migration deterministic and backup/import compatible.

## Non-goals

- Automatic speed progression.
- Koch order changes.
- Hardware input expansion.
- Phase 5 PWA work.

## Canonical speed ladders

### Character speed bands

Canonical values:

- 10 (optional accessibility/novice entry)
- 15
- 20
- 25
- 30
- 35
- 40

Product policy:

- Default remains 20.
- Learn flow continues to target the existing default path.
- 10 is available explicitly but is not auto-selected for existing users.

### Effective speed bands

Canonical values:

- 5
- 8
- 10
- 12
- 15
- 18
- 20
- 25
- 30
- 35
- 40

Invariant:

- `effectiveWpmBand <= charWpmBand`

Normalization rule:

- Incoming numeric WPM values map to the nearest canonical band.
- If two bands are equally near, choose the lower band.
- Effective-band normalization is then clamped to `<= charWpmBand`.

## Domain model

## 1. Global character knowledge

Global unlock/mastery stays in curriculum state exactly as today:

- unlocked characters remain unlocked across all speed changes;
- advancement acceptance still unlocks at most one next character.

## 2. Speed-conditioned proficiency

Per-character RX proficiency is tracked by character-speed band using bounded,
rolling evidence windows.

Conceptual shape:

```ts
type CharacterSpeedBand = 10 | 15 | 20 | 25 | 30 | 35 | 40;

type SpeedBandEvidence = {
  attempts: number;
  correct: number;
  weightedAttempts: number;
  weightedCorrect: number;
};

type CharacterSpeedProficiency = Record<CharacterSpeedBand, SpeedBandEvidence>;
```

Storage strategy:

- Source-of-truth attempts/sessions remain authoritative records.
- Proficiency is derived deterministically into projections.
- No per-exact-WPM buckets are retained in projections.

## 3. Cross-band transfer

Transfer is deterministic, local, and bounded:

- same band weight: `1.0`
- adjacent band (`|delta| = 5`): `0.5`
- two-step band (`|delta| = 10`): `0.25`
- larger distance: `0`

Transfer is symmetric for derived confidence, but advancement gating uses a
same-band floor to avoid over-crediting from faster/slower neighbors.

## Learning semantics

## 4. Advancement evidence semantics

Advancement evaluation continues to use completed continuous-copy evidence, with
speed-aware constraints:

- readiness stream is labeled by `charWpmBand` and `effectiveWpmBand`;
- active-set/newest-character coverage requirements remain unchanged;
- a readiness pass requires same-band newest-character minimum observations;
- transfer-weighted neighboring evidence may help remediation/scheduler
  confidence but cannot replace minimum same-band newest evidence for unlock.

## 5. Speed change behavior

When learner changes character speed band:

- unlocked characters remain unchanged;
- scheduler enters reacquisition mode for already-unlocked active characters;
- advancement offers are paused until reacquisition threshold at the new band
  is satisfied.

Reacquisition threshold:

- at least one valid continuous-copy stream at the new `charWpmBand` meeting
  existing active/newest coverage and accuracy rules;
- unresolved `needsReview` still vetoes advancement.

## 6. Remediation and scheduler behavior

- Scheduler prioritizes weakest active characters in current `charWpmBand`.
- Nearby-band transfer contributes to tie-breaking confidence only.
- Existing deterministic reason codes remain; an additional speed-aware reason
  can be introduced if needed in implementation (`SPEED_REACQUISITION`).

## Stats and UX

## 7. Settings UX

- Character/effective controls become discrete selectors based on canonical
  ladders.
- Effective choices are filtered to `<= selected char band`.
- Existing default 20/12 remains first-run behavior.

## 8. History/Stats presentation

Avoid clutter while exposing speed-conditioned context:

- Keep current top-level dashboard intact.
- Add compact speed context where useful:
  - "Current RX band: 20/12" in settings/history summary.
  - Optional per-character detail segment by character-speed band for current
    active set.
- Do not explode views into exact-WPM rows.

## Data and migration

## 9. Source records and schema

- Preserve existing raw numeric `charWpm`/`effectiveWpm` fields.
- Add normalized band fields for deterministic projection/analytics:
  - `charWpmBand`
  - `effectiveWpmBand`
- New writes store both raw and normalized values.

## 10. Existing-data migration

Deterministic migration path:

- For existing attempts/sessions with raw WPM only, derive normalized band
  fields by the normalization rule above.
- Rebuild projections from authoritative source using normalized band fields.
- Preserve raw historical WPM values for auditability.

## 11. Backup/import compatibility

- Backup payload includes new normalized band fields for sessions/attempts once
  schema/version is bumped.
- Import parser accepts:
  - old records without explicit band fields (derive on import/rebuild), and
  - new records with explicit band fields (validate consistency with raw values).

## Deterministic acceptance mapping (issue #60)

1. Canonical character-speed bands:
   - `10, 15, 20, 25, 30, 35, 40`
2. Canonical effective-speed bands:
   - `5, 8, 10, 12, 15, 18, 20, 25, 30, 35, 40`
3. Proficiency representation:
   - per-character, per-character-speed-band derived evidence/projection.
4. Neighbor-band transfer:
   - deterministic weights `1.0 / 0.5 / 0.25 / 0` by distance.
5. Learner speed changes:
   - keep unlocks; enter reacquisition at the new band.
6. Evidence before advancement resumes:
   - one qualifying continuous-copy readiness pass at the new band with existing
     coverage/accuracy/newest constraints.
7. Existing-record migration:
   - preserve raw WPM; derive normalized band fields deterministically;
     projection rebuild from source.
8. Stats/History exposure:
   - compact speed-band context and optional per-band character detail,
     without exact-WPM fragmentation.

## Implementation plan

## Phase A: Ladder primitives and settings normalization

- Add canonical ladder constants and band types.
- Add normalization helpers and tests (tie-break, clamping, defaults).
- Move settings UI controls to discrete selectors.

## Phase B: Persisted model extension and migration

- Add `charWpmBand` / `effectiveWpmBand` to session/attempt records.
- Add schema validation and migration derivation for old records.
- Keep backup/import backward-compatible.

## Phase C: Speed-aware proficiency projection

- Add deterministic per-character/per-band proficiency projection builder.
- Add bounded repository query methods for current-band proficiency.
- Add tests for transfer weighting and no exact-WPM fragmentation.

## Phase D: Advancement/reacquisition integration

- Gate advancement after speed-band changes until current-band reacquisition
  passes.
- Preserve existing progression invariants and explicit acceptance flow.
- Add deterministic tests for speed raise/lower transitions.

## Phase E: Stats/History surface

- Add concise speed-band context and per-band detail affordance.
- Keep dashboard bounded and uncluttered.

## Validation checklist

- Unit/integration tests for normalization, migration, projections, advancement,
  and settings UX.
- Full gate:
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run format:check`
  - `npm run build`
