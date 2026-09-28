# K1FRX Morse Trainer

Web-first CW learning app with Koch-style progression, Farnsworth timing,
adaptive review, RX-only lessons, and learner-controlled advancement. Lessons
progress from isolated recognition through type-behind groups and words into
timed continuous copy with audible token boundaries. A strong completed stream
offers the next character, which is unlocked only when the learner accepts.

## Requirements

- Node >= 20 (developed on Node 22)
- npm

## Getting started

```bash
npm install
npm run dev       # start the dev server
```

## Scripts

| Script                 | Purpose                                   |
| ---------------------- | ----------------------------------------- |
| `npm run dev`          | Vite dev server                           |
| `npm run build`        | Type-check and produce a production build |
| `npm run preview`      | Preview the production build              |
| `npm test`             | Run unit tests (Vitest)                   |
| `npm run test:watch`   | Watch-mode tests                          |
| `npm run typecheck`    | TypeScript, no emit                       |
| `npm run lint`         | ESLint                                    |
| `npm run format`       | Prettier write                            |
| `npm run format:check` | Prettier check (used in CI)               |

## Architecture

The `src/core` and `src/content` layers are pure domain logic and must not
import React, the DOM, storage, or UI code. ESLint enforces this boundary.
The [Learn architecture guide](docs/learn-architecture.md) defines stable phase
contracts, orchestration boundaries, test strategy, and the extension path for
future non-curriculum RX content.

```
src/
  audio/      Web Audio session and CW schedule playback
  core/       Morse map, timing, scoring, curriculum, scheduler, rng, types
  content/    curriculum data and eligible word corpus
  training/   pure lesson, advancement, and continuous-copy domain logic
  ui/         React contexts, hooks, and screens
  test/       test setup
  App.tsx     responsive shell + navigation
  main.tsx    entry
```

## Deployment base path

The Vite `base` and router basename come from `VITE_BASE` so the app can run
under a GitHub Pages subpath or a custom-domain root:

```bash
VITE_BASE=/morse-trainer/ npm run build
```

## Progression guarantees

- Learn contains receive-copy exercises only.
- Practice and continuous copy never unlock characters automatically.
- Advancement uses only the latest completed continuous-copy stream.
- Accepting a valid advancement offer unlocks exactly one character.
- Spaces in continuous-copy input are optional and excluded from grading.

## Learn input guarantees

- Copy fields are available while prompt audio plays, but grading waits for the
  matching playback to finish.
- Isolated copy accepts at most one prompt-bound answer and keeps the same input
  mounted, enabled, and focused through playback, feedback, and Replay.
- Physical auto-repeat and genuinely held keys cannot answer later prompts; a
  fresh same-key press after `keyup` can.
- Prompt changes, replacement playback, session end, navigation, and unmount
  discard queued input so stale answers cannot reach another prompt.

Real-device checks remain necessary for perceived audio quality, hardware
keyboard behavior, and mobile soft-keyboard persistence. Automated tests and
synthetic browser events cannot fully establish those device-level properties.
