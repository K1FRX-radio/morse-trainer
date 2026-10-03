# Status

## Current milestone

Phase 3 Learn refinement and isolated-input hardening are implemented. Learn is
RX-only, Practice never unlocks curriculum characters, and there is no separate
learner checkpoint. The latest completed continuous-copy stream supplies
advancement evidence, and only explicit learner acceptance unlocks one next
character.

## Done

- Vite + React 19 + strict TypeScript application with ESLint, Prettier,
  Vitest, Testing Library, production build, and CI.
- Pure Morse, timing, curriculum, scheduler, keying, scoring, settings, and
  seeded-RNG core modules.
- Shared Web Audio session with scheduled CW playback, anti-click cancellation,
  live sidetone, output-device support, and lifecycle-safe Learn audio control.
- Practice copy/sending screens and persisted audio/practice settings.
- Correctness hardening:
  - readiness respects persisted review flags;
  - remediation streaks count only clean isolated review outcomes;
  - held/repeated keys cannot answer later prompts, while a fresh same-key press
    after `keyup` can;
  - isolated, group, and word copy separate typing permission from grading
    permission;
  - isolated input remains mounted, enabled, and focused through playback,
    feedback, and Replay;
  - one isolated answer may be queued for the current prompt and matching
    playback generation, then graded only after audio completes;
  - prompt replacement, cancellation, session end, navigation, and unmount
    discard queued input;
  - stale playback/cancellation cannot suspend or clear newer audio state.
- Adaptive RX Learn flow:
  - isolated acquisition with named minimums, recent-performance criteria, and
    bounded extension;
  - balanced mixed contrast weighted toward newest, review, and weak characters;
  - assisted/replayed work excluded from mastery;
  - explicit persistent phase labels and blocking/nonblocking transitions.
- Short-group progression with eight two-character and eight three-character
  groups, focus-character coverage, aligned grading, and no direct unlock.
- Timed continuous copy:
  - deterministic active-only weighted stream generation by actual scheduled
    audio duration;
  - one preserved schedule for gapless playback;
  - live multiline input during audio, monotonic countdown, two-second finishing
    grace period, early-abandon discard, and aligned results;
  - compact deterministic alignment with insertion/deletion/substitution counts;
  - ten-minute generation/grading performance coverage;
  - continuous-copy observations cannot unlock or clear isolated remediation.
- Persisted 1/3/5/10-minute continuous-copy duration choices with compatible
  one-minute defaults and active-set recommendations.
- Eligible word copy after continuous copy when at least ten short words can be
  formed from the active set; eight deterministic nonrepeating words weighted
  toward newest/review/weak characters, with replay excluded from mastery.
- Explicit session metrics for isolated prompts, groups, words, continuous-copy
  duration, aligned character work, excluded items, review state, and
  advancement readiness.
- Learner-controlled advancement:
  - only the latest completed continuous-copy stream is assessed;
  - unresolved review, insufficient evidence or coverage, and threshold misses
    prevent an offer;
  - **Learn {nextCharacter}** unlocks exactly one character;
  - **Practice these characters again** starts another lesson without unlocking.
- Responsive desktop/mobile browser verification with no runtime console errors,
  no horizontal overflow, readable Settings controls, and persisted duration.

## Verification at `8d1a110`

- 278 tests across 21 files.
- Repository-wide lint and Prettier checks pass.
- TypeScript and Vite production build pass.
- Focused Learn coverage includes repeated `K K K`, `M M`, and `K M K`
  physical/mobile event paths, held-key rejection, composition, Replay,
  cancellation, navigation, and unmount.
- Integrated Chromium confirmed an enabled, stable isolated input without audio
  overlap or disabled mutations in observed prompts. The long synthetic loop
  remained harness-limited and is not treated as real-device verification.

## Known issues / notes

- Curriculum and introduced-character state still use localStorage pending the
  planned versioned persistence milestone.
- Automated Playwright E2E is not yet a repository dependency; browser checks
  currently use the integrated development browser.
- A real-phone soft-keyboard pass and full real-device audio smoke pass remain
  necessary because automated browser audio and synthetic events cannot verify
  keyboard persistence, perceived timing, tone quality, or device routing.

## Next steps

1. Milestone 4: versioned IndexedDB persistence and migration from current
   localStorage state.
2. Progress dashboard backed by persisted sessions, attempts, and milestones.
3. Repository-owned browser E2E coverage for the guided Learn flow.
4. Human smoke pass of a complete lesson on phone hardware and Firefox/Chromium,
   including 20 consecutive isolated prompts at 20/12 and 8/5.

## Decisions requiring confirmation

- Whether any legacy browser state needs migration beyond current settings
  compatibility.