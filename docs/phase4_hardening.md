Phase 4 fixes and Learn retry refinement

Implement the following as focused commits. Preserve existing Phase 3/3.1 behavior and the established progression invariants.

1. Protect active sessions in other tabs

recoverInterruptedSessions() currently finalizes every active session, including sessions whose lease may still be valid in another tab.

Required behavior:

Recover an active session only when:
it has no ownership lease, or
leaseExpiresAt <= now.
Do not modify a session with a valid, unexpired lease.
Make lease expiration comparisons using canonical UTC instants.
Add compare-and-set protection so a lease renewal cannot race with recovery.
A recovery transaction must re-read and re-check the lease immediately before finalizing.
Recovery must remain idempotent.
Add an owner-aware repository operation:

renewSessionLease(sessionId, ownerTabId, expectedRevision, expiresAt)

The renewal must reject when the session is terminal, the owner differs, or the revision differs. Parse lease timestamps as UTC instants rather than relying on lexicographic string ordering.

IndexedDB write transactions serialize access to the shared stores. Tests must prove both legal transaction orderings:

- renewal commits first, then recovery observes the renewed lease and skips the session;
- recovery commits first, then renewal observes a terminal session and rejects.

Preserve the existing behavior of:
retaining committed attempts;
not synthesizing attempts or active time;
marking the session interrupted;
rebuilding projections transactionally;
removing obsolete ownership fields after recovery.

Add tests covering:

active session with no lease is recovered;
expired lease is recovered;
unexpired lease is untouched;
a lease renewed before the recovery transaction commits is untouched;
multiple expired sessions are recovered atomically;
two recovery callers do not double-finalize;
wall-clock rollback remains safe;
projection and operation-ledger writes roll back on failure.

2. Prevent Practice from modifying curriculum

Practice must remain analytics-only.

Required behavior:

copy-practice and send-practice attempts must not write:
curriculum state;
completed introductions;
progression events;
milestones;
advancement or mastery state.
Reject any Practice commit containing curriculum or introductions.

Prefer separate typed repository methods:

commitLearnAttempt()
commitPracticeAttempt()

The public types must make prohibited Practice payloads unrepresentable. Runtime guards must still reject Practice attempts that carry curriculum, introductions, progression events, milestones, advancement, or mastery data because TypeScript does not protect JavaScript callers or malformed runtime input.

A private shared attempt transaction is acceptable after the source-specific validation has succeeded.

Learn may continue saving ordinary curriculum statistics and remediation state.
Accepted advancement must eventually use its own explicit atomic progression operation rather than being hidden inside a generic attempt commit.

Add tests proving that both Practice sources:

can persist their session and attempt analytics;
cannot mutate curriculum or introductions;
roll back the entire transaction if prohibited progression data is supplied.

3. Add targeted retry choices when advancement readiness fails

When a learner finishes continuous copy without meeting the new-character readiness threshold, do not provide only the existing generic “Practice again” path.

Present two primary choices:

Practice long copy again
Start a new Learn-sourced session with mode `review` and a continuous-copy-only plan using the current active character set.
Generate a fresh stream rather than replaying the identical stream.
Preserve the existing word-eligibility, character-weighting, run-limit, and coverage rules.
Skip introductions, isolated acquisition, contrast drills, short groups, and focused words.
Return to the readiness summary when the stream finishes.
The new attempt may contribute fresh advancement evidence normally.
Restart the full lesson
Start a new Learn-sourced session with mode `learn` and return to the beginning of the lesson for the current active set.
Preserve curriculum, remediation, introductions, and historical attempts.
Do not unlock or reset characters.
This replaces the current ambiguous “Practice again” wording.

The readiness summary remains terminal. Each full lesson or long-copy retry is a separate durable session, and each completed stream is one durable attempt. Both paths retain the same active curriculum set.

Suggested UI copy:

Not quite ready for a new character yet. What would you like to practice?

Buttons:

Practice long copy
Restart full lesson

Do not frame this as failure. Do not use red error styling or negative icons.

4. Detect repeated continuous-copy difficulty

Track consecutive completed continuous-copy attempts that do not satisfy the accuracy portions of readiness.

Configuration:

Default suggestion threshold: 3 attempts
Supported configuration: 3, 4, 5, or Off
Name the configuration clearly, such as speedSuggestionAfterAttempts.
Do not count:
abandoned streams;
incomplete streams;
assisted or replayed work;
failures caused only by insufficient observations or coverage;
streams performed with a different active character set.

Reset the consecutive-difficulty counter when:

the learner meets readiness;
a new character is accepted;
the active character set changes;
the learner changes speed manually;
the learner restarts the full lesson.

Do not persist the counter as authoritative state and do not add a retry-state table or IndexedDB schema version for it. Derive it deterministically from authoritative session and attempt history.

Counter identity:

- ordered active set from `TrainingSessionRecord.unlockedAtStart`;
- character WPM;
- effective WPM.

To derive the current counter:

1. Find the most recent full Learn session boundary for the current active set.
2. Read subsequent completed continuous-copy attempts in reverse chronological order.
3. Stop when the ordered active set, character WPM, or effective WPM differs.
4. Stop at the first qualifying readiness success.
5. Count consecutive qualifying accuracy misses.
6. Ignore abandoned, assisted, replayed, and evidence-incomplete attempts.

A qualifying accuracy miss is a completed, unassisted, unreplayed continuous-copy attempt that has sufficient total evidence, covers every active character, has sufficient newest-character observations, and misses overall or newest-character accuracy. A review veto or coverage/evidence shortage does not increment the counter.

A normal full Learn session is an explicit reset boundary. Accepting a new character, changing the active set, or changing either speed naturally changes the counter identity. If performance later requires caching, use a rebuildable projection excluded from backups and rebuild it from sessions and attempts.

Persist `speedSuggestionAfterAttempts` in portable settings. Support `3`, `4`, `5`, and `off`, with `3` as the default. Add compatible validation and defaulting for existing settings records. This setting requires no IndexedDB schema-version change because it adds no table or index.

5. Suggest more spacing, not slower character sounds

After the configured number of consecutive accuracy misses, offer an optional pacing adjustment alongside the two retry choices.

First-stage recommendation:

Keep charWpm unchanged.
Reduce effectiveWpm by 2 WPM, bounded by the existing minimum.
Explain that individual characters will sound the same; the app will add more space between them.

Example:

Continuous copy is still feeling difficult. Want a little more space between characters? The characters will still play at 20 WPM, but the overall pace will drop from 12 to 10 WPM.

Actions:

Try 20 / 10 WPM
Practice again at 20 / 12
Restart full lesson

Applying the recommendation must require explicit learner acceptance. Never change speed automatically.

After acceptance:

persist the new effective speed through the normal settings path;
begin a fresh continuous-copy attempt;
record the actual character and effective WPM on the resulting session and attempt;
reset the consecutive-difficulty counter for the old speed;
do not alter curriculum or mastery directly.

If effectiveWpm is already at its minimum, do not repeatedly offer the same adjustment. For this milestone, prefer restarting the lesson instead of automatically reducing charWpm. Actual character-speed reduction can be evaluated separately later.

6. Recommendation logic

Use performance shape to choose what to emphasize:

Good isolated performance plus weak continuous copy: emphasize Practice long copy.
Weak isolated/remediation performance: emphasize Restart full lesson.
Repeated continuous-copy accuracy misses at the same settings: additionally offer increased spacing.
Insufficient coverage alone: offer another long-copy attempt without suggesting a speed change.

The learner should always retain all choices. “Emphasize” means ordering or recommended styling, not hiding alternatives.

Expose the isolated-performance signal explicitly rather than inferring it from continuous-copy readiness:

- eligible isolated observations;
- eligible isolated correct observations;
- isolated accuracy;
- whether the minimum isolated sample is satisfied.

This signal only selects which retry action to emphasize. It must not change readiness or advancement thresholds.

7. Progression invariants

Preserve all existing rules:

Learn remains RX-only.
Practice cannot unlock or modify curriculum.
Advancement requires explicit learner acceptance.
Continuous-copy evidence may produce a readiness offer but cannot unlock automatically.
Assisted, replayed, and abandoned work cannot contribute to readiness.
Accepting a slower effective speed is not advancement.
At most one character may be unlocked per accepted offer.
Existing overall, newest-character, coverage, and observation thresholds remain unchanged.
Speed and retry history must not be interpreted as correctness evidence.

The final active curriculum set must pass the same abandonment, review, total-evidence, active-set coverage, newest-character coverage, overall-accuracy, and newest-character-accuracy checks as every earlier set. Only after those checks:

- if another character exists, return a character-readiness result;
- if no character remains, return a curriculum-completion-eligible result.

Explicit learner acceptance of a completion-eligible result marks the remaining active set mastered and records curriculum completion without unlocking a character. A failed or abandoned final stream returns its ordinary failure reason, never a premature `COMPLETE` result.

8. Tests

Add focused tests for:

lease renewal rejects ownership, revision, and terminal-state conflicts;
recovery skips an unexpired lease using parsed UTC instants;
renewal-first and recovery-first transaction ordering;
multiple-session recovery and projection/ledger rollback;
Learn attempt commits may update curriculum and introductions;
copy-practice and send-practice commits persist analytics but reject all progression data atomically;
final-character evidence applies every ordinary readiness check;
accepted final-character evidence records completion without unlocking;

failed readiness displays both retry paths;
long-copy retry skips all earlier lesson phases;
full restart begins at the correct first phase;
retry produces a fresh deterministic stream;
repeated accuracy misses trigger the spacing suggestion at exactly the configured count;
abandoned and coverage-only attempts do not increment the counter;
changing the active set or settings resets the counter;
accepting the suggestion changes only effective WPM;
declining it preserves current settings;
effective-speed minimum does not create repeated unusable suggestions;
completing a retry can generate a readiness offer;
no retry path unlocks automatically;
mobile layout accommodates the additional actions;
keyboard focus and automatic input behavior remain intact.

Implementation order:

1. Add lease renewal compare-and-set and lease-aware recovery.
2. Split Learn and Practice commit APIs with runtime guards.
3. Fix final-character evidence and explicit curriculum-completion acceptance.
4. Complete IndexedDB bootstrap and settings-provider cutover.
5. Add `speedSuggestionAfterAttempts` with compatible defaulting.
6. Add full-lesson versus continuous-copy-only session construction.
7. Implement pure retry classification derived from persisted history.
8. Add summary actions and the optional Farnsworth-spacing recommendation.

Run:

npm run format:check
npm run lint
npm run typecheck
npm test
npm run build

Report commit SHAs, deviations, configuration defaults, and browser/manual checks separately.

Browser verification must cover desktop, narrow mobile, physical-keyboard input, and mobile-keyboard focus. Unit tests may verify action presence and focus intent, but they do not replace viewport and real-input checks.
