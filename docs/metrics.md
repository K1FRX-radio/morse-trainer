# Metrics

This document defines displayed analytics metrics and the benchmark evidence for large history usage.

## Scope

Displayed metrics currently come from:

- `src/ui/hooks/useStatsHistory.ts`
- `src/data/analytics.ts`
- projection query methods in `src/data/repository.ts`

The current History screen window is the last 30 local dates.

## Data sources and bounded queries

The History screen fetches bounded projection slices only:

- daily: `listDailyProjections(fromLocalDate, toLocalDate, limit=30)`
- character RX: `listCharacterProjections(direction=rx, limit=200)`
- character TX: `listCharacterProjections(direction=tx, limit=200)`
- confusion: `listConfusionProjections(limit=50)`

Repository hard cap is `MAX_PROJECTION_QUERY_LIMIT = 500`.

No History query loads full attempt/session history into React state.

## Eligibility and exclusions

Session/day activity eligibility:

- projection rebuild uses source-aware session validity policy
- invalid sessions are excluded from daily/session aggregates
- active time comes from `activeDateBuckets` grouped by captured local date

Attempt-level inclusion rules:

- daily `attemptCount` includes all attempts in range
- accuracy and character/confusion metrics exclude attempts flagged `assisted`, `replayed`, or `abandoned`

RX/TX separation:

- RX metrics come from RX observations only
- TX metrics come from TX observations only
- per-character projections are direction-specific

## Displayed metric definitions

## Overall summary cards

### Active time

- formula: `sum(daily.activeMs)`
- source: daily projections
- unit: milliseconds, formatted to minutes/hours

### Sessions

- formula: `sum(daily.sessionCount)`
- source: daily projections

### Attempts

- formula: `sum(daily.attemptCount)`
- source: daily projections

### RX accuracy

- formula: `sum(daily.rxCorrect) / sum(daily.rxTotal)`
- null handling: `N/A` when denominator is 0
- source: daily projections

### TX accuracy

- formula: `sum(daily.txCorrect) / sum(daily.txTotal)`
- null handling: `N/A` when denominator is 0
- source: daily projections

### Avg effective WPM

- formula: `sum(daily.effectiveWpmTotal) / sum(daily.effectiveWpmSamples)`
- null handling: `N/A` when sample count is 0
- source: daily projections

### Active days

- formula: number of daily rows where `activeMs > 0`
- source: daily projections

## Recent daily activity rows

Per day (`localDate` ascending then displayed newest-first):

- active time: `daily.activeMs`
- sessions: `daily.sessionCount`
- attempts: `daily.attemptCount`
- RX accuracy: `daily.rxCorrect / daily.rxTotal`
- TX accuracy: `daily.txCorrect / daily.txTotal`
- average WPM: `daily.effectiveWpmTotal / daily.effectiveWpmSamples`

## Difficult characters

Built from per-character projection rows.

Per row:

- observations: `recent.length`
- correct count: count of `recent.correct === true`
- recent accuracy: `recentCorrect / recentObservationCount` (`null` when 0)
- most recent UTC: max `recent.occurredAt.utc`
- RX response summary (RX only): mean/min/max over available `responseMs`

Ordering:

- lower accuracy first (treat null as 1)
- then higher observation count
- then character and direction tie-breakers

UI displays top 12 rows after ordering.

## Confusion pairs

Confusions are directional RX substitutions only.

Definition:

- each substitution observation contributes one count to ordered pair `(target, answer)`
- insertions/deletions are excluded
- TX observations are excluded

Ordering:

- descending count
- then alphabetical `target`, then `answer`

## Local date/time-zone and streak rules

Local-date handling:

- day assignment uses captured date context (`localDate`, offset, optional timezone)
- active time aggregation follows recorded `activeDateBuckets`

Streak rules:

- streaks are calculated only from qualifying practice days (`attemptCount > 0`)
- non-qualifying sessions must not contribute to day-based streak/activity state
- a streak resets when a calendar gap appears between qualifying days

## Deterministic analytics fixtures

Hand-calculated fixture coverage is in `src/data/metrics-fixtures.test.ts`.

It validates exact outputs for:

- daily/overall active time and counts
- today/week/all-time session windows and average session duration
- current/best practice-day streak boundaries
- RX/TX accuracy with assisted/replayed exclusions
- per-character accuracy/latency summaries
- directional confusion pairs
- date-boundary aggregation via active date buckets
- non-qualifying session exclusion from activity-day counts
- projection rebuild equivalence against repository rebuild

## 100k history benchmark

Benchmark implementation:

- fixture correctness in `src/data/benchmark-100k-fixture.test.ts` (default `npm test` path)
- timing benchmark in `src/data/benchmark-100k.benchmark.test.ts` (dedicated command: `npm run benchmark:data`)
- deterministic synthetic history:
  - 500 sessions
  - 100,000 attempts total
  - mixed RX/TX sources (`copy-practice` RX and `send-practice` TX)
  - TX workload includes short sends, longer sends, near-cap keying payloads, and explicit truncation cases
- rebuild projections from authoritative records
- run bounded dashboard-style queries and portable export generation

Environment for recorded sample:

- OS: Linux 6.8.0-124-generic x86_64
- Node: v22.23.2
- npm: 10.9.8
- database implementation for test: fake-indexeddb (in-memory)

Recorded sample (from benchmark test log):

- source-record serialized record size: 115,615,766 bytes
- projection serialized record size: 222,422 bytes
- projection rebuild time: 1,921.19 ms
- daily query time (limit 500): 6.28 ms
- RX character query time (limit 200): 7.74 ms
- TX character query time (limit 200): 6.09 ms
- confusion query time (limit 50): 1.20 ms
- portable export time: 3,809.73 ms
- portable export serialized record size: 115,617,557 bytes

Usability/performance budget:

- projection rebuild <= 12,000 ms
- each bounded dashboard query <= 500 ms
- portable export generation <= 5,000 ms

Result: pass.

## Notes on database size interpretation

Sizes above are deterministic serialized payload sizes of source/projection records in the test harness. They are used as consistent comparative evidence and are not raw on-disk browser quota bytes.
