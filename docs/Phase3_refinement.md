Continue from the latest code. This work has two ordered goals:

> **Document status (2026-09-24): Historical completed implementation brief.**
> The separate learner checkpoint described in this plan was later removed by
> `.plans/checkpoint_change.md` and commits `28bcbce` and `d6737ad`.
> Continuous-copy evidence plus explicit learner acceptance now controls
> advancement. The isolated Replay/input-lock requirements in Part A were later
> superseded by `.plans/debug_phase3.md` and commit `8d1a110`, which keep the
> isolated input enabled and defer grading until matching playback completes.
> Uppercase project checkpoints in the master roadmap remain implementation
> review gates, not learner-facing tests.

1. Close the remaining correctness findings from the previous review.
2. Expand Learn from a short demonstration into a substantial RX lesson with visible phase transitions, longer adaptive practice, timed continuous copy, and eligible word copy.

Complete the correctness work first and keep it in a separate commit. Do not bury those fixes inside the larger lesson redesign.

# Part A: Close the remaining Checkpoint 3 findings

## A1. Make unresolved review state affect checkpoint readiness

Current problem:

`checkpointReadiness()` considers rolling accuracy but does not directly consider `needsReview`. A character missed during a checkpoint can remain flagged while readiness reports `READY`, because checkpoint misses do not reduce its rolling practice accuracy.

Required behavior:

- Check unresolved `needsReview` state before statistical readiness checks.
- If any active character remains flagged, return:

  - `ready: false`
  - `reason: "NEEDS_REVIEW"`
  - `weakCharacter` set to the first unresolved character in curriculum order.

- Apply this to both older characters and the newest character.
- Keep manual **Try a checkpoint** available if that is the current product decision, but the readiness message must remain truthful.
- Completing the explicit remediation rule should clear the flag and allow readiness to be recalculated normally.

Add tests proving:

- A checkpoint-missed older character vetoes readiness even when its rolling accuracy is high.
- A checkpoint-missed newest character vetoes readiness.
- An unresolved review flag survives a partial lesson.
- Readiness becomes available only after remediation completion.
- Manual checkpoint entry remains possible if intentionally supported.

## A2. Require a fresh remediation streak

Current problem:

`recordReviewOutcome()` is called for ordinary isolated responses even when a character is not under review. Characters can accumulate `reviewStreak` before a review condition exists. If normal accuracy decay later sets `needsReview`, one correct response may clear the flag immediately.

Required behavior:

- `recordReviewOutcome()` must only accumulate a streak while `needsReview === true`.
- If a character is not under review, its review streak should remain zero.
- Whenever `recordAttempt()` changes `needsReview` from false to true because of accuracy decay, reset `reviewStreak` to zero.
- Checkpoint misses must continue resetting the streak to zero.
- Assisted and replayed responses must never increment the streak.
- Group, word, and continuous-copy character results must not count toward the clean isolated remediation streak.
- The streak should represent consecutive clean, unassisted, unreplayed, isolated responses only.

Add regression tests for:

- Ordinary acquisition successes do not pre-accumulate a review streak.
- A character receives several correct acquisition responses, later decays, and still requires the full fresh remediation streak.
- A remediation miss resets the streak.
- Assisted, replayed, group, word, and continuous-copy results cannot clear review.
- Persistence across sessions remains correct.

## A3. Prevent a physically held key from answering a later prompt

Current problem:

The one-shot prompt token rejects repeated events during one prompt, but it does not track physical key state across prompts. If a key remains held while the next prompt finishes and focus returns, repeat events may answer the new prompt.

Required behavior:

- Track supported printable physical keys using `keydown` and `keyup`.
- Ignore `keydown` events where `event.repeat === true`.
- A physical key must be released before that same key can answer a later prompt.
- Maintain a held-key set or equivalent latch outside transient React render state.
- Clear held-key state on:

  - keyup;
  - blur where appropriate;
  - lesson cancellation;
  - navigation/unmount;
  - checkpoint completion;
  - new session initialization.

- Continue supporting mobile keyboards and IME input through the current `onChange`/composition fallback.
- Do not make mobile input depend on desktop `keydown`.
- Route both desktop and mobile paths through the same one-shot acceptance gate.
- Modifier combinations must not submit.
- Pasting into an isolated prompt may accept at most the first supported character.

Add UI tests proving:

- Repeated keydown events are ignored.
- Holding K across completion of the next prompt does not answer it.
- Keyup followed by a fresh K keydown can answer the next prompt.
- Mobile-style change events still work.
- Composition input is accepted only after composition ends.
- Checkpoint prompts have the same protection.

The existing test that fires several change events during one token is not sufficient. Add a cross-prompt held-key test.

## A4. Lock input during Replay and make playback state generation-safe

Current problem:

Replay starts audio but does not lock the answer field. A learner can answer while replay is still playing. Also, completion of an older canceled playback can set `isPlaying=false` while a newer playback is active.

Required behavior:

- Lock input before Replay starts.
- Re-enable input only after Replay completes and the card token is still current.
- Replay must not create a new scored attempt.
- Replay must continue marking the eventual answer assisted/replayed.
- Disable Replay while any playback is active.
- Prevent multiple simultaneous Replay calls.
- Add a playback-generation token or equivalent ownership model:

  - Only the currently owned playback may clear `isPlaying`.
  - Completion of an older canceled playback must not change the state of newer playback.

- A replayed prompt must not be cut short because input remained active.
- Flow changes must invalidate both playback ownership and input unlocking.

Add tests proving:

- Input is disabled throughout Replay.
- It re-enables after Replay completes.
- A stale playback completion cannot set `isPlaying=false` for newer audio.
- Rapid Replay clicks create one playback.
- Ending the lesson during Replay does not unlock stale input.

## A5. Make cancellation and suspension lifecycle-safe

Current problem:

`CwEngine.cancel()` schedules a short ramp and relies on `onended` to resolve the playback promise. Some cleanup paths call `cancel()` and immediately suspend the AudioContext. Suspension freezes the audio clock and may prevent the scheduled stop from reaching `onended` until a later resume.

Required behavior:

- Make playback cancellation completion explicit.
- Prefer a `cancel(): Promise<void>` contract, or an equivalent mechanism that confirms the active voice has stopped and its promise has resolved.
- Suspend the AudioContext only after cancellation completes.
- React unmount cleanup cannot await directly, so provide a lifecycle-safe helper that cancels immediately and schedules suspension only after voice disposal without allowing stale UI changes.
- Do not rely on untracked 60 ms timers.
- If a delayed suspension is retained:

  - store its timer;
  - cancel it when a new audio flow begins;
  - validate a lifecycle generation before suspending.

- Starting a new lesson or checkpoint must not be interrupted by a suspension scheduled by an earlier flow.
- Preserve the five-millisecond anti-click ramp.
- Ensure nodes are disconnected and playback promises settle on:

  - End session;
  - checkpoint result;
  - route navigation;
  - component unmount;
  - starting a replacement prompt;
  - starting Practice after leaving Learn.

- Verify the Firefox media-element output path actually releases or pauses its sink when suspended and resumes it correctly.

Add audio lifecycle tests for:

- Cancel followed by suspend resolves the playback promise.
- Unmount during playback leaves no unresolved voice.
- Starting new audio cancels pending suspension.
- Stale suspension cannot stop a new lesson.
- Media-element sink pauses and resumes appropriately.
- Volume changes still affect the master gain live.
- Zero percent volume remains mute.

Once Part A is complete, run all existing checks before beginning Part B.

# Part B: Expand the RX lesson experience

## Product goal

The current lesson feels like a brief demonstration:

- A character is introduced.
- It receives only a few isolated prompts.
- Another character appears.
- The app silently changes to two-character groups.
- It silently changes to three-character groups.
- The lesson ends after only a few group attempts.

Replace this with a deliberate progression that develops actual recognition and sustained copying:

1. Introduce new characters.
2. Acquire each character with sufficient isolated practice.
3. Mix the active characters in balanced single-character copy.
4. Explicitly transition into multi-character copy.
5. Build from short groups into continuous timed copy.
6. Introduce word copy when the active character set supports a useful vocabulary.
7. End with a clear summary and checkpoint-readiness result.

Keep Learn RX-only.

# Part C: Longer adaptive character acquisition

## C1. Replace the fixed four-card acquisition block

Do not simply change `acquirePerNewChar` from 4 to a larger arbitrary number. Implement a bounded adaptive rule.

Add named, tunable configuration such as:

```text
acquireMinAttempts: 8
acquireRecentWindow: 8
acquireMinCorrect: 6
acquireMaxAttempts: 14
```

Required behavior:

- Each newly introduced character receives at least eight unassisted isolated attempts.
- After the minimum, continue until it has at least six correct responses among its most recent eight clean acquisition attempts.
- Assisted and replayed responses do not count toward the minimum, window, or criterion.
- Cap acquisition at the configured maximum so the lesson cannot become endless.
- If the learner reaches the cap without meeting the criterion:

  - keep the character active;
  - mark it for continued review;
  - proceed without presenting the situation as failure.

- A miss should schedule the existing assisted reinforcement card.
- Do not reset all progress because of one miss.
- Acquisition state must be deterministic and unit-testable.

## C2. Treat the initial K/M pair symmetrically

For the first lesson:

- Introduce K.
- Give K its complete adaptive acquisition block.
- Introduce M.
- Give M its complete adaptive acquisition block.
- Do not treat M as the only “newest” character deserving practice.
- Both initial characters must receive equal minimum coverage.

## C3. Expand mixed single-character copy

After acquisition, run a substantial mixed isolated phase.

Suggested defaults:

```text
contrastMinAttempts: 16
contrastMaxAttempts: 24
contrastRecentWindow: 12
contrastMinAccuracy: 0.80
```

Required behavior:

- For K/M, balance the two characters.
- For larger active sets:

  - prioritize the newest character;
  - prioritize unresolved review and weak characters;
  - retain representation of older characters;
  - avoid accidentally omitting a character that requires review.

- Avoid long predictable runs of the same target.
- Assisted/replayed results remain excluded.
- Extend the phase adaptively when recent performance is weak, up to the configured cap.
- Show the current mode persistently as **Single-character copy**.

# Part D: Explicit mode transitions

## D1. Add first-class transition events

Do not represent transitions as fake copy exercises.

Add a lesson event or discriminated union such as:

```text
exercise
transition
continuous-copy
summary
```

A transition must:

- Carry a stable transition identifier.
- Include a title, explanatory text, destination phase, and action label.
- Record no attempt.
- Affect no mastery data.
- Not be counted as a scored card.
- Be deterministic and testable.

## D2. Required major transition

Before multi-character copy, show:

> **Ready for something longer?**
> You’ve learned the individual sounds. Now copy several characters without stopping between them.

Button:

> **Go**

This is an intentional click. It marks a real change in task and gives the learner time to reset.

## D3. Other transitions

Use blocking Go interstitials for major task changes:

- Single-character recognition → multi-character copy
- Short groups → continuous copy
- Random-character copy → word copy, when available

Do not require a button for every group-length change.

When moving from two to three characters, show a brief nonblocking notification:

> **Now copying 3-character groups**

Then continue automatically after a short, named delay, or allow any key/Go to continue immediately.

## D4. Persistent phase labels

The Learn screen must always show a meaningful phase label, for example:

- `Learning K`
- `Learning M`
- `Single-character copy`
- `2-character groups`
- `3-character groups`
- `Continuous copy · 0:42 remaining`
- `Word copy`
- `Checkpoint`

Do not make the learner infer the mode from input length.

# Part E: Expand short-group practice

Use short groups to teach continuous entry before the timed stream.

Suggested first-lesson defaults:

```text
twoCharacterGroupCount: 8
threeCharacterGroupCount: 8
```

Required behavior:

- Run at least eight two-character groups.
- Then announce the transition to three-character groups.
- Run at least eight three-character groups.
- Every adaptive group must contain its focus character.
- Weight new, weak, and review characters.
- Continue using sequence-aligned grading.
- Auto-submit when the expected group length is reached.
- Enter may submit early.
- Keep neutral feedback.
- Assisted/replayed behavior remains excluded from mastery.
- The group phase must not unlock curriculum characters.

For later lessons, group lengths and counts may grow through configuration, but early lessons should remain approachable.

# Part F: Implement timed continuous copy

## F1. Add a dedicated continuous-copy mode

Continuous copy is not a large ordinary `copy-group` card.

Create a dedicated domain/session model, for example:

```text
ContinuousCopySession
ContinuousCopyPlan
ContinuousCopyResult
```

It must be pure and testable outside React.

The flow:

1. Show a transition screen.
2. Learner presses Go.
3. Generate and preserve the complete target stream.
4. Begin continuous Morse playback.
5. Enable the text field while audio is playing.
6. Learner types continuously behind the signal.
7. End when the configured audio duration is reached.
8. Allow a short configurable grace period for finishing the final characters.
9. Grade the complete copy using sequence alignment.
10. Show results and feed clean practice observations into scheduling/mastery.
11. Continue to the lesson summary.

This mode intentionally differs from isolated copy:

- Isolated/group input remains locked until prompt audio completes.
- Continuous-copy input must be active during playback.

Keep those two input policies explicit in the code.

## F2. Duration choices

Add selectable durations:

- 1 minute
- 3 minutes
- 5 minutes
- 10 minutes

Default and recommendation:

| Active characters           | Recommended duration |
| --------------------------- | -------------------: |
| 2–4                         |             1 minute |
| 5–10                        |            3 minutes |
| 11–20                       |            5 minutes |
| 21+                         |            5 minutes |
| Optional endurance practice |           10 minutes |

Requirements:

- Use one minute as the initial default.
- Persist the learner’s explicit duration choice.
- Show the recommended duration without forcing it.
- Allow duration selection in Settings.
- Keep old stored settings compatible by applying defaults when the field is absent.
- The duration applies to continuous copy, not the entire lesson.

## F3. Build streams by scheduled audio duration

Do not estimate duration only from raw character count.

Use the actual Morse timing/schedule model:

- Generate candidate characters.
- Build or extend the schedule until its actual scheduled duration meets the selected target.
- Preserve the final target and schedule used for playback.
- Avoid cutting a character midway at the duration boundary.
- The displayed timer should be based on the scheduled duration and monotonic/audio time, not the number of characters.

For the bounded maximum of ten minutes, a pre-generated schedule is acceptable if performance is verified. Do not chain ordinary `playText()` calls in a way that introduces audible gaps.

If implementing rolling scheduling instead:

- Maintain a safe scheduling horizon.
- Do not cancel the previous chunk when scheduling the next.
- Prove there are no audible inter-chunk gaps.
- Preserve exact target ordering for grading.

## F4. Stream content

For random-character streams:

- Use only active characters.
- Guarantee reasonable active-set representation when duration permits.
- Give the newest character additional coverage.
- Give unresolved review and weak characters additional weight.
- Avoid predictable alternating sequences.
- Avoid excessive repeated-character runs unless deliberately configured.
- Keep generation seedable and deterministic for tests.
- Never display the target while copying.
- Do not reveal total character count.
- Ignore whitespace in random-character answers.

At the K/M stage, the stream should be varied K/M copy lasting the selected duration, not three characters repeated a few times.

## F5. Continuous-copy UI

During playback show:

- `Continuous copy`
- Remaining time or a progress bar
- A multiline, monospaced input area
- The learner’s typed copy
- A subtle **Listening…** state
- An End session control

Do not show:

- The target
- Correct/incorrect feedback during playback
- Morse notation
- Expected character count
- Per-character checkmarks
- Replay

Input requirements:

- Keep focus in the text area.
- Allow normal keyboard editing during the stream.
- Do not auto-submit based on length.
- Do not erase the learner’s input during playback.
- Support mobile keyboard input.
- Do not let global shortcuts steal ordinary copy characters.

At stream completion:

- Stop audio cleanly.
- Keep input enabled for a short named grace period, such as two seconds or a timing-derived equivalent.
- Show a visible **Finishing…** state.
- Then grade automatically.
- Optionally allow the learner to press Finish during the grace period.

If the learner manually ends the lesson before the stream completes:

- Do not mark all unplayed target characters wrong.
- Either discard that stream from mastery or grade only the portion confirmed to have been transmitted.
- Prefer discarding an intentionally aborted stream for the first implementation.
- Record that the stream was abandoned separately from accuracy.

## F6. Continuous-copy grading

Use the existing deterministic sequence-alignment approach, extended as needed for longer input.

Return at least:

```text
targetCharacters
typedCharacters
alignedCorrect
accuracy
perCharacterResults
insertions
deletions
substitutions
durationCompleted
abandoned
```

Requirements:

- A missed character must not shift every result after it.
- Extra typed characters must not receive target-character credit.
- Repeated-character alignment must remain deterministic.
- Per-character RX observations may feed practice mastery.
- Continuous-copy results may affect scheduling, review, and readiness.
- Continuous copy must not directly unlock a character.
- Only the checkpoint unlocks curriculum progress.
- Do not use continuous-copy results to clear the isolated remediation streak.

Performance:

- Verify alignment remains responsive for ten-minute streams.
- If full dynamic-programming memory becomes excessive, use a bounded-memory or banded alignment implementation while preserving deterministic behavior.
- Add performance tests with realistic maximum-length streams.

# Part G: Add eligible word copy

## G1. Gate word copy on available vocabulary

Do not show word copy during K/M practice.

Use the existing eligible-word corpus/selector and add named criteria such as:

```text
minimumEligibleWordCount: 10
initialWordMinLength: 2
initialWordMaxLength: 4
wordCopyCount: 8
```

Required behavior:

- Enable word copy only when the active set can form a useful minimum-sized word pool.
- Use only words composed entirely of active characters.
- Favor words containing:

  - the newest character;
  - unresolved review characters;
  - current weak characters.

- Avoid repeatedly selecting the same few words.
- Keep generation deterministic for tests.

## G2. Word-copy transition

Before the first word-copy phase, show:

> **Ready to copy words?**
> Now listen for complete word rhythms instead of separate characters.

Button:

> **Go**

## G3. Word-copy interaction

For initial word cards:

- Do not reveal the expected length.
- Play the word once.
- Allow the learner to type the word.
- Submit on Enter.
- Preserve optional Replay, but mark the answer replayed/assisted and exclude it from clean mastery.
- Use sequence alignment for grading.
- Show neutral feedback after submission.
- Start with short eligible words.
- Add callsigns, abbreviations, phrases, and timed word streams later, not in this change unless already easy to support.

Random continuous copy and word copy serve different purposes. Keep both.

# Part H: Lesson composition

Use this target flow for the first K/M lesson:

1. Introduce K.
2. Adaptive K acquisition:

   - minimum eight clean attempts;
   - extend based on recent performance;
   - bounded maximum.

3. Introduce M.
4. Adaptive M acquisition with the same rule.
5. Balanced mixed single-character copy:

   - minimum 16 prompts;
   - extend adaptively up to 24.

6. Transition:

   - **Ready for something longer?**
   - Go.

7. Eight two-character groups.
8. Brief notification:

   - **Now copying 3-character groups**

9. Eight three-character groups.
10. Transition:

    - **Ready for continuous copy?**
    - Explain that the learner should type continuously while listening.
    - Go.

11. One-minute continuous K/M stream.
12. Session summary.
13. Checkpoint-readiness result.
14. Optional checkpoint.

For a later lesson with a newly unlocked character:

1. Introduce the new character.
2. Adaptive isolated acquisition.
3. Remediate pending older characters.
4. Mixed isolated contrast across the active set.
5. Multi-character groups weighted toward new/weak/review characters.
6. Timed continuous copy.
7. Eligible word copy, only if the corpus threshold is met.
8. Summary and optional checkpoint.

# Part I: Session summary and metrics

The existing “cards” and “attempts” metrics become ambiguous with continuous copy.

Update the model to report clearly:

- Cards completed
- Isolated prompts completed
- Groups completed
- Words completed
- Continuous-copy duration
- Characters transmitted
- Characters typed
- Aligned character accuracy
- Characters needing review
- Assisted/replayed items excluded from mastery
- Checkpoint readiness

Do not count a one-minute stream as merely one scored attempt without also reporting its character-level work.

Keep analytics semantics explicit:

- Card-level correctness for ordinary cards.
- Character-level aligned correctness for groups, words, and streams.
- Only unassisted/unreplayed observations feed mastery.
- Continuous-copy accuracy does not clear isolated remediation.
- Practice never unlocks characters.

# Part J: State-machine and architecture requirements

The lesson is now dynamic enough that a fixed prebuilt array may become awkward.

Refactor only as much as necessary, but make phase behavior explicit.

Preferred shape:

```text
LessonController
  currentPhase
  currentEvent
  reportResult()
  continueTransition()
  startContinuousCopy()
  completeContinuousCopy()
  next()
```

Requirements:

- Pure domain logic should decide progression.
- React should render and orchestrate audio, not decide pedagogical rules.
- Every phase must have explicit entry and exit criteria.
- Randomness remains injected and seedable.
- Configuration remains named and testable.
- No phase should unlock the curriculum.
- Checkpoint logic remains separate.
- Avoid one giant React hook containing acquisition rules, stream generation, timers, audio lifecycle, and grading.
- Continuous-copy audio/UI orchestration may have its own hook.
- Reuse shared audio cancellation and lifecycle primitives rather than creating another independent race-prone implementation.

# Part K: UX and tone

Keep the interaction encouraging and low-friction:

- No red crosses.
- No sad faces.
- No lives.
- No punitive streak-reset animation.
- Misses cause more practice, not failure messaging.
- Use positive transition copy without claiming mastery too early.
- Keep the automatic flow within a phase.
- Use Go only at meaningful mode changes.
- Continue supporting manual pacing.
- Manual pacing should not require Continue after every character in continuous copy.
- Ensure all controls are keyboard accessible.
- Maintain visible focus and screen-reader labels.
- Announce phase transitions through an appropriate live region without repeatedly announcing every typed character.

# Part L: Scope constraints

Do not:

- Reintroduce TX cards into Learn.
- Make TX affect readiness, remediation, checkpoints, lesson completion, or unlocking.
- Change the checkpoint pass thresholds:

  - overall ≥90%;
  - newest ≥85%;
  - minimum newest coverage.

- Add an older-character checkpoint accuracy floor.
- Allow practice to unlock characters.
- Reintroduce Check, Next, or Got it for ordinary isolated prompts.
- Reveal checkpoint answers before completion.
- Reveal continuous-copy targets while copying.
- Require word copy before enough eligible words exist.
- Implement timed sending or paddle work in this milestone.
- Perform unrelated visual redesign, storage overhaul, or deployment work.

# Part M: Automated tests

Add or update tests for all of the following.

## Correctness follow-up

- `needsReview` vetoes readiness.
- Review streak starts only after the flag is set.
- Accuracy-decay transition resets the streak.
- Full fresh clean streak is required.
- Held physical key cannot answer a later prompt.
- Replay locks input.
- Stale playback completion cannot clear current playback state.
- Cancellation settles before suspension.
- Stale suspension cannot interrupt a new flow.

## Adaptive acquisition

- Minimum attempts always occur.
- Clean performance exits after the minimum.
- Weak performance extends acquisition.
- Maximum cap is enforced.
- Assisted and replayed cards do not satisfy acquisition criteria.
- K and M receive equal minimum initial coverage.
- Seeded behavior is deterministic.

## Transitions

- Transition events record no attempt.
- Go advances to the intended phase.
- No multi-character audio begins before Go.
- Two-to-three-character notification appears.
- Persistent phase labels match the actual phase.
- Manual and automatic pacing remain coherent.

## Groups

- Required number of two-character groups.
- Required number of three-character groups.
- Focus character is present.
- Weak/review characters receive intended weighting.
- Sequence alignment remains deterministic.

## Continuous copy

- Generated targets contain only active characters.
- Target schedule meets or slightly exceeds requested duration without cutting a character.
- Same seed produces the same target.
- Coverage and weighting rules hold.
- Excessive identical runs are prevented.
- Input is enabled during playback.
- No live correctness feedback appears.
- Input remains editable throughout.
- End-of-stream grace period works.
- Alignment handles insertion, deletion, substitution, and repeated characters.
- Aborted streams do not penalize unplayed material.
- Results update clean practice data but never unlock.
- Results cannot clear isolated remediation.
- Ten-minute generation and grading meet a reasonable performance budget.
- Cancellation/navigation leaves no timers, voices, or stale state.

## Word copy

- Hidden until eligible-word threshold is reached.
- Every selected word uses only active characters.
- Selection favors the newest/weak/review character when possible.
- Word length remains hidden.
- Enter submits.
- Replay excludes the result from clean mastery.
- Word transition records no attempt.

## Regression

- Checkpoint remains isolated and unassisted.
- Checkpoint feedback remains withheld.
- A pass unlocks at most one character.
- Learn remains RX-only.
- Existing punctuation input still works.
- Introduction persistence still records only completed introductions.
- Audio does not overlap at slow settings.
- Volume and output-device behavior remain correct.

# Part N: Manual browser verification

Test at:

- Normal timing: 20 WPM character / 12 WPM effective.
- Slow timing: 8 WPM character / 5 WPM effective.
- Automatic pacing.
- Manual pacing.
- Physical keyboard.
- Mobile or browser-emulated soft keyboard.

Verify:

- K and M each receive substantial practice.
- Phase changes are obvious.
- Multi-character audio never starts before Go.
- Two- and three-character modes are labeled.
- Continuous input remains available while Morse plays.
- A one-minute stream lasts approximately one scheduled minute.
- No audible gaps or overlapping tones occur.
- Held keys do not answer later prompts.
- Replay cannot be answered during playback.
- Ending or navigating away releases audio.
- Returning immediately does not trigger stale suspension.
- Word copy appears only when useful words exist.
- No TX cards appear.
- No console errors occur.

# Part O: Required verification commands

Run:

```text
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

If the repository has no CI workflow, add a small GitHub Actions workflow that runs these checks on pushes and pull requests. Keep it limited to verification and do not add deployment behavior.

# Part P: Commit sequence

Use focused commits in this order:

1. Fix remaining readiness, review-streak, held-key, Replay, and audio-lifecycle findings.
2. Add adaptive acquisition and expanded mixed-single-character practice.
3. Add lesson transition events and phase labels.
4. Expand two- and three-character group practice.
5. Add continuous-copy domain model, generation, grading, and tests.
6. Add continuous-copy audio/UI flow and integration tests.
7. Add duration settings and storage-compatible defaults.
8. Add eligible word-copy phase and tests.
9. Add CI verification workflow if absent.

Do not combine all work into one large commit.

# Part Q: Completion report

When finished, report:

- Commit SHAs and one-line summaries.
- Any changes to the proposed architecture.
- Exact configuration defaults implemented.
- Exact test counts.
- Results of every verification command.
- Browser scenarios tested.
- Actual measured one-minute stream duration at 20/12 and 8/5.
- Maximum-stream generation and grading performance.
- Confirmation that Learn contains no TX exercises.
- Confirmation that practice cannot unlock characters.
- Confirmation that continuous-copy results cannot clear remediation.
- Confirmation that the AudioContext releases correctly.
- Any deliberate deviations from this specification and the reason for each.
