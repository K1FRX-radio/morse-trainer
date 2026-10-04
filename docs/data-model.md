# Data model

This document describes the persistence model implemented in `src/data` for K1FRX Morse Trainer.

## Authoritative vs derived data

The app separates:

- authoritative records (source of truth): sessions, attempts, settings, curriculum, introductions, progression events, milestones, metadata
- derived projections (rebuildable caches): daily projections, per-character projections, confusion projections

Only authoritative records are portable. Projections are rebuilt from sessions and attempts.

## IndexedDB stores and indexes

Schema is defined in `src/data/indexeddb.ts`.

### Authoritative stores

- `metadata`: `&id, schemaVersion, updatedAt, kind, migration, operation`
- `settings`: `&id, schemaVersion, updatedAt`
- `curriculum`: `&id, schemaVersion, updatedAt`
- `introductions`: `&id, schemaVersion, updatedAt`
- `sessions`: `&id, status, startedAt.utc, startedAt.localDate, mode, source, updatedAt, [status+updatedAt]`
- `attempts`: `&id, sessionId, occurredAt.utc, occurredAt.localDate, direction, source, updatedAt, [sessionId+occurredAt.utc], [direction+occurredAt.utc], [source+occurredAt.utc]`
- `progressionEvents`: `&id, &idempotencyKey, type, occurredAt.utc, sessionId, updatedAt`
- `milestones`: `&id, &idempotencyKey, type, occurredAt.utc, eventId, updatedAt`

### Derived projection stores

- `dailyProjections`: `&id, &localDate, projectionVersion, updatedAt`
- `characterProjections`: `&id, [character+direction], character, direction, projectionVersion, updatedAt`
- `confusionProjections`: `&id, [target+answer], target, answer, count, projectionVersion, updatedAt`

## Schema and migration history

- `DATABASE_VERSION = 1`: authoritative stores only
- `DATABASE_VERSION = 2`: adds projection stores and upgrade logic that rebuilds projections from sessions/attempts

Record schema version is tracked as `RECORD_SCHEMA_VERSION` (currently `1`).

## Transaction boundaries

Repository methods enforce explicit transaction scopes.

- session attempt commits: session/attempt (+ optional curriculum/introductions) are written atomically
- session finalization/interruption: writes finalized session + operation ledger + full projection rebuild atomically
- interrupted-session recovery: marks recovered sessions + operation ledgers + full projection rebuild atomically
- projection rebuild: clears and rewrites all projection tables in one transaction
- backup export: authoritative snapshot read in one readonly transaction
- backup replace import: clear/write authoritative + projection tables + operation ledger in one transaction
- reset: clear and repopulate authoritative defaults + clear projections in one transaction
- legacy migration commit: all migrated authoritative records + migration ledger in one transaction

## Metadata, idempotency, and operation ledgers

`metadata` contains three record categories:

- schema metadata (`id = schema-metadata`) with `datasetGeneration`
- migration ledgers (`kind = migration`)
- operation ledgers (`kind = operation`)

Idempotency rules:

- advancement accept uses operation ledgers keyed by idempotency key
- finalization and recovery use `finalizationKey` and store operation ledgers (`finalize-session`, `interrupt-session`, `recover-interrupted-session`)
- replace-import uses a deterministic operation key (backup digest + target dataset generation)
  - repeated confirmed call returns `already-applied`
  - stale confirmation is rejected

## Legacy localStorage migration and rollback markers

Legacy keys are migrated from localStorage into authoritative stores once:

- settings: `k1frx.settings.v1`
- curriculum snapshots: `k1frx.curriculum.v1`, `k1frx.curriculum.v2`
- introductions: `k1frx.introduced.v1`

Safety markers:

- migration marker: `k1frx.legacyMigration.v1`
- rollback capture: `k1frx.legacyRollback.v1`

On migration finalization, rollback data is captured (if missing), marker is written, and old legacy keys are removed.

## Session ownership and multi-tab behavior

Active sessions carry `ownerTabId` and `leaseExpiresAt`.

- only current owner may renew lease
- lease renewal requires expected revision
- expired leases can be recovered into interrupted terminal sessions
- recovery clears ownership fields and writes operation ledgers

## Interrupted-session recovery

Recovery targets active sessions with expired/absent lease.

For each recoverable session:

- mark `status = interrupted`
- set `endedAt` and increment `revision`
- compute validity from policy (not trusted from stale `valid` flag)
- write recovery operation ledger
- rebuild projections from full authoritative dataset

## Validity, active time, and date buckets

Session validity is source-aware (`src/data/session-validity-policy.ts`):

- non-imported sessions require minimum active time plus finalized attempt evidence
- imported-text RX requires minimum active time only

`activeDateBuckets` must sum to `activeMs` exactly (validated). Buckets carry local date and UTC offset so day-based analytics do not need retroactive timezone inference.

## Keying timing encoding and caps

Keying timing payloads use `u32-ms-le-v1` encoding:

- marks/spaces are little-endian uint32 sample arrays encoded as base64
- samples are clamped to uint32 max and normalized to non-negative integers
- caps:
  - max mark samples: 512
  - max space samples: 511
- records track truncation and overflow flags

## Backup/import/reset model

Portable backup (`k1frx-portable-backup`) includes authoritative records only:

- settings, curriculum, introductions
- sessions, attempts
- progression events, milestones
- schema metadata
- migration ledgers

It excludes output-device localStorage and all projection tables.

Integrity and validation:

- canonicalized payload digest (SHA-256)
- format/version/record schema checks
- payload count checks
- cross-record checks for progression/milestones (duplicate keys, dangling references)

Replace import semantics:

- preview generates replace confirmation from current dataset generation + backup digest
- replace requires matching confirmation
- stale confirmations are rejected
- import rewrites authoritative records and rebuilds projections atomically

Reset semantics:

- restores first-run portable defaults
- creates new dataset generation
- preserves migration ledgers and external localStorage migration markers
