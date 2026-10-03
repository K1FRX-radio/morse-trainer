# Isolated-character input hardening

> **Document status (2026-09-24): Implemented in `8d1a110`.** The confirmed
> failure coupled typing permission to grading readiness: an intentional early
> keypress reached `acceptIsolated()` while the prompt was still locked and was
> discarded. Prompt replacement also cleared held-key membership instead of
> following the browser's real key lifecycle. The fix queues one isolated answer
> by prompt token and playback generation, keeps the stable input enabled and
> focused, and retains held-key state until `keyup`, blur, cancellation, or
> cleanup. All 278 repository tests, typecheck, lint, formatting, and production
> build pass. Synthetic Chromium observed a stable enabled input with no disabled
> mutations or audio overlap; real-phone soft-keyboard persistence and audible
> timing remain human verification items.

Debug and fix two related isolated-character input problems in the Morse Trainer Learn flow.

Repository: `K1FRX-radio/morse-trainer`
Baseline: current `main`, beginning from commit `9c1cae7` or later.

## Reported behavior

### Desktop physical keyboard

During isolated-character practice, consecutive identical prompts are unreliable.

Example:

1. The app sends `K`.
2. The learner presses `K`; it is accepted.
3. The next prompt is also `K`.
4. The learner presses `K` once, but the app does not accept it.
5. Pressing `K` a second time works.

Alternating characters such as `K`, `M`, `K` are substantially less likely to exhibit the problem.

### Mobile soft keyboard

During isolated-character practice only:

1. The soft keyboard is visible when the learner can answer.
2. The learner types one character.
3. The keyboard disappears during feedback and the next prompt’s playback.
4. The keyboard reappears when the next prompt becomes ready.

Groups, words, and continuous copy do not exhibit this behavior.

## Important suspected mechanism

Do not assume this diagnosis is complete; reproduce and instrument the behavior before changing semantics.

Relevant current behavior appears to include:

* `presentPrompt()` keeps isolated prompts locked until `await play(target)` resolves.
* `physicalKeyDown()` calls `acceptIsolated()`.
* `claimPrompt()` rejects input while the prompt is locked.
* `LearnScreen` uses:

```tsx
disabled={!answerReady || !!feedback}
```

* Mobile browsers dismiss their soft keyboard when a focused input becomes disabled.
* A fast response near the audible end of a character may arrive before the audio promise resolves and therefore be discarded.
* This may be more noticeable for repeated characters because the learner recognizes and responds to them faster.
* The existing consecutive-key test does not accurately reproduce a normal `keydown → keyup → next prompt → keydown → keyup` sequence.
* The existing mobile test covers only one change event and does not cross a same-character prompt boundary.

## First: reproduce and identify the exact cause

Add temporary instrumentation around:

* Prompt token creation and invalidation.
* Prompt presentation.
* Audio start and promise completion.
* `keydown` and `keyup`.
* `event.repeat`.
* Held-key membership.
* `lockedRef`.
* `acceptedTokenRef`.
* `acceptIsolated()`.
* `claimPrompt()`.
* Input focus, blur, enable, and disable transitions.

Use the instrumentation to determine whether the first repeated-character press is rejected because of:

* Playback still being considered active.
* `event.repeat`.
* Stale held-key membership.
* A missing `keyup`.
* A stale accepted prompt token.
* Focus or disabled-state transitions.
* Duplicate handling between the global physical-key path and the input event path.
* Another lifecycle race.

Remove temporary logging before committing.

Report the confirmed event sequence and root cause. Do not merely state that this was “debouncing.”

## Required interaction model

Change isolated-character practice to separate typing permission from grading permission, similar to the existing type-behind design for groups and words.

### During isolated-character playback

* Keep the answer input mounted, enabled, and focused.
* Allow one intentional character to be entered while the prompt is playing.
* Bind that answer to the current prompt token.
* If playback is still active, queue the submission instead of grading it immediately.
* Grade only after the prompt’s playback promise resolves.
* Use the current prompt token to prevent stale answers from reaching another prompt.

### After an answer is claimed

* Accept exactly one answer for the prompt.
* Clear the visible input synchronously.
* Ignore further input during feedback.
* Do not disable or blur the input merely to enforce the one-shot gate.
* Keep the mobile keyboard open across the acquisition streak.
* The next prompt must receive a clean input state.

### Physical-key behavior

* A normal fresh keypress must be accepted once per prompt, including consecutive identical prompts.
* Continue rejecting `event.repeat`.
* A genuinely held key must not answer multiple prompts.
* A fresh same-key press after a real `keyup` must answer the next prompt.
* Reset or bind held-key state correctly when the prompt token changes.
* Do not weaken the authoritative prompt-token one-shot gate.

### Cancellation and stale intent

Discard any queued isolated-character answer when:

* The prompt changes.
* The flow token is invalidated.
* The session ends.
* The component unmounts.
* Navigation leaves Learn.
* Playback is cancelled.
* A replay or other lifecycle operation replaces the relevant playback.

If Replay is permitted for the current isolated prompt, ensure any answer typed during the replacement playback is bound to the correct prompt and cannot be flushed by an earlier playback completion.

## Scope constraints

Preserve these behaviors:

* Learn remains RX-only.
* Continuous copy remains the only source of advancement evidence.
* Practice never unlocks a character automatically.
* Assisted/replayed attempts retain their existing scheduling and advancement treatment.
* Groups and words retain type-behind and deferred-submission behavior.
* Continuous-copy input and grading remain unchanged.
* Audio sequencing and cancellation remain completion-based.
* No arbitrary timing delay should determine whether an answer is accepted.
* Do not remove one-shot protection as a shortcut.
* Do not remount the isolated input if doing so dismisses the mobile keyboard.

## Required automated tests

Add direct regression tests for the real event paths.

### Desktop physical keyboard

Test the complete event sequence with a guaranteed prompt fixture:

1. Present `K`.
2. Complete its audio.
3. Dispatch `keydown K`.
4. Dispatch `keyup K`.
5. Advance to the next guaranteed `K`.
6. Dispatch one `keydown K`.
7. Dispatch one `keyup K`.
8. Verify the second prompt is accepted from that single press.

Also cover:

* `K, K, K`.
* `M, M`.
* `K, M, K`.
* A fast keypress during playback, deferred and graded exactly once after playback.
* A held `K` producing repeat events across a prompt boundary, which must not answer the next prompt.
* A real keyup followed by a fresh `K`, which must answer it.
* Multiple events attempting to claim one prompt.
* Corrective replay and cancellation.
* Session end and unmount with queued input.

Do not make a passing test depend on manually omitting `keyup` and then clearing held state through prompt replacement. Model realistic browser event order.

### Mobile-style input

Using input/change/composition events rather than global `window.keyDown`, test:

* `K, K, K` across three separate prompts.
* `M, M`.
* `K, M, K`.
* One mobile input event per answer.
* Input during playback is deferred.
* Exactly one answer is graded.
* The visible value is cleared for the next prompt.
* The same input DOM element remains mounted.
* The input remains enabled.
* Focus is retained or restored without a disabled transition.
* Composition input continues to submit only after composition ends.
* Stale queued input is discarded on cancellation, navigation, and session end.

Keep the existing group, word, continuous-copy, and physical held-key regression coverage.

## Manual browser validation

After automated checks, test with actual devices.

### Desktop Chromium

At both 20/12 and 8/5:

* Complete at least 20 guaranteed consecutive identical prompts.
* Test `KKK`, `MMM`, `KKMMKK`, and alternating sequences.
* Use one intentional press per prompt.
* Respond both immediately at the audible end and after a short pause.
* Verify there are no ignored first presses, double submissions, or premature grading.

### Real mobile browser

Use at least one actual phone with its soft keyboard:

* Begin isolated-character practice.
* Confirm the keyboard opens once.
* Complete at least 20 isolated prompts.
* Confirm it stays visible through playback, feedback, and consecutive prompts.
* Confirm `KKK`, `MMM`, and alternating sequences work with one tap per answer.
* Confirm group and word input remain unchanged.
* Check portrait and landscape layout.
* Record the browser and device used.

If a second mobile browser is available, smoke-test it as well. Clearly distinguish actual device verification from synthetic browser events.

## Verification commands

Run:

```bash
npm test -- src/ui/screens/LearnScreen.test.tsx
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

## Deliverables

Create one focused commit.

Report:

* Confirmed root cause with the actual event sequence.
* Files changed.
* Why the fix addresses both desktop repeated characters and mobile keyboard dismissal.
* New test cases.
* Full verification results.
* Desktop and mobile manual results.
* Commit SHA.
* Any remaining genuine-device limitation.

Do not mark Phase 3 complete unless one physical press or mobile tap reliably answers each consecutive identical prompt and the mobile keyboard remains present throughout isolated-character practice.
