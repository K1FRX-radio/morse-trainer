# Legacy prototype behavior inventory

Source: `k1frx-radio.github.io/morse-trainer.html` (single Jekyll page).
Captured as a behavioral reference for the migration, not a desired design.

**Document status:** Historical prototype inventory. Current Learn progression,
advancement, and input guarantees are documented in the repository README; this
file intentionally preserves the legacy behavior that the migration replaced.

## Modes

- **Key practice** — user sends with a straight key; the app decodes.
- **Copy practice** — the app plays a group; the user types what they hear.

## Morse mapping

Standard international set: A–Z, 0–9, and punctuation `. , ? / ! : ' - ( ) + = "`.

## Settings

| Control    | Range                                                        | Default | Notes                          |
| ---------- | ------------------------------------------------------------ | ------- | ------------------------------ |
| Speed      | 5–30 WPM                                                     | 15      | Single speed; no Farnsworth    |
| Tone       | 300–1000 Hz                                                  | 600     |                                |
| Band noise | 0–100%                                                       | 0       | White noise bandpassed at tone |
| Content    | letters / letters+numbers / common CW words / callsign-style | letters | Copy practice only             |

## Timing

- `ditMs = 1200 / WPM`.
- Input decode: press >= 2 dits is a dah; letter decoded after a 3-dit gap; a
  space is added after a 7-dit gap.

## Confirmed bug (to fix, not reproduce)

`playMorse` appends a full 3-unit inter-character gap after every character and
then, on encountering a space, adds a further 7-unit word gap — so multiword
phrases receive ~10 units of silence between words instead of 7. The new
`core/timing.ts` models boundaries explicitly and emits a single 7-unit word
gap. Regression covered by the `"A B"` golden vector test.

## Audio

- Web Audio; per-tone oscillator with ~5 ms attack/release ramps to avoid clicks.
- Copy playback builds a schedule on a single oscillator with scheduled gain
  changes.
- Band noise: 2-second looped white-noise buffer through a bandpass filter at the
  tone frequency (Q = 1), gain scaled by the noise percentage.

## Input

- Mouse, touch, and spacebar keying. Spacebar guards against OS auto-repeat
  (`e.repeat`). `visibilitychange` to hidden stops any tone.

## Corpora

- `CW_WORDS`: 30 common CW abbreviations/words (CQ, DE, 73, RST, QTH, ...).
- Callsign generator: 1–2 prefix letters + 1 digit + 1–3 suffix letters.

## Carried forward vs. new

- Carried forward: Morse map, tone generation, straight-key decode, copy
  practice, WPM/tone/noise controls, corpora concepts.
- New (not a port): Farnsworth effective-speed timing, Koch progression,
  adaptive scheduler, persistence, analytics.
