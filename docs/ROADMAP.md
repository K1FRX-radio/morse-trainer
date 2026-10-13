# Roadmap

This file is the authoritative implementation order for repository work.

GitHub issues remain the source of truth for task requirements. This file answers
only which issue should be implemented next and what follows it.

The current product-design sequence is tracked by umbrella issue #77. The
individual issues below are the implementation order for that sprint; #77 itself
is not an implementation step and remains open until the sprint is complete.

## Next

- #74 — Define product naming, branding, and production app assets

## Queue

- #79 — UI/UX sprint: establish visual design system and redesign the app shell
- #80 — UI/UX sprint: redesign the Learn experience for focused Morse copy
- #81 — UI/UX sprint: redesign Practice and mode switching
- #82 — UI/UX sprint: redesign History and Progress for useful, low-clutter feedback
- #83 — UI/UX sprint: reorganize Settings and PWA/system surfaces around user intent
- #84 — UI/UX sprint: responsive, accessibility, interaction-state, and visual QA pass

The sequence intentionally starts with UX/IA (#78), then resolves product naming
and branding (#74) before the shared visual system (#79). Screen-specific
redesigns follow on top of that foundation, with whole-app QA (#84) last.

## Later / stretch

- #61 — Architecture review: modularize oversized files and reduce structural coupling
- #70 — External paddle compatibility spike: validate keyboard HID on desktop and Android
- #43 — Add external CW paddle support via USB HID/MIDI (depends on #70 compatibility evidence)

External paddle work remains intentionally later than the UI/UX sprint. The
compatibility spike should run against the established mobile/PWA runtime before
full Send Practice integration.

## Blocked / awaiting decision

- #75 — Automate the agent implementation/review loop with GitHub events
  (implementation PR #76 exists; activation is waiting on API billing/key setup)

## Recently completed

- #78 — UI/UX sprint: audit current flows and define information architecture
- #52 — Phase 5 kickoff: installable PWA foundation, offline shell, and safe updates
- #60 — Design speed-aware CW proficiency with discrete global WPM bands
- #51 — Checkpoint 4: audit and close Persistence & Analytics milestone
- #58 — Milestone 4 blocker: finish IndexedDB lifecycle hardening and browser acceptance checks
- #57 — Milestone 4 blocker: complete Progress dashboard contract and analytics semantics
- #50 — Milestone 4: publish data/metrics docs and 100k-history benchmark
- #49 — Milestone 4: finish versioned backup, replace-import, and reset

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
