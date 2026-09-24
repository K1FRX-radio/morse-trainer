# Checkpoint 2 parity table

Milestone 2: audio, input, and legacy feature parity. Compares the legacy
`morse-trainer.html` prototype (see `legacy-behavior.md`) with the new
implementation.

**Document status:** Historical Phase 2 acceptance record. Later Learn-mode
changes, including learner-controlled advancement and prompt-bound type-behind
input, are outside this parity table and are documented in the README.

## Feature parity

| Legacy behavior                                                     | New behavior                                                                                                        | Test coverage                                                                           | Intentional change                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Web Audio tone with ~5 ms attack/release ramps                      | `audio/cw-engine.ts` schedules gain against the AudioContext clock; anti-click envelope from `audio/cw-schedule.ts` | `audio/cw-schedule.test.ts` (envelope + timing); manual audio QA for perceptual quality | Envelope logic extracted to a pure, tested function                   |
| Copy playback on a single scheduled oscillator                      | Fresh oscillator/gain per playback, discarded on end/cancel                                                         | Manual (Web Audio not unit-run)                                                         | Short-lived voice for deterministic teardown on mobile suspend/resume |
| Single WPM, no Farnsworth                                           | `charWpm` + `effectiveWpm` via `core/timing.ts`                                                                     | `core/timing.test.ts`                                                                   | New capability, not a port                                            |
| Word gap stacked (~10 units)                                        | Single 7-unit word gap                                                                                              | `core/timing.test.ts` (`"A B"` guard)                                                   | Bug fixed                                                             |
| Straight-key decode (>=2 dits = dah, 3-dit letter gap, 7-dit space) | `core/keying.ts` pure decode with the same thresholds                                                               | `core/keying.test.ts`                                                                   | Same rule, DOM-free and tested                                        |
| Spacebar keying, ignores auto-repeat, stops tone on hidden tab      | `input/keyboard-key.ts` (auto-repeat ignored; clean release on blur/visibility)                                     | `input/key-input.test.ts` (idempotency); manual for DOM events                          | Adds explicit blur release                                            |
| Mouse/touch keying                                                  | `input/pointer-key.ts` with pointer capture; clean release on up/cancel/leave/lost-capture                          | Manual (pointer events)                                                                 | Pointer capture prevents stuck marks off-element                      |
| Copy content: letters / letters+numbers / CW words / callsigns      | `content/practice-content.ts` seedable generators                                                                   | `content/practice-content.test.ts`                                                      | Seedable for reproducible exercises                                   |
| Band noise: looped white noise, bandpass at tone, Q=1               | `audio/noise.ts` (same graph)                                                                                       | Manual (Web Audio)                                                                      | None                                                                  |
| Speed / tone / noise controls                                       | `core/settings.ts` model + Settings screen; adds volume                                                             | `core/settings.test.ts`                                                                 | Adds volume; persists to localStorage                                 |
| iOS audio start                                                     | `audio/audio-session.ts` one-time silent unlock on first gesture                                                    | Manual (device)                                                                         | Explicit unlock added                                                 |

## Required Phase 2 checks

Automated (schedule/logic level):

- No stuck mark from auto-repeat or lost focus — `input/key-input.test.ts`.
- Exact tone envelope and event timing — `audio/cw-schedule.test.ts`.
- Word/character gap totals — `core/timing.test.ts`.

Manual audio/device QA (not automatable; must be performed on hardware):

- Headphones and phone-speaker: click-free, recognizable CW, no clipped first
  element.
- No stuck tone after cancellation, rapid replay, route change, pointer cancel,
  tab backgrounding, or component unmount.
- Copy and Send usable at phone and desktop viewport sizes.
- Current Chrome/Android and at least one desktop browser.

## Remaining manual audio risks

- Perceptual click-freeness depends on the 5 ms ramp on real hardware; tune if
  clicks are audible.
- iOS/Safari clock start relies on the silent-unlock gesture; verify on a real
  device.
- Sidetone uses a fresh oscillator per keypress; verify rapid keying stays
  click-free and never strands a tone.
