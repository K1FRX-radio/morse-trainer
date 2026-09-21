# K1FRX Morse Trainer

Web-first CW learning app: Koch-style progression, Farnsworth timing, adaptive
review, and separate RX/TX mastery. See the project plan for full product and
architecture context.

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

```
src/
  core/       morse map, timing schedule, curriculum, scheduler, rng, types
  content/    curriculum data (Koch order + thresholds)
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

## Status

See [STATUS.md](STATUS.md).
