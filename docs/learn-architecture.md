# Learn architecture

This document defines the behavior-preserving boundaries for RX Learn. The
source of truth for stable phase IDs and machine-readable contracts is
`src/training/lesson-plan.ts`.

## Phase model

The conceptual order is:

```text
introduction -> acquisition -> remediation -> contrast
  -> two-character groups -> three-character groups
  -> focused words (when eligible) -> continuous copy -> summary
```

Introduction and acquisition repeat as a pair for each newly introduced
character. Remediation is present only for pending review characters. Focused
words are present only when the unlocked set supplies the configured eligible
word pool. Those conditions do not change the stable phase IDs.

| Phase ID          | Permitted events              | Entry and completion                                                      | Next phase                           |
| ----------------- | ----------------------------- | ------------------------------------------------------------------------- | ------------------------------------ |
| `introduce`       | `introduce`                   | A character is new; learner completes its learner-controlled intro        | `acquire`                            |
| `acquire`         | `copy-character`              | A new character needs isolated work; threshold or cap is reached          | `introduce`, `remediate`, `contrast` |
| `remediate`       | `copy-character`              | A review flag exists; configured isolated prompts complete                | `contrast`                           |
| `contrast`        | `copy-character`              | Earlier isolated work completes; mixed threshold or cap is reached        | `groups-2` or `continuous-copy`      |
| `groups-2`        | transition, `copy-group`      | Contrast completes; configured two-character groups complete              | `groups-3`                           |
| `groups-3`        | notification, `copy-group`    | Two-character groups complete; configured three-character groups complete | `words` or `continuous-copy`         |
| `words`           | transition, `copy-word`       | Enough eligible words exist; configured focused-word work completes       | `continuous-copy`                    |
| `continuous-copy` | transition, `continuous-copy` | Planned cards complete; stream completes or is abandoned                  | `summary`                            |
| `summary`         | summary                       | Session ends; learner chooses a next action                               | none                                 |

The phase contract also declares whether a phase records attempts, affects
scheduling or review, can affect readiness, and permits typing or submission
during playback. Current prompt-bound phases permit type-behind but do not
permit grading during playback. Only continuous copy can affect readiness.

Labels are presentation. Target length, button text, card counts, and rendered
copy are not phase identity.

## Ownership boundaries

- `LessonPlan` chooses ordinary lesson cards and applies configured acquisition,
  remediation, contrast, and group rules. It is pure and seeded.
- `LearnSession` owns curriculum-driven event order, optional focused words,
  continuous-copy generation and grading, session evidence, and summaries. It
  does not use React, browser APIs, or storage.
- `useLearnSession` owns React lifecycle integration, prompt locks, audio
  commands, persistence operation state, and durable advancement commands. It
  consumes domain events and does not infer phases from UI text.
- `RxAudio` accepts text plus timing or an already-built schedule. It does not
  know whether content came from Learn, Practice, or another source.
- `useContinuousCopy` accepts only a schedule and duration. It does not import a
  lesson event or content generator.
- Learn persistence records session and attempt facts. Persistence must finish
  before summary progression controls become active.
- Advancement assessment is pure domain logic. Durable acceptance is explicit,
  idempotent, and separate from producing an offer.

```text
Lesson generator -----\
Practice generator ----+-> normalized supported RX content -> CW schedule -> RxAudio
Future text source ----/                                      |
                                                              +-> optional copy grading
```

A future text source belongs to a separate non-curriculum Practice
orchestration. It must not become a `LessonPlan` phase or `LearnSessionMode`.
It may reuse Morse normalization, timing, `RxAudio`, copy grading, active-time
tracking, and safe aggregate persistence.

## Advancement and evidence

These invariants are not phase-order conveniences and must remain independently
tested:

- Learn is RX-only, and Practice does not change curriculum progression.
- Continuous-copy evidence drives readiness, but only explicit durable
  acceptance unlocks one next character.
- Assisted, replayed, and abandoned evidence remains excluded where specified.
- Continuous copy cannot clear isolated remediation.
- Input remains prompt-bound and one-shot. Type-behind behavior is unchanged.
- Introduction remains learner-controlled.
- Audio cancellation and suspension invalidate stale work.

## Audio and long content

Current playback is whole-schedule based. `buildContinuousCopyPlan` creates all
tokens, `audioText`, `gradingTarget`, and the complete `Schedule` in memory.
`useContinuousCopy` passes that schedule to `RxAudio.playSchedule`, and
`CwEngine` schedules the complete set of gain events.

This is appropriate for the current configured one-, three-, five-, and
ten-minute streams, but it is not a long-file streaming API. A future bounded
player should insert chunk production between normalized semantic content and
`buildSchedule`/`playSchedule`. Its own orchestration should request a bounded
chunk, schedule it, retain only needed grading state, and then request the next
chunk. The existing engine should continue receiving content and timing data,
not browser `File` objects.

Do not solve that future problem by building one enormous schedule, retaining
the full source in React state, or routing imported content through Learn.

## Persistence, privacy, and versions

Current persisted sources are `learn`, `copy-practice`, and `send-practice`.
Attempts carry `schemaVersion` and `scoringAlgorithmVersion`; projections carry
a projection version. That is sufficient for this refactor, so no schema,
database, projection, or scoring version changes are required.

A future imported-text source may persist aggregate facts such as active
duration, characters sounded and copied, accuracy, character/effective WPM,
and supported/skipped character counts. It must not persist or export:

- file contents or reconstructable chunks;
- filename or path;
- raw excerpts;
- curriculum evidence that unlocks characters or clears remediation.

Adding an `imported-text` source requires a separate data-model review because
source enums and export validation are persisted semantics. Raise the record or
export schema version when compatibility requires it. Raise the scoring
algorithm version when old attempts must retain a different grading meaning.
Raise the projection version when derived metrics change. Reordering phases or
changing React orchestration alone requires none of those migrations.

## Test strategy

Pure domain tests cover plan order and completion, weighting, words,
continuous-copy generation and grading, readiness, retry recommendations,
normalization, and tokenization. They use seeded RNG and injected clocks.

Contract tests cover session-to-hook events, schedule-to-audio calls,
persistence ordering, and durable advancement. Fake audio and clocks make these
checks deterministic.

UI journeys use `src/ui/test/learn-test-driver.ts` to inspect stable phase IDs,
answer the current target, advance to a named phase, complete a phase, complete
continuous copy, or abandon. Assertions remain in tests. Direct tests remain
for keyboard repeat, focus, replay, cancellation, and prompt-token behavior.

## Changing the flow

To add a phase:

1. Add its stable ID and contract to `LEARN_PHASE_ORDER` and `LEARN_PHASES`.
2. Put card selection in `LessonPlan`, or session-level interstitial and
   continuous behavior in `LearnSession`, according to ownership.
3. Add configuration only for behavior that is genuinely configurable.
4. Attach the phase ID to every emitted event and expose it unchanged through
   the hook.
5. Add pure ordering/completion tests, boundary tests, and one semantic journey
   only where the user flow changes.

To reorder a phase, change the domain plan/session transition that owns the
order and update the phase catalog. UI labels and test loop counts must not
control ordering.

To add a generated exercise type, define its domain type and generator, specify
its scoring and evidence eligibility, and then map its event to existing audio
and persistence facades. A new persisted attempt type requires schema and
export compatibility review.

## Developer checklist

- Phase ID and contract are explicit.
- Entry, completion, transitions, evidence, and playback permissions are tested.
- Seeds, clocks, time zones, and storage state are controlled in tests.
- React renders domain state and does not decide curriculum rules.
- Audio receives text/timing or a bounded schedule, never a content source.
- Persistence completes before progression actions become active.
- Advancement still requires explicit durable acceptance.
- Imported/private content is neither retained nor treated as curriculum evidence.
- Focused tests pass, followed by format, lint, typecheck, full test, and build gates.
- Desktop, mobile, pacing, input, continuous-copy, interruption, and deployment
  smoke checks cover any affected behavior.
