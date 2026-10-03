# Phase 4 Plan: Persistence and Analytics

## Objective

Replace best-effort portable `localStorage` state with a versioned IndexedDB
data layer, persist finalized Learn and Practice history, maintain rebuildable
analytics projections, add the Progress dashboard, and provide atomic backup,
restore, and reset behavior.

Phase 4 must preserve the learning model implemented during Phase 3 and its
refinements:

- Learn remains RX-only.
- Continuous copy supplies advancement evidence.
- Advancement requires explicit learner acceptance.
- Practice never unlocks characters or changes Learn remediation.
- Assisted and replayed work is excluded from mastery analytics.
- Tokenized groups and words retain their current playback and grading
  semantics.
- The separate checkpoint flow is obsolete and must not be reintroduced.

## Scope

### Included

- Versioned IndexedDB schema and migrations.
- Migration of existing portable browser state.
- Settings, mastery, session, attempt, and milestone persistence.
- Correct active-time accounting and interrupted-session recovery.
- Finalized Learn, Copy Practice, and Send Practice attempt history.
- Rebuildable analytics projections and bounded dashboard queries.
- Progress dashboard with the Milestone 4 metrics.
- Versioned export, validated replace import, and reset.
- Write-failure handling and idempotent retry.
- Data dictionary, metric definitions, and a 100,000-attempt benchmark.

### Excluded

- Merge import.
- Exact lesson resumption after a refresh or crash.
- Cloud accounts or synchronization.
- Exporting the device-specific audio output ID.
- Redesigning Practice pedagogy.
- PWA and service-worker work.
- Dynamic mastery inferred by reinterpreting all historical accuracy.

## Product and Data Decisions

### Legacy migration

Migrate and include in backups:

- `k1frx.curriculum.v2`, with compatible `v1` handling where practical:
  - unlocked characters;
  - per-character performance;
  - review and remediation state;
  - advancement-related progress.
- `k1frx.introduced.v1`:
  - characters whose introductions have been completed.
- `k1frx.settings.v1`:
  - character and effective speed;
  - tone frequency and volume;
  - noise level;
  - pacing;
  - continuous-copy duration.

Do not migrate or export `k1frx.audioOutput.v1`. The output-device ID is
browser and device specific, can expose an opaque hardware identifier, and is
usually meaningless after restoration on another device.

Legacy migration must be:

- idempotent;
- transactional;
- validated and normalized;
- marked complete only after IndexedDB writes succeed;
- tested for missing, partial, malformed, and older data;
- protected by a durable marker outside IndexedDB.

After successful migration, IndexedDB becomes the source of truth and portable
state must no longer be read from or written to localStorage.

Use an external marker such as `k1frx.legacyMigration.v1` and move the original
values into an explicitly named rollback snapshot such as
`k1frx.legacyRollback.v1`. After the IndexedDB transaction commits:

1. Write the rollback snapshot.
2. Write the external completion marker.
3. Remove the original active legacy keys.

The presence of either the completion marker or rollback snapshot permanently
suppresses automatic legacy migration, even if IndexedDB is later cleared.
Post-commit finalization is idempotent and retried on startup when the database
migration ledger is complete but localStorage cleanup was interrupted. Reset
must preserve the external marker. Restoring the rollback snapshot is an
explicit recovery action and never an automatic bootstrap behavior.

### Import behavior

Phase 4 ships replace-only import. Merge remains deferred until duplicate
identity, ordering, curriculum conflicts, review flags, aggregate double
counting, settings precedence, and cross-version conflict resolution are fully
specified.

The replace-import flow must:

1. Parse and validate the complete backup before changing current data.
2. Show a summary of the records and progress that will be replaced.
3. Require explicit confirmation.
4. Replace all portable user data in one IndexedDB transaction.
5. Roll back completely if any write or validation step fails.
6. Reload application state only after the transaction succeeds.

### Interrupted sessions

On startup, convert each unfinished active session into a completed record with
`status: "interrupted"`, then begin from normal onboarding rather than trying to
reconstruct the exact lesson.

Preserve:

- completed, committed attempts;
- completed-card counts;
- active duration persisted before interruption;
- character and error metrics already earned;
- scheduling and review changes from committed answers.

Discard:

- the unfinished prompt;
- queued input;
- partial feedback;
- audio position;
- timers;
- incomplete continuous-copy input and grading.

An interrupted session must never generate an advancement offer, unlock a
character, or count incomplete continuous copy as evidence. It remains
identifiable in history and counts toward activity metrics only if it had
already met the normal valid-session threshold.

### Practice history

Persist finalized attempts from:

- Learn RX;
- Copy Practice RX;
- Send Practice TX.

All sources use one shared attempt model with explicit source and direction.
Only finalized attempts are persisted. Text edits, partial key transitions,
unfinished prompts, and incomplete continuous-copy input are not attempts.

Practice affects analytics only. It must not:

- unlock characters;
- clear Learn remediation;
- create advancement offers;
- change mastery or curriculum milestones;
- blend TX accuracy into RX accuracy.

### Durable mastery

Accepted advancement is the durable mastery event. When a learner accepts a
valid advancement offer:

1. Revalidate the evidence and active set.
2. Mark every character in the assessed active set as mastered.
3. Emit explicit mastery milestones for newly mastered characters.
4. Unlock exactly one next character.
5. Mark the new character as learning.
6. Emit an unlock milestone.
7. Persist the source curriculum state, advancement/mastery events, milestones,
  and session change atomically.

Do not equate unlocked with mastered. Do not dynamically infer mastery from all
accumulated attempts, because thresholds and later Practice history can change.

For migrated state, infer all unlocked characters except the newest as
mastered. Treat the newest as learning and mark inferred milestones as
migration-derived.

The final curriculum character has no next-character button. It must still
meet the normal completed-stream coverage, review, evidence-size, overall
accuracy, and newest-character accuracy requirements. A qualifying final
stream creates a curriculum-completed mastery event that marks the remaining
active set mastered. The existing `COMPLETE` result, which currently means
only that no character remains locked, is not sufficient evidence.

## Architecture

### Dependencies

Add:

- Dexie as the IndexedDB wrapper;
- Zod for strict backup and migration validation;
- `fake-indexeddb` for deterministic database tests.

Expose the application package version to runtime code for session and backup
metadata.

### Layer boundaries

- `src/core`, `src/content`, and pure training services remain independent of
  React, the DOM, IndexedDB, and Dexie.
- `src/data` owns persistence models, repository interfaces, Dexie adapters,
  migrations, backup validation, and projections.
- `src/analytics` owns pure date, streak, metric, confusion, and projection
  calculations.
- React consumes repository interfaces through a data provider and bounded
  view models.
- Dexie types must not escape the data adapter.

## Phase A: Data Contracts and Versioned Storage

### Persisted records

Every user-owned record must include:

- a stable UUIDv4 `id`;
- an ISO `updatedAt` timestamp;
- the applicable schema version.

Clock and ID factories must be injectable in tests.

Define records for:

- schema metadata and migration ledger;
- portable settings;
- current curriculum state and completed introductions;
- training sessions;
- attempts;
- advancement and mastery events;
- milestones;
- daily metric projections;
- per-character recent projections;
- directional confusion projections.

Current curriculum state, introductions, settings, sessions, attempts, domain
events, milestones, and schema metadata are source-of-truth records. Daily,
character, confusion, and dashboard data are derived projections and must
always be rebuildable from those records.

### Shared attempt model

The attempt record must support:

- `sessionId`;
- a UTC occurrence timestamp;
- the captured local calendar date;
- the UTC offset in minutes at occurrence time;
- the IANA timezone when available;
- source: `learn`, `copy-practice`, or `send-practice`;
- direction: `rx` or `tx`;
- exercise type;
- raw target;
- raw typed response or decoded value;
- normalized target and response;
- correctness;
- assisted and replayed flags;
- scheduler reason where applicable;
- character, effective speed, tone, and noise settings;
- optional response duration and keying measurements;
- deterministic target-position character observations;
- a scoring and alignment algorithm version.

Sessions also capture their start UTC timestamp, local calendar date, UTC
offset, and IANA timezone when available. End timestamps remain UTC. Active-time
date buckets capture the local date and offset that applied while the time was
earned. Historical daily metrics use these captured local dates and never
reinterpret old UTC timestamps in the device's current timezone after travel
or restore.

TX attempts store bounded compact mark/space timing, an optional dit estimate,
and never retain individual raw key edges. Use encoding
`u32-ms-le-v1`: unsigned 32-bit integer millisecond samples in IndexedDB and
base64-encoded little-endian bytes in backups. Retain at most 512 marks and the
corresponding first 511 inter-mark spaces per attempt. Store original sample
counts and `timingTruncated: true` when input exceeds the cap. Oversized values
are clamped to the unsigned 32-bit range and set `timingOverflowed: true`.
Backups include this bounded timing payload and never include uncapped timing or
raw key edges.

Character observations should carry enough information to rebuild accuracy and
directional confusion metrics, including target character, aligned answer when
present, correctness, error kind, and target position.

### Tables and indexes

Index at least:

- session status, start time, mode, and source;
- attempts by session, time, direction, and source;
- milestones by time and type;
- daily projections by local date;
- character projections by character and direction;
- confusion projections by target and answer.

### Schema history

No IndexedDB schema has shipped before Phase 4. Legacy localStorage migration
is separate from IndexedDB schema upgrades and must not be described as a
database v1-to-v2 migration.

Intentionally ship the live database at version 2 with a tested synthetic
version 1 fixture:

- Version 1 contains all durable user records with stable IDs and timestamps.
- Version 2 adds and indexes analytics projections, rebuilding them from
  version 1 raw records.

This establishes and proves the upgrade mechanism before production databases
exist, rather than claiming that users already have an IndexedDB v1. Test fresh
v2 creation and fixture-based v1-to-v2 upgrade. The upgrade must preserve IDs,
timestamps, source records, and metric totals.

### Idempotency

Assign each attempt a stable ID before enqueueing its first write and reuse it
for every retry. Define deterministic unique operation keys for:

- advancement events from session ID, evidence-attempt ID, active-set version,
  and proposed character;
- mastery milestones from advancement-event ID and character;
- session finalization from session ID;
- interrupted recovery from session ID and the active session revision;
- import from backup digest and the target dataset generation captured when the
  replacement was confirmed.

Repository transactions enforce uniqueness and compare expected record
revisions. Retrying after a lost response or partial UI failure must return the
already committed result rather than duplicate an attempt, session,
advancement, milestone, recovery, or import operation. A later intentional
import against a different dataset generation remains a new operation.

### Repository interface

Repository operations must cover:

- bootstrap and migration;
- atomic session, attempt, progress, milestone, and settings writes;
- interrupted-session recovery;
- bounded dashboard and character queries;
- projection rebuild and verification;
- export, import, and reset.

## Phase B: Bootstrap, Legacy Migration, and Recovery

Add a data bootstrap provider above the settings and audio providers. It must:

1. Open and upgrade the database.
2. Run legacy migration once.
3. Recover interrupted sessions.
4. Load portable settings and progress.
5. Supply repository operations to the application.

Display explicit loading, unavailable-storage, and retry states. Do not silently
continue training without durable persistence.

### Multiple tabs and storage availability

Give each tab an ephemeral owner ID and use session revisions plus a renewable
lease to coordinate active sessions. Session finalization is a transactional
compare-and-set from `active` to one terminal status. If two tabs attempt to
finalize the same session, exactly one transition wins and the other reads the
committed result. Recovery is safe to invoke repeatedly and cannot replace a
normal finalization or create duplicate interrupted records.

When an IndexedDB upgrade is blocked by another open tab:

- close this tab's connection on `versionchange`;
- notify tabs through `BroadcastChannel` where available;
- show a clear close-or-reload-other-tabs state;
- retry only after the blocker is released.

If IndexedDB is unavailable at bootstrap, do not start a training session.
Show retry and data-recovery guidance. If quota or another write failure occurs
during a session, retain unsaved ordinary writes in an ordered in-memory queue,
show persistent unsaved/retry status, disable progression-changing operations,
and require the queue to flush or be explicitly discarded before final session
closure. Never claim unsaved work was committed.

Request `navigator.storage.persist()` after an appropriate user gesture when
supported and expose whether persistence was granted. The app must continue to
work when it is denied. Export remains the real user-controlled backup and
recovery mechanism.

Legacy migration must:

- prefer curriculum v2 and handle compatible v1 data;
- validate character order and state field by field;
- preserve review streaks, review flags, attempt windows, timestamps, and
  advancement-relevant fields;
- deduplicate and validate introduced characters;
- normalize settings through the existing domain function;
- default only invalid or missing portions;
- write migration-derived mastery milestones;
- commit all portable state and the migration ledger in one transaction.

Settings writes must be serialized. Failed writes should remain visible and
retry with the same stable record ID instead of silently diverging.

## Phase C: Finalized Evidence and Active Time

### Detailed alignment

Extend detailed copy alignment to expose target-position observations while
preserving all current grading outputs and tie-breaking behavior. Use the same
alignment for Learn groups, words, continuous copy, and Copy Practice.

Extend `LearnSession` outcomes with persistence-ready domain evidence while
keeping IDs, wall-clock timestamps, storage, and React outside the pure
training service.

Assisted and replayed exercises may be retained as teaching history, but they
are ineligible for curriculum, mastery, accuracy, latency, and confusion
projections.

### Shared active-time tracker

Extract a pure active-time tracker from the current Learn semantics:

- count at most 60 seconds between consecutive activities;
- pause while the page is hidden or the app is backgrounded;
- resume without counting hidden time;
- capture UTC time, local calendar date, UTC offset, and IANA timezone when
  available at each persisted activity boundary;
- split active time into captured local-date buckets across midnight and DST
  boundaries without reinterpreting them later;
- require at least 30 seconds and one finalized attempt for a valid session;
- tolerate wall-clock rollback without producing negative time.

Persist timing snapshots after finalized attempts, when hidden or paused, and
on normal session end. Crash recovery retains only the last committed snapshot.

## Phase D: Learn Persistence and Advancement

Create the durable Learn session before presenting its first lesson event.

Enqueue each finalized isolated, group, word, or completed-stream attempt in an
ordered persistence queue. Update the in-memory session state immediately so
ordinary persistence does not introduce noticeable delay between Morse
prompts. The queue writes the attempt, current curriculum state, session
counters, and active-time snapshot transactionally and in order.

Completed introductions update introduced-character state without inventing an
attempt. Completed continuous copy is stored as one attempt with its aligned
character observations. Abandoned or interrupted streams do not create
advancement evidence.

Measure RX response latency only for unassisted isolated-character recognition,
from prompt-audio completion to accepted response. An answer queued while audio
is playing records zero. Leave latency absent for groups, words, continuous
copy, and assisted or replayed cards.

Only progression-changing operations are critical writes that block the UI:

- accepting advancement;
- unlocking a character;
- recording mastery;
- recording final curriculum completion;
- import and reset.

Ordinary attempt persistence, settings writes, and active-time snapshots do not
block prompt-to-prompt listening flow. Assign stable IDs before enqueueing,
surface failed writes through persistent retry/recovery status, and await the
ordered queue before normal or interrupted session finalization. Advancement
and final completion remain disabled while ordinary writes are unsaved. Do not
display or begin an unlock until its critical transaction commits.

Advancement acceptance must use copy-on-write state and one atomic repository
operation. A failed commit leaves the existing active set and UI unchanged.

Refine the final-curriculum evaluator so all evidence checks still run when no
character remains locked. Distinguish a final qualifying result from already
persisted curriculum completion and protect completion milestones from
duplicate creation.

## Phase E: Practice Persistence

### Practice sessions

Add a shared Practice session controller:

- Copy Practice starts a session when Start is selected.
- Send Practice starts a session on the first key contact.
- Hidden/background time pauses the active-time tracker.
- Switching Copy/Send tabs closes the prior session.
- Route changes and unmount close normal sessions.
- Startup recovery handles crashes and forced termination.

### Copy Practice RX

- Finalize one RX attempt when Check is selected.
- Selecting Next before Check discards the unfinished prompt.
- Replay marks the eventual attempt assisted.
- Grade with detailed deterministic alignment.
- Snapshot the applicable audio and timing settings.
- Measure prompt-level response time from audio completion to Check, but do not
  present it as isolated-character recognition latency.

### Send Practice TX

- Finalize one successful TX attempt when the target first decodes exactly.
- Selecting New target commits a non-empty unmatched decode as incorrect before
  advancing.
- Empty targets and Clear are discarded.
- Store decoded text and compact marks/spaces timing from `StraightKey.decode()`.
- Apply the shared 512-mark/511-space cap, encoding version, truncation flags,
  and original sample counts before persistence.
- Use a stable prompt token to prevent duplicate success writes.

Tests must prove that Practice writes cannot mutate curriculum, introduced
state, review streaks, mastery, milestones, or advancement.

## Phase F: Analytics and Bounded Queries

Implement pure projectors with transactional updates. Raw attempts remain the
source of truth; daily, per-character, confusion, and progress projections must
be rebuildable.

Attempt retries and upserts must not double count. Import and migrations must
rebuild or verify projections before exposing imported data.

### Metric definitions

Document these definitions in `docs/metrics.md`.

#### Eligible session

A session is eligible for session, streak, and activity metrics when it has:

- at least 30 seconds of active time; and
- at least one finalized attempt.

An interrupted session counts only if it met both requirements before the last
committed snapshot.

Session validity applies only to session counts, active-time totals, practice
days, and streaks. It does not decide whether a finalized attempt contributes
to accuracy.

#### Active practice

- Today: eligible active milliseconds assigned to the current local date.
- This week: eligible active milliseconds from Monday through the current
  local date.
- All time: all eligible active milliseconds.

#### Practice days and streaks

A practice day has at least 30 aggregate active seconds and one finalized
attempt on that local date.

The current streak may end today or yesterday. A fully missed intervening day
resets it. Missed days never remove progress or produce punitive messaging.

#### Session totals

- Session count includes eligible sessions.
- Average duration is mean active duration across eligible sessions.
- Interrupted status remains available in history even when the session is
  eligible.

#### Accuracy

- RX and TX are always calculated and displayed separately.
- Accuracy is correct target-character observations divided by eligible target
  observations.
- A finalized eligible attempt contributes even when its session ends before
  30 seconds.
- Include clean Learn and Practice groups, words, isolated prompts, completed
  continuous copy, and finalized Send Practice attempts.
- Exclude assisted, replayed, abandoned, unfinished, or uncommitted work.
- Include sample sizes wherever low counts could mislead.

#### Trends

- Show the latest 30 local calendar days.
- Effective WPM is the daily mean across eligible session snapshots.
- RX and TX accuracy use separate trend series.

#### Character metrics

- Recent accuracy uses the latest 50 eligible observations for each character
  and direction.
- RX latency is the median of the latest 20 unassisted isolated RX samples with
  recorded response times.
- Always display the applicable sample count.

#### Confusion pairs

- A confusion is the directional ordered RX substitution `(target, answer)`.
- `(U, V)` and `(V, U)` are different pairs.
- Use deterministic aligned substitutions from eligible observations.
- Exclude insertions, deletions, assisted work, and TX attempts.
- Aggregate over each target character's latest 50 eligible RX observations.
- A pair is recurring at a named default minimum of three occurrences.

#### Unlocks and milestones

- Unlock and mastery history comes from explicit durable milestones.
- The dashboard returns the latest 10 milestones.
- Threshold changes must not rewrite historical mastery events.

### Bounded dashboard result

React receives one bounded dashboard view model containing:

- today, week, and all-time totals;
- session and streak summaries;
- at most 30 daily trend points;
- rows for the current active curriculum characters;
- top recurring confusion pairs;
- the latest 10 milestones.

Never load the complete attempt history into React state.

### Large-data budget

Build a deterministic 100,000-attempt fixture and document the machine,
database size, and representative timings. The fixture must represent TX data,
not only small RX attempts: include at least 25% TX attempts with realistic
short timing arrays, longer sends, bounded near-cap payloads, and explicit
truncation cases. Report source-record and projection sizes separately.

Initial available-environment budgets:

- dashboard snapshot query: at most 500 ms;
- character detail query: at most 500 ms;
- export generation: at most 5 seconds.

Keep timing-sensitive benchmarking separate from default unit tests while
retaining correctness coverage over the large fixture.

## Phase G: Progress and Data Management UI

### Progress dashboard

Replace the `/progress` placeholder with a responsive, work-focused dashboard
showing:

- training today, this week, and all time;
- eligible session count and average active duration;
- practice days, current streak, and longest streak;
- current character and current WPM;
- unlocked and mastered character history;
- 30-day effective-WPM trend;
- separate RX and TX accuracy trends;
- per-character recent accuracy and RX latency;
- directional confusion pairs;
- recent milestones.

Provide honest loading, no-data, low-sample, unavailable-storage, and query
error states. Do not synthesize TX values before TX attempts exist.

A Progress query hook should subscribe to repository revision changes and
refresh after session commits, imports, and reset. All calculations stay in
analytics and data services rather than React components.

### Export

The JSON backup exports only source-of-truth portable records:

- a fixed format identifier and format version;
- database schema version;
- exported timestamp;
- application version;
- portable settings;
- current curriculum state;
- completed introductions;
- sessions;
- attempts;
- advancement and mastery events;
- milestones;
- schema metadata needed to validate and restore the records;
- record counts;
- SHA-256 integrity metadata over a canonical payload.

Exclude the audio output ID and every daily, character, confusion, and
dashboard projection. Import rebuilds all projections from source records so a
backup cannot carry derived state inconsistent with its raw history.

### Import validation

Validate the entire backup with structural and semantic checks:

- supported format and schema versions;
- rejection of future versions;
- valid UUIDs, ISO timestamps, and record schema versions;
- unique record IDs;
- valid attempt-to-session references;
- normalized settings;
- valid curriculum order and character-state invariants;
- matching record counts and integrity digest.

Before confirmation, show record counts, date range, current progress, and
settings that will be restored. After confirmation, replace all portable data
atomically, rebuild projections from imported source records, verify exact
metric fixtures, and refresh providers only after success. Use the deterministic
import operation key so retry after an uncertain response cannot duplicate
domain events or partially repeat replacement.

### Reset

Reset requires a destructive confirmation dialog and typed `RESET`. Replace
portable user data atomically with fresh defaults while preserving:

- `k1frx.audioOutput.v1`;
- the legacy-migration completion marker, so stale localStorage data cannot be
  imported again.

## Phase H: Hardening and Documentation

Add tests for:

- fresh database creation and every migration path;
- reload and restart persistence;
- missing, partial, malformed, and older localStorage migration;
- StrictMode-safe bootstrap;
- interrupted-session recovery;
- idle, hidden, midnight, DST, and wall-clock rollback timing;
- transaction rollback and write retry;
- nonblocking ordered attempt writes and failed-queue recovery;
- deterministic idempotency for attempts, advancement, mastery milestones,
  session finalization, interrupted recovery, and import;
- blocked upgrades, competing-tab finalization, repeated recovery, unavailable
  IndexedDB, and quota exhaustion;
- Learn and Practice attempt boundaries;
- durable advancement and final-curriculum completion;
- exact hand-calculated analytics fixtures;
- projection rebuild equivalence;
- export-reset-import record and metric equivalence;
- malformed, incompatible, future-version, and bad-integrity import rejection;
- reset preservation of audio output selection;
- prevention of stale legacy remigration after IndexedDB clear or reset;
- captured local-date behavior after timezone travel or restore;
- TX timing encoding, caps, truncation, backup restoration, and overflow;
- backup exclusion and import rebuilding of all projection tables;
- the generated 100,000-attempt RX/TX data set.

Add:

- `docs/data-model.md`, covering records, indexes, transaction boundaries,
  intentional IndexedDB v1/v2 history, localStorage migration, idempotency,
  multi-tab coordination, recovery, timing caps, backup format, and
  source-of-truth rules;
- `docs/metrics.md`, covering every displayed formula, window, exclusion,
  date/streak rule, sample-size rule, database size, and benchmark result.

Update:

- `README.md` with persistence architecture and data ownership;
- `.plans/STATUS.md` with Milestone 4 status and exact verification;
- stale documentation that still describes a separate checkpoint flow.

## Likely Files

### New

- `src/data/models.ts`
- `src/data/repository.ts`
- `src/data/indexeddb.ts`
- `src/data/migrations.ts`
- `src/data/legacy-migration.ts`
- `src/data/projections.ts`
- `src/data/transfer.ts`
- `src/analytics/dates.ts`
- `src/analytics/metrics.ts`
- `src/analytics/confusions.ts`
- `src/analytics/projector.ts`
- `src/training/session-time.ts`
- `src/ui/data-context.ts`
- `src/ui/data-provider.tsx`
- `src/ui/hooks/useProgress.ts`
- `src/ui/screens/ProgressScreen.tsx`
- `docs/data-model.md`
- `docs/metrics.md`

### Existing integration points

- `package.json`
- `vite.config.ts`
- `src/vite-env.d.ts`
- `src/core/scoring.ts`
- `src/core/types.ts`
- `src/core/curriculum.ts`
- `src/training/advancement.ts`
- `src/training/continuous-copy.ts`
- `src/training/learn-session.ts`
- `src/ui/hooks/useLearnSession.ts`
- `src/ui/screens/LearnScreen.tsx`
- `src/ui/screens/CopyPractice.tsx`
- `src/ui/screens/SendPractice.tsx`
- `src/ui/screens/PracticeScreen.tsx`
- `src/ui/settings-context.ts`
- `src/ui/settings-provider.tsx`
- `src/ui/screens/SettingsScreen.tsx`
- `src/App.tsx`
- `src/main.tsx`
- `src/global.css`
- `README.md`
- `.plans/STATUS.md`

## Implementation Sequence

1. Add dependencies, persistence models, repository interfaces, and schema
   migrations.
2. Prove database creation and migration fixtures.
3. Add bootstrap, legacy migration, and interrupted-session recovery.
4. Move settings and current progress to IndexedDB.
5. Add detailed alignment observations and the shared active-time tracker.
6. Integrate transactional Learn attempts and write recovery.
7. Integrate durable mastery, accepted advancement, and final completion.
8. Instrument Copy and Send Practice sessions and finalized attempts.
9. Add pure analytics projectors, projections, and bounded queries.
10. Build the Progress dashboard.
11. Add export, import preview and replacement, and reset.
12. Add data and metric documentation plus the large-data benchmark.
13. Correct stale checkpoint/status documentation.
14. Run all automated and manual milestone gates.

## Verification

### Focused tests

```bash
npm test -- src/core/scoring.test.ts \
  src/training/session-time.test.ts \
  src/training/advancement.test.ts \
  src/training/learn-session.test.ts

npm test -- src/data/
npm test -- src/analytics/

npm test -- src/ui/hooks/useLearnSession.test.tsx \
  src/ui/screens/LearnScreen.test.tsx \
  src/ui/screens/PracticeScreen.test.tsx \
  src/ui/screens/ProgressScreen.test.tsx \
  src/ui/screens/SettingsScreen.test.tsx
```

### Full gates

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run benchmark:data
```

### Manual browser checks

Verify at desktop and narrow mobile widths:

- migration from existing localStorage state;
- prevention of stale rollback-state remigration;
- normal and interrupted Learn sessions;
- Copy and Send Practice attempt recording;
- dashboard refresh and low-sample states;
- export, reset, and import round trip;
- blocked-upgrade and competing-tab behavior;
- unavailable and quota-exceeded storage behavior;
- malformed and future-version import rejection;
- reset preservation of audio output selection;
- no runtime console errors or layout overflow.

## Milestone 4 Gate

Phase 4 is complete when:

- refresh and restart preserve progress and finalized history;
- every schema migration fixture upgrades without data loss;
- interrupted sessions preserve committed work without generating advancement;
- analytics match hand-computed fixtures and documented date rules;
- export contains no projections, and reset/import rebuilds equivalent records
  and metric totals from source data;
- malformed, incompatible, and future-version imports leave current data
  unchanged;
- retries and multi-tab races cannot duplicate attempts, finalizations,
  advancement, mastery, recovery, or imports;
- the 100,000-attempt dataset remains within the documented budget;
- `docs/data-model.md` and `docs/metrics.md` are complete;
- formatting, lint, typecheck, unit tests, production build, and browser smoke
  checks pass.