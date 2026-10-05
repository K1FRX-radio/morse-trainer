# Roadmap

This file is the authoritative implementation order for repository work.

GitHub issues remain the source of truth for task requirements. This file answers
only which issue should be implemented next and what follows it.

## Next

- #60 — Design speed-aware CW proficiency with discrete global WPM bands

## Queue

1. #52 — Phase 5 kickoff: installable PWA foundation, offline shell, and safe updates

## Later / stretch

- #61 — Architecture review: modularize oversized files and reduce structural coupling
- #43 — Add external CW paddle support via USB HID/MIDI

## Blocked / awaiting decision

None.

## Recently completed

- #51 — Checkpoint 4: audit and close Persistence & Analytics milestone
- #58 — Milestone 4 blocker: finish IndexedDB lifecycle hardening and browser acceptance checks
- #57 — Milestone 4 blocker: complete Progress dashboard contract and analytics semantics
- #50 — Milestone 4: publish data/metrics docs and 100k-history benchmark
- #49 — Milestone 4: finish versioned backup, replace-import, and reset
- #28 — Cleanup: remove dead 3-char notice delay configuration
- #29 — Add regression: Send Practice does not mutate Learn progression
- #31 — Isolate GitHub Pages deployment concurrency from PR CI

## Maintenance contract

Roadmap-item implementation PRs must update this file in the same PR:

1. Move the completed `Next` issue to the top of `Recently completed`.
2. Promote the first issue in `Queue` to `Next`.
3. Preserve the order of the remaining queue.
4. Keep `Recently completed` concise; retain roughly the latest 8 items.
5. Do not reorder, skip, add, or remove queued work unless the user explicitly
   changes priority or a newly discovered blocker requires escalation.
6. Items under `Later / stretch` are not part of the automatic execution queue
   and must not be promoted unless the user explicitly reprioritizes them.

If `Next` is closed, blocked, already has an active implementation PR, or
otherwise cannot be started safely, do not silently choose another issue.
Report the stale/blocking condition so the roadmap can be corrected.
