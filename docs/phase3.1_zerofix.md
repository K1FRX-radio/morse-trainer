Please make one focused follow-up from current `main` at `722b3eb`.

> **Document status (2026-09-24): Completed.** Commit `9c1cae7` preserves the
> hard identical-run limit, relaxes adjacent-token uniqueness only when needed,
> and strengthens deterministic evidence coverage. The instructions below are
> retained as the regression contract.

The advancement quota fix is directionally correct, but the refactored character selector has a constraint-collision bug and one test can silently skip the behavior it claims to verify.

## 1. Fix the all-zero selection case

In `buildRandomGroup()`, the run-limit constraint and adjacent-token uniqueness constraint can reject every active character.

Concrete K/M example:

* Previous token: `MMK`
* Current group prefix: `MM`
* Current group length: 3
* `M` is rejected because it would produce `MMM`, violating `maxIdenticalRun = 2`.
* `K` is rejected because it would reproduce the previous token `MMK`.
* All selection weights become zero.
* `weightedIndex()` then chooses a random index, ignoring both constraints.

This can produce either:

* `MMM`, violating the configured run limit, or
* another `MMK`, violating the preferred adjacent-token uniqueness.

Treat the constraints with explicit priority:

1. `maxIdenticalRun` is a hard constraint whenever more than one active character exists.
2. Outstanding advancement coverage is a strong scheduling priority.
3. Avoiding an identical adjacent token is a soft constraint.
4. If avoiding an identical token conflicts with the hard run limit, permit the repeated token. Never permit the excessive character run.

Use a selection sequence equivalent to:

1. Outstanding-quota candidates satisfying the run limit and token-uniqueness preference.
2. Outstanding-quota candidates satisfying the run limit, relaxing token uniqueness.
3. Ordinary weighted candidates satisfying the run limit and token-uniqueness preference.
4. Ordinary weighted candidates satisfying the run limit, relaxing token uniqueness.
5. If no candidate exists after step 4, throw an invariant error rather than passing an all-zero vector to `weightedIndex()`.

Do not silently allow `weightedIndex()` to select a forbidden candidate.

Preserve:

* Deterministic seeded generation.
* Full active-set coverage.
* At least eight newest-character observations when the stream contains sufficient evidence.
* Existing newest/review/weak weighting.
* Variable group lengths.
* Word eligibility and weighting.
* No word tokens before advancement coverage is satisfied.
* Maximum two consecutive word tokens.
* No forced extension of intentionally short streams.

## 2. Add direct regression coverage

Add a regression test for the exact collision:

* Previous token `MMK`
* Next group reaches prefix `MM`
* The final character must be `K`, even though that repeats `MMK`.
* It must never select `M` and produce `MMM`.

If testing this cleanly requires extracting a small pure candidate-selection helper, do so within the training layer. Do not export UI-facing or broadly public API solely for the test.

Add property-style seeded tests for two-character K/M streams:

* Seeds 1–1000.
* 20/12 and 8/5 timing.
* Recommended one-minute duration.
* Also sample the available 3-, 5-, and 10-minute durations.
* Assert every generated character belongs to the active set.
* Assert no token contains three identical consecutive characters.
* Assert generation always selects a valid candidate.
* Assert determinism for identical seed/configuration.
* Assert exact adjacent tokens are still avoided whenever a valid alternative satisfies the hard run constraint.
* Permit an adjacent repeated token only in the explicit constraint-collision case.

Keep the existing broader active-set tests.

## 3. Strengthen the recommended-duration evidence test

The current test silently skips coverage verification when this condition is true:

```ts
generated.gradingTarget.length <
minimumAdvancementObservations(activeCount)
```

For recommended durations, do not `continue`.

Instead assert:

```ts
expect(generated.gradingTarget.length).toBeGreaterThanOrEqual(
  minimumAdvancementObservations(activeCount),
);
```

Then assert:

* Every active character appears at least once.
* The newest character appears at least eight times.

Run this across:

* Active-set sizes 2–40.
* 20/12 and 8/5 timing.
* Recommended 1-, 3-, or 5-minute duration for that active-set size.
* Multiple deterministic seeds.

If any recommended duration cannot produce the required evidence at a supported timing, report the failing active-set size and timing before changing product configuration. Do not weaken the assertion or advancement thresholds.

Retain the separate test proving that an intentionally short stream is not extended to force eligibility.

## 4. Do not change advancement behavior

Do not modify:

* 90% overall threshold.
* 85% newest-character threshold.
* Eight newest observations.
* 24–50 total evidence scaling.
* Six observations per active character for evidence sizing.
* No older-character accuracy floor.
* Review-state veto.
* Learner-controlled **Learn {nextCharacter}** action.
* **Practice these characters again** action.
* One-character maximum unlock.
* Continuous copy’s inability to unlock automatically or clear remediation.
* The new-character introduction flow.
* Current grading/alignment behavior.
* Current word ratio or word eligibility.

## 5. Complete the end-to-end browser validation

After automated tests pass, perform the previously outstanding Chromium progression checks.

At 20/12:

1. Complete a real one-minute KM continuous-copy session.
2. Confirm the advancement suggestion appears after a qualifying copy.
3. Confirm the displayed overall and newest-character metrics match the result.
4. Choose **Practice these characters again**.
5. Confirm the active set remains K/M and U is not unlocked.
6. Complete another qualifying stream.
7. Choose **Learn U**.
8. Confirm exactly one character is unlocked.
9. Confirm U opens in the learner-controlled introduction screen.
10. Confirm it remains there until **Start practice** is pressed.

At 8/5:

1. Complete the same one-minute KM flow.
2. Confirm the generated stream has at least 24 target characters and at least eight M observations.
3. Confirm the readiness offer and explicit unlock behave identically.
4. Confirm no audio overlap or console errors.

Also verify:

* Repeated clicking of **Learn U** cannot unlock R.
* Navigation or refresh cannot reuse an old offer to unlock another character.
* No checkpoint terminology or controls are present.
* Mobile layout still has no horizontal overflow.

Synthetic browser events may verify state and UI behavior, but report audible timing and genuine physical-key behavior separately if they still require human confirmation.

## 6. Verification and delivery

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

Push one focused commit, preferably:

```text
Preserve hard run limits in copy streams
```

Report:

* Commit SHA.
* Exact selector-priority implementation.
* Seeds, active-set sizes, timings, and durations covered by tests.
* Total test count.
* Typecheck, lint, formatting, build, and CI results.
* Browser scenarios completed.
* Any remaining human audible/device checks.
* Any deliberate deviation from these instructions.
