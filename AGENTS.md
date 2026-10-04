# Morse Trainer Agent Instructions

## Mission

Maintain and extend the K1FRX Morse Trainer while preserving its learning model,
architecture boundaries, persisted-data compatibility, and test discipline.

## Task selection and roadmap

`docs/ROADMAP.md` is the authoritative implementation order.

When instructed to "pick up the next issue" or equivalent:

1. Read `docs/ROADMAP.md`.
2. Select the issue listed under `## Next`.
3. Verify that the issue is still open and does not already have an active
   implementation PR.
4. Read the full issue before changing code.
5. Execute that issue according to these instructions. Do not silently substitute
   another issue.
6. In the implementation PR, update `docs/ROADMAP.md` in the same change:
   - move the completed `Next` issue to the top of `Recently completed`;
   - promote the first queued issue to `Next`;
   - preserve the remaining queue order.
7. Do not reprioritize, skip, add, or remove roadmap items without explicit user
   direction.
8. If the `Next` issue is closed, blocked, already being implemented, requires
   a product decision, or otherwise cannot be started safely, stop and report
   that condition rather than choosing another task.

GitHub issue bodies are the source of truth for task requirements.
`docs/STATUS.md` describes product/milestone state and is not the task queue.
Update `STATUS.md` only when the completed work materially changes that state.

Do not self-merge implementation PRs unless explicitly instructed.

## PR hygiene

When creating or editing a PR, verify the rendered PR description formatting
before asking for review:

- Ensure headings, lists, links, and issue references render correctly.
- Ensure the body does not contain literal escaped newline sequences (for
  example, `\\n` shown as text).
- After `gh pr create` or `gh pr edit`, read the PR body back (for example via
  `gh pr view --json title,body`) and fix formatting immediately if needed.

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
