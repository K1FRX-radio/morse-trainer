# Status

## Current milestone

Milestone 4 (Persistence and analytics MVP) is active.

The app has moved from portable browser-only state to a versioned IndexedDB
runtime data layer and now exposes persisted analytics in the History screen.
Milestone 5 (PWA/install/release polish) has not started.

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
- Practice modes:
  - Copy Practice (RX);
  - Send Practice (TX);
  - imported-text RX practice.
- Shared active-time tracking semantics across Learn and Practice sessions.
- Data layer and persistence:
  - Dexie-backed IndexedDB repository;
  - schema-versioned records for settings, curriculum, sessions, attempts,
    projections, and events;
  - legacy localStorage migration during bootstrap;
  - interrupted-session recovery that finalizes unfinished sessions as
    `interrupted`.
- Durable session/attempt persistence for Learn, Copy Practice, and Send
  Practice.
- Analytics projections and History UI (`/history`):
  - 30-day daily trend rows;
  - aggregate RX/TX summary metrics;
  - difficult-character summaries;
  - recent directional confusion pairs.
- Audio and device behavior:
  - scheduled CW playback, anti-click handling, and replay safety;
  - output-device selection support where browser APIs permit it.

## In progress

- Milestone 4 dashboard refinement for Learn onboarding and familiarity mapping
  (active feature branch / PR flow).
- Ongoing tuning and regression hardening for continuous-copy weighting and
  pacing recommendations.

## Remaining for Milestone 4 gate

1. Finalize Milestone 4 dashboard scope in Learn (progress/familiarity surfaces).
2. Ensure backup/import/reset scope and behavior match the master plan gate.
3. Complete/update milestone documentation and hand-computed fixture coverage
   where needed.
4. Keep migration, interruption, and projection rebuild scenarios covered by
   deterministic tests.

## Milestone 5 and later (not started)

- PWA manifest/service worker and installability flow.
- Production release polish for mobile standalone usage.
- Capacitor feasibility and Android alpha work.

## Risks and manual verification still needed

- Real-device audio quality/timing and hardware-input behavior remain manual
  checks.
- Browser API differences (notably output-device routing support) still require
  cross-browser smoke coverage beyond unit tests.

## References

- Master plan:
  `docs/K1FRX_MORSE_TRAINER_PROJECT_PLAN_AND_BUILD_PROMPT.md`
- Milestone 4 plan:
  `docs/Phase4_plan.md`
