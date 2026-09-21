# Status

## Current milestone

Milestone 1 — new repository and tested pure core (stopping at Checkpoint 1).

## Done

- Phase 0 discovery: inventoried the legacy `morse-trainer.html` prototype (see
  `docs/legacy-behavior.md`), confirmed the word-gap stacking bug.
- Scaffolded Vite + React 19 + strict TypeScript, ESLint (flat) + Prettier,
  Vitest + Testing Library, CI workflow.
- Pure core (no React/DOM/storage imports, enforced by ESLint):
  - `core/morse.ts` — standard Morse map, encode/decode, round-trip tested.
  - `core/timing.ts` — standard + Farnsworth schedule generation; word gaps are
    a single 7-unit gap (bug fixed); golden vectors tested.
  - `core/curriculum.ts` + `content/curriculum-data.ts` — classic Koch order,
    rolling-window RX unlocks, RX/TX separation, never-relock, needsReview.
  - `core/scheduler.ts` + `core/rng.ts` — seeded deterministic selection,
    unlocked-only, reason codes.
- Minimal responsive app shell with Learn/Practice/Progress/Settings routes.

## Known issues / notes

- Package versions use caret ranges; lockfile is committed after first install.
- Playwright E2E is deferred to a later milestone (dependency not yet added).

## Next steps

1. Checkpoint 1 review: run format/lint/typecheck/test/build from a clean
   checkout and confirm the core dependency boundary.
2. On approval, commit and push to the K1FRX-org remote (awaiting authorization).
3. Milestone 2: Web Audio adapter consuming the timing schedule, keyboard/pointer
   keying adapters, Copy/Send parity.

## Decisions requiring confirmation

- Final remote repo owner/name and push authorization.
- Whether any legacy browser state needs migrating.
