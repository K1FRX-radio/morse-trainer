# Roadmap

This file is the authoritative implementation order for repository work.

GitHub issues remain the source of truth for task requirements. This file answers
which issue should be implemented next, what follows it, and which work is parked.

## Current focus: functionality, curriculum, and reliability

Prioritize training behavior, real-world CW readiness, and maintainability.
Product naming and visual identity are **not** prerequisites for this work.
Keep current provisional branding and UI in place rather than introducing new
visual identity decisions as part of functional PRs.

## Next

- Approval checkpoint: prioritize and explicitly authorize pending first-contact slices (#98-#101)

## Proposed queue (pending approval)

- #98 — Add learner station profile for self-relevant CW practice
- #99 — Implement structured QSO element drills with field-based grading
- #100 — Implement complete simulated CW QSO practice sessions
- #101 — Add layered realism modifiers for operating-prep copy
- #61 — Architecture review: modularize oversized files and reduce structural coupling
- #70 — External paddle compatibility spike: validate keyboard HID on desktop and Android
- #43 — Add external CW paddle support via USB HID/MIDI (depends on #70 compatibility evidence)

#87 produced a staged first-contact progression proposal and bounded
implementation slices (#95-#101) documented in
`docs/first-contact-cw-curriculum-proposal.md`. #95 now defines the operating-
prep contract in `docs/operating-prep-progression-contract.md`, #96 adds
staged on-air vocabulary selectors, and #97 adds staged callsign progression
selectors and generators in the existing domain stack. The remaining #98-#101
sequence is still proposed, not pre-approved for automatic execution.
Before starting any of #98-#101, explicitly approve prioritization/order and
confirm whether reprioritization is required against #61.

Preserve #92's timer-status polish plus #89's preparation countdown and #90's
explicit submission behavior: playback ending must not force grading; the
learner explicitly submits their finished transcription. #92 is presentation
polish only and must not change scoring, timing, or persistence.

#61 is a behavior-preserving review/refactor, not an excuse for broad rewrites.
Investigate actual reliability or performance problems (audio scheduling,
mobile input, offline/update lifecycle, and long-form copy) and create focused
issues when evidence supports changes. The existing whole-schedule audio model
is a scalability consideration, not a confirmed performance bug.

#70 must establish desktop/Android/PWA HID compatibility before #43 begins.
The paddle work no longer waits on visual redesign, but it still respects
that hardware compatibility dependency.

## Paused: branding and visual redesign

- #74 — Define product naming, branding, and production app assets
- #79 — UI/UX sprint: establish visual design system and redesign the app shell
- #80 — UI/UX sprint: redesign the Learn experience for focused Morse copy
- #81 — UI/UX sprint: redesign Practice and mode switching
- #82 — UI/UX sprint: redesign History and Progress for useful, low-clutter feedback
- #83 — UI/UX sprint: reorganize Settings and PWA/system surfaces around user intent
- #84 — UI/UX sprint: responsive, accessibility, interaction-state, and visual QA pass

Umbrella issue #77 tracks the visual/UX sprint and remains open. Its audit/IA
issue #78 is already complete. When the user resumes this track, follow the
dependency order #74 -> #79 -> #80/#81/#82/#83 -> #84, revisiting the
screen designs against whatever curriculum functionality has shipped.
Do not silently promote paused work into the active queue.

## Blocked / awaiting setup

- #75 — Automate the agent implementation/review loop with GitHub events
  (open implementation PR #76; activation requires API billing and the
  `OPENAI_API_KEY` GitHub Actions secret). This is useful development
  infrastructure but does not block functional feature work.

## Recently completed

- #97 — Add realistic callsign curriculum progression
- #96 — Add staged on-air vocabulary tracks for RX training
- #95 — Define operating-prep progression contract and stage gates
- #87 — Define the first-contact CW curriculum: from characters to a real QSO
- #92 — Clarify continuous-copy timer after transmission completes
- #89 — Add 3-2-1 countdown before continuous copy begins
- #90 — Keep continuous copy open for transcription after CW playback ends
- #78 — UI/UX sprint: audit current flows and define information architecture

## Maintenance contract

Roadmap-item implementation PRs must update this file in the same PR:

1. Move the completed `Next` issue to the top of `Recently completed`.
2. Promote the first issue in `Queue` to `Next`.
3. Preserve the order of the remaining queue.
4. Keep `Recently completed` concise; retain roughly the latest 8 items.
5. Do not reorder, skip, add, or remove queued work unless the user explicitly
   changes priority or a newly discovered blocker requires escalation.
6. Paused and blocked items must not be promoted without explicit
   reprioritization or the required setup/decision.
7. After proposal work like #87, pause for explicit approval of any proposed
   follow-up slices/order before treating them as committed queue work.

If `Next` is closed, blocked, already has an active implementation PR, or
otherwise cannot be started safely, do not silently choose another issue.
Report the stale/blocking condition so the roadmap can be corrected.
