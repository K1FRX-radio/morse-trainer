# Learner-controlled advancement change

> **Document status (2026-09-24): Completed.** The domain assessment landed in
> `28bcbce`, and the learner-controlled UI plus removal of the checkpoint flow
> landed in `d6737ad`. Stream coverage and hard-run follow-ups landed in
> `722b3eb` and `9c1cae7`. The README and live status documentation now describe
> the resulting behavior. The instructions below are retained as the decision
> record and acceptance contract.

Replace the separate checkpoint flow with learner-controlled advancement based on a completed continuous-copy session.

## Product decision

The long continuous-copy session becomes the advancement assessment. There should no longer be a separate checkpoint test.

The app must never unlock a character automatically. When the evidence is strong enough, it should suggest the next character and let the learner choose:

> **Looks like you’re ready for a new character!**
> You copied 94% overall and 89% of the newest character.

Actions:

- **Learn U** — unlock exactly one character and begin its introduction.
- **Practice these characters again** — retain the current active set and start another lesson.

This replaces all checkpoint UI and terminology.

## Advancement evidence

Create a pure domain function, such as:

```ts
evaluateAdvancementEvidence(...)
```

Evaluate only the most recently completed continuous-copy stream. Do not use accumulated historical accuracy to satisfy the current stream thresholds.

Historical curriculum state may still veto advancement through unresolved review status.

A learner is eligible only when all of these are true:

1. The stream was completed and was not abandoned.
2. Overall aligned accuracy is at least 90%.
3. Newest-character accuracy is at least 85%.
4. The stream contains at least eight observations of the newest character.
5. Every currently active character appears at least once.
6. There are no unresolved `needsReview` characters.
7. The stream contains enough total observations.

Preserve the checkpoint’s existing evidence-size behavior for condition 7:

```ts
minimum = max(
  24,
  round(activeCharacterCount * 6),
  activeCharacterCount - 1 + 8,
);
```

Clamp the normal scaled length to the existing maximum of 50, while still treating an impossible configuration as an error. Prefer extracting and renaming the current checkpoint-length logic rather than subtly changing its behavior.

Do not add a per-character accuracy floor for older characters. The intended rule remains:

- Overall ≥ 90%.
- Newest ≥ 85%.
- Newest has sufficient observations.
- Every active character is represented.
- Existing review state may veto advancement.

A weak older character may therefore be carried by the overall score unless it has already triggered `needsReview`. Add a test that preserves this decision.

## Suggested domain model

Replace checkpoint-specific types with advancement-specific types, for example:

```ts
type AdvancementReason =
  | "READY"
  | "ABANDONED"
  | "INSUFFICIENT_TOTAL_EVIDENCE"
  | "INCOMPLETE_ACTIVE_COVERAGE"
  | "INSUFFICIENT_NEWEST_COVERAGE"
  | "LOW_OVERALL_ACCURACY"
  | "LOW_NEWEST_ACCURACY"
  | "NEEDS_REVIEW"
  | "COMPLETE";

type AdvancementAssessment = {
  eligible: boolean;
  reason: AdvancementReason;
  overallAccuracy: number;
  newestAccuracy: number;
  newestObservations: number;
  totalObservations: number;
  coveredCharacters: string[];
  missingCharacters: string[];
  weakCharacter?: string;
  nextCharacter?: string;
};
```

The exact shape may differ, but the result must provide enough structured information for the UI and tests without reproducing the calculation in React.

Keep thresholds as named, tunable configuration values. Rename `CheckpointConfig` to something appropriate such as `AdvancementConfig`, preserving the current values:

- Overall accuracy: 0.90
- Newest accuracy: 0.85
- Minimum newest observations: 8
- Minimum evidence length: 24
- Maximum scaled evidence length: 50
- Observations per active character: 6

## Evidence source

Use `ContinuousCopyResult.perCharacterResults` to calculate:

- Total observations
- Total correct
- Overall accuracy
- Per-character observation counts
- Per-character correct counts
- Newest-character accuracy
- Active-set coverage

Do not infer these values from the displayed summary strings.

The stream’s spaces and token boundaries remain audio and presentation boundaries only. They must not alter grading or observation counts.

Both random-group and word characters may contribute to advancement evidence. The stream still contains predominantly random groups, and all characters are graded through the same alignment result.

## Separation of responsibilities

Maintain these distinctions:

- Ordinary isolated, group, and word exercises feed practice history and scheduling.
- Assisted and replayed exercises remain excluded from mastery.
- Continuous copy feeds practice history and produces advancement evidence.
- Continuous copy must not unlock a character by itself.
- Only explicit learner acceptance of a valid advancement offer may unlock.
- Continuous copy must not clear `needsReview`; remediation remains responsible for that.
- TX remains irrelevant to RX progression.
- At most one character may be unlocked from one assessment.

Rename comments and APIs that still claim “only a checkpoint advances the curriculum.”

## Learner-controlled unlock action

Add a single action such as:

```ts
acceptAdvancement();
```

It must:

1. Revalidate that the current assessment is still eligible.
2. Verify that the active set and proposed next character still match the assessment.
3. Prevent duplicate acceptance or double-click unlocking.
4. Unlock exactly one character.
5. Persist curriculum state.
6. Begin a new Learn session containing the new character’s introduction.

Do not call a generic unconditional unlock directly from the UI.

After acceptance, the learner should see the normal new-character introduction screen for the newly unlocked character. Preserve the current explicit introduction behavior: one initial sound, unlimited Replay, and Start practice required to proceed.

The secondary action must begin another lesson without changing the unlocked character set.

## Summary UX

On an eligible completed session, show:

> **Looks like you’re ready for a new character!**
> You copied {overall}% overall and {newest}% of {newestCharacter}.

Primary button:

> **Learn {nextCharacter}**

Secondary button:

> **Practice these characters again**

Do not use “pass,” “fail,” “test,” or “checkpoint.”

For an ineligible session, give one concise, constructive message based on the assessment reason:

- Low overall accuracy:
  “You copied 87% overall. Keep practicing and aim for 90%.”
- Low newest accuracy:
  “Keep practicing M. You copied it correctly 78% of the time.”
- Insufficient newest observations:
  “Let’s hear M a few more times before adding another character.”
- Incomplete active-set coverage:
  “This session didn’t include enough of the full character set yet.”
- Needs review:
  “A little more practice with K will help before adding another character.”
- Insufficient total evidence:
  “Keep copying a little longer so the app has enough information.”
- Abandoned stream: retain the current neutral message that it was not counted.
- Complete curriculum: retain the message that all characters are unlocked.

Avoid showing multiple failure reasons simultaneously. The pure evaluator should define a deterministic reason priority.

Recommended priority:

1. `COMPLETE`
2. `ABANDONED`
3. `NEEDS_REVIEW`
4. `INSUFFICIENT_TOTAL_EVIDENCE`
5. `INCOMPLETE_ACTIVE_COVERAGE`
6. `INSUFFICIENT_NEWEST_COVERAGE`
7. `LOW_OVERALL_ACCURACY`
8. `LOW_NEWEST_ACCURACY`
9. `READY`

If you believe overall/newest ordering should differ for clearer feedback, report that before changing it.

## Remove the checkpoint flow

Once advancement assessment and acceptance are working, remove:

- `CheckpointSession`
- `CheckpointResult` and checkpoint-specific application types
- `buildCheckpoint()` and `gradeCheckpoint()`
- Checkpoint React phases
- Checkpoint refs and hook state
- `startCheckpoint()` and `acceptCheckpoint()`
- Checkpoint input UI
- “Start checkpoint” and “Try a checkpoint” buttons
- “Checkpoint passed” and “Not yet” screens
- Checkpoint-specific physical-key handling branches
- Dead checkpoint tests and documentation
- Comments that describe checkpoint-only progression

Do not remove alignment, prompt-token, keyboard, review, or curriculum utilities merely because checkpoint code used them.

If `canUnlockNext()` or `unlockNext()` becomes unused or represents the obsolete rolling-history unlock policy, remove or replace it rather than leaving a second progression path.

## Implementation sequence

1. Add advancement configuration and the pure evaluator.
2. Add exhaustive domain tests for the evaluator.
3. Integrate the assessment into `LearnSession` or the session summary.
4. Add the explicit one-shot acceptance action.
5. Replace checkpoint messaging and buttons in `LearnScreen`.
6. Add UI and integration regression tests.
7. Remove the old checkpoint flow and dead APIs.
8. Update README and `phase3.1.md`.
9. Run all verification gates.
10. Commit and push the completed change.

## Required domain tests

Cover at least:

- Perfect completed stream is eligible.
- Exactly 90% overall passes.
- Just below 90% overall does not pass.
- Exactly 85% newest passes.
- Just below 85% newest does not pass.
- Exactly eight newest observations passes.
- Seven newest observations does not pass.
- Every active character covered passes.
- One missing active character blocks the offer.
- Evidence exactly at the calculated minimum passes.
- Evidence one observation below the minimum does not pass.
- Abandoned stream never qualifies.
- Any unresolved `needsReview` blocks advancement.
- Completed curriculum returns `COMPLETE`.
- Strong overall score may carry an older character without a separate per-character floor.
- Spaces and token boundaries do not change evidence.
- Words and random groups both contribute correctly.
- Repeated and ambiguous aligned characters retain deterministic attribution.
- Evaluation is pure and does not mutate curriculum state.

## Required integration and UI tests

Cover at least:

- A qualifying completed stream displays the readiness suggestion.
- The suggestion includes actual overall and newest-character metrics.
- The primary button names the actual next character.
- Clicking **Learn U** unlocks only U.
- Double-clicking or repeated invocation cannot unlock a second character.
- Accepting immediately begins U’s introduction.
- The introduction still waits indefinitely for Start practice.
- Clicking **Practice these characters again** starts a lesson without unlocking.
- A nonqualifying stream never displays a Learn-next-character button.
- An abandoned stream never displays an advancement offer.
- A stream with unresolved review never displays an advancement offer.
- Ordinary practice cannot unlock.
- Completing continuous copy cannot unlock without explicit acceptance.
- Assisted or replayed work cannot create advancement evidence.
- Continuous copy cannot clear remediation state.
- TX cannot affect advancement.
- No checkpoint buttons, headings, input fields, or routes remain.
- Existing consecutive-key, type-behind, audio lifecycle, introduction, mobile, and alignment tests continue to pass.

## Manual browser verification

Test at both 20/12 and 8/5:

1. Complete a qualifying KM lesson and continuous-copy stream.
2. Confirm the suggestion appears only after the stream is finished.
3. Confirm the displayed overall and newest metrics match the stream results.
4. Choose Practice and confirm the active set remains KM.
5. Complete another qualifying stream.
6. Choose Learn U.
7. Confirm only U is unlocked.
8. Confirm the U introduction uses the current learner-controlled introduction screen.
9. Confirm refresh/navigation cannot replay the same offer and unlock another character.
10. Confirm there are no visible references to checkpoints.
11. Confirm no console errors or audio overlap.

## Verification commands

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

Also confirm GitHub Actions passes after pushing.

Use focused commits if practical:

1. `Add continuous-copy advancement assessment`
2. `Replace checkpoint flow with learner-controlled advancement`

Report:

- Commit SHAs
- Files removed
- Advancement configuration values
- Automated test totals
- Browser scenarios completed
- Any deliberate deviations
- Any remaining physical-device or audible checks
