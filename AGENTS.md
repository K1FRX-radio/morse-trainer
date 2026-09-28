# Morse Trainer Agent Instructions

## Mission

Maintain and extend the K1FRX Morse Trainer while preserving its learning model,
architecture boundaries, persisted-data compatibility, and test discipline.

## Architecture

This is a React + TypeScript + Vite application.

Important architectural boundaries:

- `src/core` and `src/content` are pure domain layers.
- They must not import React, DOM APIs, storage, or UI code.
- `src/training` contains pure lesson, advancement, and continuous-copy logic.
- `src/audio` owns Web Audio playback and scheduling.
- `src/ui` owns React contexts, hooks, and screens.
- Persistence and analytics concerns must not leak into pure domain logic.

Read `README.md` before making architectural changes.

## Product invariants

Do not change these unless the task explicitly requires it:

- Learn contains receive-copy exercises only.
- Practice and continuous copy never unlock characters automatically.
- Advancement uses only the latest completed continuous-copy stream.
- Accepting a valid advancement offer unlocks exactly one character.
- Spaces in continuous-copy input are optional and excluded from grading.
- Learning progression and pedagogy are product behavior, not implementation details.

If a task would alter learning progression, scoring semantics, advancement,
persisted-data meaning, or user-visible training behavior, stop and raise the
decision rather than inventing new behavior.

## Implementation rules

- Prefer small, bounded changes over broad rewrites.
- Preserve existing module boundaries.
- Prefer additive changes when practical.
- Maintain backward compatibility with persisted user data unless migration is
  explicitly part of the task.
- Add regression tests for bug fixes.
- Add tests for new behavior.
- Do not weaken, remove, or bypass tests merely to make a change pass.
- Avoid unrelated cleanup while implementing a scoped task.
- Follow existing naming and code conventions.

## Validation

Before declaring implementation complete, run:

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```
