# Phase 3.1 Plan: Type-Behind Copy and Grouped Continuous Streams

> **Document status (2026-09-24): Completed and amended.** The grouped-stream
> and group/word type-behind work predates the isolated-input hardening in
> `8d1a110`. The isolated-input clauses below now reflect the current product
> contract: typing is permitted during playback and Replay, while grading waits
> for the matching playback generation.

## Objective

Refine the RX experience so learners can copy naturally while Morse is being transmitted and continuous-copy sessions sound like structured code groups rather than one uninterrupted character string.

This phase addresses two observed problems:

1. Input is disabled while 2-character, 3-character, and word prompts are playing.
2. Continuous copy is transmitted as one long character sequence without audible group boundaries.

Phase 3.1 must preserve all Phase 3 progression, remediation, advancement, audio-lifecycle, and RX-only guarantees.

## Base Revision

Begin from commit:

`203f46df58217b8ce678283dc97c1c12c204eee1`

Review the current implementations in:

- `src/ui/hooks/useLearnSession.ts`
- `src/ui/screens/LearnScreen.tsx`
- `src/ui/hooks/useContinuousCopy.ts`
- `src/training/continuous-copy.ts`
- `src/training/learn-session.ts`
- `src/training/lesson-plan.ts`
- `src/core/scoring.ts`
- `src/core/timing.ts`
- `src/content/words.ts`

## Product Behavior

### Short groups and words

For `copy-group` and `copy-word` exercises:

- Focus and enable the input field when playback begins.
- Let the learner type while listening.
- Preserve all input entered during playback.
- Do not grade, show feedback, replay corrections, or advance until the original prompt finishes.
- Never interrupt the original prompt when the learner finishes typing early.

Group submission behavior:

- A group becomes ready for submission when the learner enters the expected number of characters.
- If this happens during playback, queue submission intent for the current prompt.
- Do not freeze the answer when intent is queued. Submit the current field value when playback finishes.
- If an automatically ready group is shortened below the expected length before playback finishes, cancel that ready state.
- Submit immediately after playback finishes.
- Enter explicitly requests submission, including for a shorter answer, but grading still waits until playback or replay finishes.

Word submission behavior:

- Continue hiding the expected word length.
- Enter requests submission.
- If Enter is pressed during playback, queue prompt-bound submission intent and use the current field value when playback finishes.
- Submit immediately after playback finishes.

Single-character behavior, as amended by the isolated-input hardening:

- Keep the isolated input mounted, enabled, and focused during playback and
  feedback.
- Accept at most one prompt-bound answer during playback and queue it until the
  matching audio promise resolves.
- Clear the visible value synchronously without disabling or remounting the
  input.
- Exactly one answer may be accepted per prompt.
- Reject `event.repeat` and genuinely held physical keys until a real `keyup`,
  blur, cancellation, or lifecycle cleanup.
- Prompt tokens, playback generations, and the one-shot claim gate prevent
  stale or duplicate grading.

### Replay behavior

For group and word cards:

- Replay marks the card assisted as it does today.
- Permit type-behind input during replay.
- Preserve text already entered before Replay was selected.
- If submission becomes ready during replay, defer grading until replay finishes.
- Never permit original playback, replay, corrective playback, or the next prompt to overlap.

For isolated-character cards, keep the input enabled during Replay. Queue at
most one answer against the current prompt token and Replay generation, and
grade it only after that Replay completes. An earlier or replaced playback must
not flush it.

### Continuous-copy stream

Replace the flat character stream with a sequence of tokens:

```ts
type ContinuousCopyToken = {
  kind: "random-group" | "word";
  text: string;
};
```

A continuous-copy plan should distinguish:

- `tokens`: semantic random-group and word units.
- `audioText`: token text joined by spaces for Morse scheduling.
- `gradingTarget`: all token characters joined without separators.
- `schedule`: the preserved schedule built from `audioText`.
- Requested and scheduled duration.

Do not use one string containing spaces as both the audio target and the per-character grading source. Whitespace normalization would make character-result indexes diverge.

### Random groups

When the active set is small:

- With 2–4 active characters, generate groups between 2 and 4 characters.
- With 5 or more active characters, generate groups between 2 and 5 characters.
- Make group lengths genuinely variable.
- Avoid excessive repetition of the same group length.
- Avoid identical adjacent tokens when alternatives exist.
- Preserve the existing weighting for newest, weak, and review characters.
- Continue limiting excessive identical-character runs inside groups.
- Use only unlocked characters.

Each token boundary must produce a proper Morse word gap through the existing timing engine. Characters inside a group retain normal inter-character spacing.

For KM, an example structure would be:

```text
KMK MM KKM MKKM MK KMKM
```

The app must transmit the spaces as audible group boundaries, but it must not reveal the target text visually.

### Mixing eligible words

Once a useful eligible word pool exists, intermix real words with random groups in the timed stream.

Add named, tunable configuration values such as:

```ts
minimumEligibleWordCount: 10;
continuousWordRatio: 0.35;
maxConsecutiveWordTokens: 2;
```

Rules:

- A word is eligible only if every character is unlocked.
- Filter by the configured word-length range.
- Compute focused-word eligibility once as a shared pure result using the existing word-length filter and minimum eligible pool of 10.
- Use that same eligibility result for lesson ordering, focused word selection, and continuous-copy word mixing.
- Do not immediately repeat a word when alternatives exist.
- Do not emit more than the configured maximum number of consecutive word tokens.
- Random groups must remain present after words become eligible.
- Approximately 35% of tokens should be words over a sufficiently long deterministic sample.
- If the focused-word phase is not eligible, generate random groups only.
- Word selection should continue favoring words containing the newest, weak, or review characters.
- All selection remains deterministic for a fixed seed.

An example later-curriculum stream might be:

```text
KRM ARE MUR KMU REST MMKR RST KUM
```

The learner should not be told which upcoming tokens are words. They should copy the rhythm they hear.

### Lesson ordering

Use this sequence:

When there are not enough eligible words:

1. Isolated acquisition and contrast
2. Two-character groups
3. Three-character groups
4. Grouped continuous copy
5. Summary with continuous-copy advancement assessment

When the eligible word pool meets the word-copy threshold:

1. Isolated acquisition and contrast
2. Two-character groups
3. Three-character groups
4. Explicit word-copy transition
5. Focused word-copy cards
6. Continuous-copy transition
7. Continuous copy mixing words and random groups
8. Summary with continuous-copy advancement assessment

This prevents the mixed stream from introducing word-copy behavior before the learner has seen the word-copy transition.

## Milestones

### Milestone 1: Type-behind prompt lifecycle

Introduce an explicit prompt lifecycle capable of representing:

- Prompt audio playing
- Input available
- Submission requested
- Prompt audio complete
- Answer claimed
- Feedback/correction
- Advancement

Requirements:

- Do not overload the existing `inputReady` flag with both “may type” and “may submit.”
- Track typing permission separately from grading permission.
- Queue at most one submission intent and tie it to the current flow/prompt token.
- Resolve queued intent with the current field value after prompt or replay audio completes.
- Automatic group readiness is reversible if the current value drops below the expected length before audio completes.
- An explicit Enter request remains queued even if the field is later edited.
- Invalidate queued work on End session, navigation, unmount, transition, or a new prompt.
- Ensure stale playback completion cannot grade a later prompt.

Deliver focused tests before moving to continuous-stream generation.

### Milestone 2: Tokenized continuous-copy domain

Refactor `ContinuousCopyPlan` around semantic tokens.

Requirements:

- Deterministic token generation.
- Correct audio text with token separators.
- Normalized grading target without separators.
- Proper Morse word gaps.
- No partial final token.
- Scheduled duration meets or exceeds the requested duration.
- Overshoot is limited to the duration of one complete token plus its boundary gap.
- Active-set coverage remains present when duration permits.
- Ten-minute generation and grading remain comfortably within the current performance budget.

### Milestone 3: Eligible-word mixing and lesson ordering

Add mixed word/group generation and move focused word-copy before continuous copy when it is eligible.

Requirements:

- One shared focused-word eligibility result using the existing minimum eligible pool of 10.
- Configurable word ratio.
- Configurable maximum consecutive words.
- No locked characters.
- No immediate duplicate tokens when avoidable.
- Existing separate word cards remain weighted and sampled without replacement.
- Transitions and notifications remain attempt-neutral.

### Milestone 4: Metrics and hardening

Extend metrics so the completion report can distinguish:

- Random groups transmitted
- Word tokens transmitted
- Total stream tokens
- Target characters
- Typed characters
- Aligned correct characters
- Insertions, deletions, and substitutions
- Stream duration

Do not count separators as transmitted characters, attempts, curriculum observations, or errors.

Add the direct tests previously missing from the Phase 3 checklist:

- Word-transition attempt neutrality
- Manual-pacing coherence
- Supported punctuation input regression
- Slow-setting audio non-overlap
- Continuous-copy token separator grading
- Replay type-behind behavior
- Stale queued-submission invalidation

## Automated Acceptance Tests

### Type-behind tests

Prove that:

- The first group character can be entered before playback resolves.
- Text entered during playback remains visible.
- Enter during playback does not interrupt audio.
- Reaching expected group length during playback does not grade early.
- Queued submission fires exactly once after playback completes.
- A queued incorrect answer waits before corrective replay.
- Corrective replay completes before the next card begins.
- Replay preserves partially typed group/word input.
- Ending the session cancels a queued submission.
- A stale playback promise cannot submit against a newer prompt.
- Mobile-style change events and IME composition still work.
- Isolated-character fields remain mounted, enabled, and focused during
  playback, and one early answer is graded only after matching playback ends.

### Stream-generation tests

Prove that:

- KM streams contain only K and M.
- Early streams contain multiple group lengths.
- Token boundaries produce word-gap schedule segments.
- Group interiors use inter-character gaps.
- The last token is complete.
- The active set receives coverage when duration permits.
- The same seed produces the same tokens and schedule.
- Different seeds produce meaningfully different streams.
- Maximum identical-character-run rules remain enforced.
- Requested 1-, 3-, 5-, and 10-minute durations are met.
- Both 20/12 and 8/5 timing work.

### Word-mixing tests

Prove that:

- No words appear below the configured eligible-pool threshold.
- Words appear above the threshold.
- Every word contains only unlocked characters.
- Both word and random-group tokens remain present.
- The configured word ratio is statistically respected over multiple seeded plans.
- No excessive consecutive-word run occurs.
- Immediate word repetition is avoided when alternatives exist.
- Newest, weak, and review weighting has a measurable deterministic effect.

### Grading tests

Prove that these answers are equivalent successful copies:

```text
KMKMMKKM
KMK MM KKM
```

Separately prove that these are deletion cases against `KMKMMKKM`, with the appropriate deterministic deletion counts and aligned-character results:

```text
KMK MM
KKM
```

Also prove that:

- Token separators are never represented as character results.
- Insertions and deletions near token boundaries align deterministically.
- Repeated characters across group boundaries retain the documented tie-break behavior.
- Typed whitespace does not affect target-character accuracy.
- Abandoned streams remain excluded from practice observations.
- Continuous copy still cannot unlock or clear isolated remediation.

### Regression gates

The following must remain true:

- Learn contains no TX exercises.
- Practice cannot unlock characters.
- Continuous copy cannot unlock a character without explicit learner acceptance.
- A valid offer uses at least 90% overall, 85% newest, and eight newest-character observations.
- One accepted offer unlocks exactly one character.
- Assisted and replayed work remains excluded from advancement eligibility.
- Audio cancellation settles before suspension.
- Stale suspension cannot interrupt new playback.
- Leaving Learn releases the audio session.

## Manual Verification

Complete and report the following:

### Desktop

- Full KM lesson at 20/12 with automatic pacing.
- Full KM lesson at 20/12 with manual pacing.
- Full KM lesson at 8/5.
- Type every short group while it is playing.
- Submit one group early with Enter.
- Type through a replay.
- Complete a one-minute grouped continuous-copy session by wall clock.
- Confirm a qualifying stream offers the next character with actual metrics.
- Choose Practice and confirm the active set does not change.
- Choose Learn and confirm only the offered character unlocks.
- Leave and immediately re-enter Learn; confirm no stale suspension or audio overlap.

### Mobile or emulated mobile

- Complete short-group type-behind using the soft keyboard.
- Confirm focus is retained without viewport jumping.
- Confirm no horizontal overflow.
- Confirm the continuous-copy textarea remains usable for one minute.
- Confirm spaces can be entered naturally.
- Confirm navigation remains accessible.

### Browser/device

Where available:

- Chromium smoke pass
- Firefox smoke pass
- Human listening check for group gaps, word gaps, clicks, overlaps, and slow-timing behavior
- Real-device confirmation that leaving Learn releases the audio device

Automated mocks must not be reported as proof of physical Firefox audio-device release.

## Required Verification Commands

Run and report:

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

Also report:

- Test count and file count
- Continuous-copy generation and grading benchmark
- One-minute stream timing at 20/12 and 8/5
- Token count and group-length distribution
- Word/random-group ratio for a representative eligible active set
- GitHub Actions result or a precise explanation if no check is attached to the commit

## Suggested Commit Sequence

1. `Enable type-behind group and word copy`
2. `Add tokenized grouped continuous-copy plans`
3. `Mix eligible words into continuous copy`
4. `Reorder word and continuous-copy lesson phases`
5. `Add Phase 3.1 metrics and regression coverage`
6. `Complete Phase 3.1 formatting and documentation`

Keep commits focused and independently reviewable. Do not combine formatting-only changes with behavioral changes.

## Completion Report

The completion report must include:

- Commit SHAs and summaries
- Any deviations from this plan
- Exact configuration defaults
- Automated verification results
- Manual verification completed
- Manual verification still pending
- Representative generated token streams for KM and for a word-eligible active set
- Measured word/random-group ratio
- Confirmation that separators do not affect grading or mastery
- Confirmation that short groups accept input during playback
- Confirmation that early completion does not interrupt audio
- Confirmation that checkpoint input behavior did not change
- Confirmation that no TX exercises were introduced

## Definition of Done

Phase 3.1 is complete when:

- Learners can type short groups and words as they hear them.
- Early typing never interrupts or overlaps audio.
- Continuous copy has audible boundaries between variable-length groups.
- Eligible words are naturally intermingled with random groups.
- Typed spaces are optional and never penalized.
- Checkpoint behavior and progression rules remain unchanged.
- All automated checks pass.
- The KM checkpoint and one-minute real-time stream have been manually exercised.
