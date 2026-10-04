# Status

## Current milestone

Milestone 4 (Persistence and analytics MVP) is complete.

The app has moved from portable browser-only state to a versioned IndexedDB
runtime data layer, exposes persisted analytics in the History screen, and now
has durable Learn and Practice workflows with explicit persistence recovery.
Phase 5 is next, starting with issue #52 for installable PWA foundations.

## Completed in repository

- React 19 + strict TypeScript + Vite foundation with ESLint, Prettier, Vitest,
  and production build wiring.
- Pure domain layers (`src/core`, `src/content`, `src/training`) with scheduler,
  scoring, timing, curriculum, and deterministic test coverage.
- Learn flow invariants:
  - RX-only lessons;
  - latest completed continuous-copy evidence for advancement;
  - explicit learner acceptance to unlock exactly one next character;
  - no separate checkpoint mode.
- Learn onboarding dashboard and character familiarity map with curriculum
  progress, unlocked-character detail, preview audio, and direct long-copy
  entry.
- Continuous-copy practice with curriculum-aware generation, advancement
  evidence, reduced newest-character bias, and pause/resume support.
- Practice modes:
  - curriculum-aware Copy Practice (RX);
  - adaptive Send Practice (TX), including grouped and word targets;
  - imported-text RX practice.
- Shared active-time tracking semantics across Learn and Practice sessions,
  including date buckets, pause/idle handling, and persistence invariant
  protection.
- Data layer and persistence:
  - Dexie-backed IndexedDB repository;
  - schema-versioned records for settings, curriculum, sessions, attempts,
    projections, and events;
  - legacy localStorage migration during bootstrap;
  - interrupted-session recovery that finalizes unfinished sessions as
    `interrupted`;
  - explicit diagnostics and safe recovery for retryable and non-retryable Learn
    save failures.
- Durable session/attempt persistence for Learn, Copy Practice, Send Practice,
  and imported-text RX.
- Analytics projections and History UI (`/history`):
  - 30-day daily trend rows;
  - aggregate RX/TX summary metrics;
  - difficult-character summaries;
  - recent directional confusion pairs.
- Audio and device behavior:
  - scheduled CW playback, anti-click handling, and replay safety;
  - output-device selection support where browser APIs permit it.

## Milestone 4 closure evidence

- Checkpoint 4 acceptance audit completed and recorded in
  `docs/checkpoint-4-audit.md`.
- `docs/data-model.md` and `docs/metrics.md` are current for the completed
  persistence and analytics scope.
- Full automated validation and dedicated 100k benchmark passed in the
  checkpoint audit run.

Implementation order is tracked separately in `docs/ROADMAP.md`.

## Milestone 5 and later (not started)

- PWA manifest/service worker and installability flow.
- Production release polish for mobile standalone usage.
- Capacitor feasibility and Android alpha work.
- Hardware-input expansion where appropriate, including external CW paddle
  integrations.

## Risks and manual verification still needed

- Real-device audio quality/timing and hardware-input behavior remain manual
  checks.
- Browser API differences (notably output-device routing support) still require
  cross-browser smoke coverage beyond unit tests.
- Durable persistence changes still benefit from real-device/mobile smoke tests
  in addition to deterministic automated coverage.

## References

- Authoritative implementation order: `docs/ROADMAP.md`
- Master plan:
  `docs/K1FRX_MORSE_TRAINER_PROJECT_PLAN_AND_BUILD_PROMPT.md`
- Milestone 4 plan:
  `docs/Phase4_plan.md`
