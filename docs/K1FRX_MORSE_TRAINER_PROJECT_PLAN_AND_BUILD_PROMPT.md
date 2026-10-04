# K1FRX Morse Trainer

## Product Plan, Technical Roadmap, Migration Plan, and Agent Build Prompt

**Status:** Living master plan; Milestone 4 persistence and analytics work is complete, and Phase 5 kickoff is next  
**Owner:** K1FRX Radio  
**Working product name:** K1FRX Morse Trainer  
**Document purpose:** Give a development agent enough product, technical, and delivery context to build the application without relying on the original conversation.

### Current implemented decisions

These decisions supersede earlier drafts and are normative throughout this
document:

- Learn is RX-only. Sending remains available in Practice but does not affect RX
  advancement.
- There is no learner-facing checkpoint test. Uppercase `CHECKPOINT` headings in
  this roadmap are implementation review gates only.
- Advancement evidence comes only from the latest completed, non-abandoned
  continuous-copy stream.
- Continuous copy never unlocks automatically. A valid offer plus the learner's
  explicit **Learn {nextCharacter}** action unlocks exactly one character.
- **Practice these characters again** begins another lesson without changing the
  active set.
- Isolated, group, and word inputs may accept typing during playback, but grading
  waits for the matching audio completion. Prompt tokens and playback
  generations prevent stale submissions.

---

## 1. Executive summary

Build a web-first, installable CW learning application that combines:

- Koch-style character progression;
- Farnsworth timing;
- the adaptive progression and learned-character word selection demonstrated by Google's Morse trainer;
- genuine copy-by-ear training;
- timed sending practice using a keyboard, touchscreen straight key, and eventually physical input devices;
- useful longitudinal analytics based on raw practice history; and
- restrained, skill-based gamification inspired by Duolingo.

The existing K1FRX Morse Trainer is a working prototype embedded in a Jekyll blog page. It already proves several important primitives: CW tone generation, adjustable WPM and pitch, straight-key input and decoding, copy exercises, receiver noise, and mobile interaction. The next step is **not** to keep expanding that page. Migrate it into a dedicated repository and a maintainable React + TypeScript application.

The distribution strategy is:

1. Ship the browser application as a static site and installable Progressive Web App (PWA).
2. Wrap the same web application with Capacitor for Android and iOS when the core experience is stable.
3. Keep learning, audio, analytics, and persistence logic independent of React and native shells so future distribution and sync options do not require a rewrite.

The core product promise is:

> A Duolingo-like CW trainer that teaches real on-air Morse skills through Koch progression, adaptive review, sending practice, and meaningful performance analytics.

---

## 2. Product vision

### 2.1 The problem

Many Morse-learning tools emphasize visual dot/dash memorization, isolated drills, or generic practice. They often fail to connect:

- immediate auditory recognition;
- accurate physical sending;
- a clear learning path;
- adaptive review of weak characters;
- practice with useful amateur-radio content; and
- evidence of improvement over weeks and months.

The learner should hear a character as a unified sound pattern and recognize it directly, rather than mentally translating a visible sequence of dots and dashes.

### 2.2 The desired experience

The app should make starting a session nearly frictionless. A user opens it and sees one obvious action: **Continue learning**. The app selects an appropriate short lesson from the user's current stage and recent performance.

A typical Learn session mixes:

- hear a character and type the answer;
- copy random groups drawn only from unlocked characters;
- copy short words made only from unlocked characters;
- complete timed continuous copy for advancement evidence;
- review weak or decaying characters; and
- later, copy ham-radio words, callsigns, QSO fragments, and signals under noise.

Practice separately supports seeing a character or word and sending it with the
keying control.

Progress should feel visible and satisfying. Rewards must reflect real learning, not merely opening the app or accumulating arbitrary points.

### 2.3 Product principles

1. **Sound before notation.** Teach auditory patterns. Hide dot/dash notation during normal copy practice; expose it only for introductions, hints, correction, and reference.
2. **Copy drives progression, the learner controls advancement.** The latest completed continuous-copy stream may produce an advancement offer. Only explicit learner acceptance unlocks one next Koch character. TX mastery is tracked and trained separately and never affects listening progression.
3. **Fast characters, slower spacing.** Use normal character speed from the beginning and Farnsworth spacing to lower effective speed.
4. **Adapt, but remain explainable.** The scheduler should emphasize the newest, weakest, confused, and overdue characters using rules that can be tested and explained.
5. **Never punish returning.** Missed days do not remove progress. On return, run a lightweight check and schedule useful review.
6. **Record observations, derive analytics.** Preserve raw attempts and sessions so new metrics can be calculated later.
7. **Offline-first and private by default.** Initial versions need no account or server. Progress stays on-device unless the user explicitly exports it.
8. **One core application.** Web, PWA, Android, and iOS distributions should share the same domain logic and UI wherever practical.
9. **Accessible on phone and desktop.** Touch, keyboard, readable contrast, screen-size adaptation, and reduced-motion preferences are first-class requirements.
10. **Small, verifiable milestones.** Each milestone must leave the repository running, tested, and deployable.

---

## 3. Prior work and reference implementation

### 3.1 Existing K1FRX prototype

- Live application: <https://k1frx-radio.github.io/morse-trainer/>
- Current source location: the K1FRX Radio GitHub Pages/Jekyll repository, currently implemented as a single `morse-trainer.html` page plus blog assets.

Before changing anything, locate the current source file and document its behavior. Treat it as a behavioral reference, not as the desired architecture.

Known useful functionality to preserve:

- Web Audio CW tone generation;
- correct dit/dah element ratios;
- straight-key input from keyboard and touch;
- live key decoding;
- copy practice;
- WPM and tone controls;
- receiver/band noise;
- exercise corpora including letters, numbers, common CW words, and callsigns; and
- mobile-friendly interaction.

Known issue to verify and correct during extraction: if the playback implementation appends a three-unit character gap and then adds a seven-unit word gap for a following space, multiword phrases receive roughly ten units instead of the intended seven. Timing generation should model boundaries explicitly so the final total gaps are correct.

### 3.2 Google Morse trainer

- Live trainer: <https://morse.withgoogle.com/>
- Open-source repository: <https://github.com/googlecreativelab/morse-learn>
- Relevant files:
  - progression/state: <https://github.com/googlecreativelab/morse-learn/blob/master/scripts/game-state.js>
  - lesson/game orchestration: <https://github.com/googlecreativelab/morse-learn/blob/master/scripts/game-space.js>
  - word corpus: <https://github.com/googlecreativelab/morse-learn/blob/master/scripts/words.js>
  - word presentation and hints: <https://github.com/googlecreativelab/morse-learn/blob/master/scripts/word.js>
  - Morse dictionary: <https://github.com/googlecreativelab/morse-learn/blob/master/scripts/morse-dictionary.js>
  - configuration: <https://github.com/googlecreativelab/morse-learn/blob/master/scripts/config.js>
  - asset loading: <https://github.com/googlecreativelab/morse-learn/blob/master/scripts/app.js>
  - Apache 2.0 license: <https://github.com/googlecreativelab/morse-learn/blob/master/LICENSE>

Google's most valuable concepts are:

- an ordered character curriculum;
- per-character performance;
- offering one new character after demonstrated continuous-copy success and
  learner acceptance;
- emphasizing the newest character;
- selecting words composed only of unlocked characters;
- requiring words to contain the newest character during early reinforcement;
- escalating hints after errors; and
- small, satisfying accomplishments.

Do **not** port Phaser or clone the original interface. Reimplement the relevant learning concepts cleanly in TypeScript.

Licensing note: `morse-learn` is Apache-2.0. Reusing its _ideas_ (curriculum ordering, word-selection strategy, hint escalation) carries no attribution obligation. The Apache-2.0 `NOTICE`/attribution and license-header obligations trigger only when actual source code or assets are copied or adapted. Therefore:

- prefer original K1FRX visual assets and mnemonic concepts unless use of Google's assets is explicitly approved;
- if any code or asset is copied or adapted, record the exact source file and commit in `THIRD-PARTY-NOTICES`, retain the license header, and add the required attribution; and
- audit trademark/copyright implications separately from the code license before shipping.

### 3.3 Technical references

- Capacitor documentation: <https://capacitorjs.com/docs/>
- Capacitor PWA support: <https://capacitorjs.com/docs/web/progressive-web-apps>
- Capacitor development workflow: <https://capacitorjs.com/docs/basics/workflow>
- Web Audio API: <https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API>
- Audio clock and scheduling: <https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/currentTime>
- Precise AudioParam scheduling: <https://developer.mozilla.org/en-US/docs/Web/API/AudioParam/setValueAtTime>
- IndexedDB API: <https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API>
- Using IndexedDB: <https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB>

---

## 4. Learning model

### 4.1 Koch-style progression

Start with two characters. Use one selected, documented Koch sequence in v1. Keep the sequence configurable in domain data, but do not make sequence selection a user-facing setting yet.

Recommended initial behavior:

- character speed: 20 WPM;
- effective speed: 8–12 WPM using Farnsworth spacing;
- evaluate only the latest completed, non-abandoned continuous-copy stream for
  advancement;
- require at least 90% overall aligned accuracy and 85% newest-character
  accuracy;
- require at least eight newest-character observations and at least one
  observation of every active character;
- require total evidence of `max(24, round(activeCharacterCount * 6),
activeCharacterCount - 1 + 8)`, capped at 50 for the normal scaled length;
- unresolved `needsReview` state vetoes advancement;
- a valid assessment offers the next character but does not unlock it until the
  learner explicitly accepts;
- once unlocked, a character never becomes locked again;
- a previously strong character may be marked `needsReview` if recent performance decays.

All thresholds must be named configuration values and covered by tests. The first release may tune these defaults after actual use.

### 4.2 Separate RX and TX mastery

Track recognition and sending as different skills:

```ts
type CharacterProgress = {
  character: string;
  state: "locked" | "learning" | "mastered";
  needsReview: boolean;
  rx: SkillProgress;
  tx: SkillProgress;
  unlockedAt?: string;
  masteredAt?: string;
  lastPracticedAt?: string;
};
```

RX continuous-copy evidence determines advancement eligibility. Explicit learner
acceptance performs the one-character unlock. TX performance may change the mix
of separate sending Practice exercises but cannot create, block, or alter an RX
advancement offer.

### 4.3 Adaptive scheduler

The scheduler should weight candidates using:

- newest unlocked character;
- low recent RX or TX accuracy;
- high recognition latency;
- recurring confusion pairs;
- time since last exposure;
- suspected retention decay;
- session balance and avoidance of excessive repetition; and
- the exercise mode currently needed.

The algorithm must be deterministic when supplied with a seeded random-number generator. Return an explanation or reason code with each selected exercise, such as `NEW_CHARACTER`, `WEAK_RX`, `WEAK_TX`, `CONFUSION_REVIEW`, `SPACED_REVIEW`, or `BALANCED_PRACTICE`. This makes behavior testable and debuggable.

**Confusion-pair definition (shared by scheduler and analytics).** A confusion is recorded on an RX copy error as the _directional ordered pair_ `(target, answer)`, e.g. `(U, V)` is distinct from `(V, U)`. Only single-character copy errors count toward pair aggregation; word/group errors are attributed per mismatched character position. Aggregation uses the same rolling window as RX progression (initially the last 50 eligible attempts per involved character) so that stale confusions decay. A pair is "recurring" once it occurs at least a configured minimum number of times within the window. These names and values are configuration and covered by tests.

Do not introduce opaque machine learning in the initial product.

### 4.4 Exercise progression

Use a gradual sequence:

1. Introduce character with sound, letter, optional mnemonic, and temporary Morse notation.
2. Identify isolated characters by ear.
3. Mix active characters in balanced isolated copy.
4. Copy short random groups using unlocked characters.
5. Copy short words containing only unlocked characters when the eligible pool is useful.
6. Complete timed continuous copy and present any resulting advancement offer.
7. Add common ham-radio words and prosigns when all required characters are available.
8. Add callsigns, QSO fragments, speed, noise, fading, and interference challenges.

Prompted sending is a separate Practice progression and is not part of Learn.

Random groups remain important because meaningful words can be guessed from context. Word practice complements rather than replaces random copy.

### 4.5 Word selection

Build an indexed corpus where each entry can be filtered by its set of characters and tags. Candidate words must contain only unlocked characters. Early in a new stage, favor candidates containing the newest character. Later, blend in words that reinforce weak or confused characters.

Suggested tags include:

- `general`;
- `ham`;
- `qso`;
- `callsign`;
- `prosign`;
- difficulty or length; and
- language, reserved for future localization.

### 4.6 Feedback and hints

For copy errors:

- immediately replay the target when appropriate;
- show the expected character;
- show Morse notation only as correction/hint, not as the primary prompt;
- record target-to-answer confusion; and
- avoid turning one error into a long interruption.

For sending errors:

- distinguish wrong decoded pattern from timing-quality problems;
- report what was decoded;
- compare expected and observed elements;
- give one concise, actionable correction;
- initially grade pattern correctness separately from timing quality.

### 4.7 Gamification

Good candidates:

- visible curriculum path;
- character and unit unlock celebrations;
- meaningful milestones;
- personal bests;
- daily practice goals;
- optional practice streaks;
- mastery tiers, including later proficiency under noise;
- focused review challenges; and
- session completion feedback.

Rules:

- rewards should correlate with skill, time, or meaningful practice;
- a token action must not preserve a streak unless it meets a sensible minimum;
- absence should not cause loss of characters or punitive messaging;
- XP, if introduced, is secondary to accuracy, speed, retention, and time practiced.

---

## 5. CW timing and audio requirements

### 5.1 Timing definitions

For character speed `Wc`:

```text
dit = 1200 / Wc milliseconds
dah = 3 dits
intra-character gap = 1 dit
standard character gap = 3 dits
standard word gap = 7 dits
```

Farnsworth timing keeps element and intra-character timing at `Wc` while extending inter-character and inter-word spacing to produce effective speed `We`, where `We <= Wc`.

Use the standard PARIS-based ARRL Farnsworth distribution (Jon Bloom, KE3Z). The word `PARIS ` is 50 dot-units total: 31 units of character elements plus intra-character gaps, and 19 units of inter-character and word spacing. Keep the 31 character units at `Wc` and stretch only the 19 spacing units to hit `We`:

```text
unit_char (seconds)      = 1.2 / Wc            # dit, dah=3x, intra-character gap = 1 unit_char
unit_farns (seconds)     = (60 / We - 37.2 / Wc) / 19
inter-character gap      = 3 * unit_farns
word gap                 = 7 * unit_farns
intra-character gap      = 1 * unit_char
```

Invariants and tolerance:

- when `We == Wc`, `unit_farns == unit_char`, so timing collapses to standard;
- `unit_farns >= unit_char` for all `We <= Wc`;
- element and intra-character durations never change with `We`; only inter-character and word gaps grow; and
- the timing generator rounds to whole milliseconds; test vectors assert equality within a documented tolerance of +/- 1 ms per boundary.

Implement timing as pure functions that return a schedule. Do not scatter duration calculations through UI code.

### 5.2 Scheduling

Schedule oscillator and gain events against the Web Audio clock rather than relying on `setTimeout` for tone edges. The engine must:

- prevent clicks with short gain ramps/envelopes;
- resume audio only after permitted user interaction on browsers that require it;
- perform a one-time silent unlock on the first user gesture (resume the `AudioContext` and play a zero-gain buffer) so iOS/Safari reliably starts the clock;
- support cancellation without leaving tones playing;
- remain accurate when the UI thread is moderately busy;
- use the same generated schedule for playback and timing tests; and
- correctly produce total 3-unit character and 7-unit word boundaries, without stacking gaps.

Oscillator lifecycle: create a fresh oscillator/gain pair per exercise playback and drive tone edges by scheduling on that exercise's gain node, then stop and discard it at end or on cancellation. Do not keep one long-lived oscillator running across a session and re-arm it, because suspend/resume on mobile can drift or silence a re-armed node. Keeping the graph short-lived also makes cancellation and teardown deterministic. This choice is documented in the audio decision record.

### 5.3 Sending input

Initial inputs:

- keyboard spacebar or configurable key;
- large touch/pointer button with pointer capture; and
- mouse/pointer support.

The keying engine should record raw key-down/key-up monotonic timestamps, derive mark and space durations, decode characters, and preserve the raw timing observations in attempt data.

The keyboard adapter must ignore OS auto-repeat `keydown` events (a held key must produce exactly one key-down/key-up transition) and must emit a clean key-up if the element loses focus, the tab is hidden, or a `blur` occurs mid-press. The pointer adapter must likewise emit a clean key-up on `pointercancel` or when the pointer leaves the button while pressed. No input path may leave a stuck mark.

Future inputs may include USB HID, Bluetooth paddles, MIDI-like devices, or native plugins. Define an input adapter interface now, but implement only the browser inputs required for MVP.

### 5.4 Timing test vectors (golden)

These canonical vectors anchor the timing generator and make the legacy gap-stacking bug unambiguous to fix. All values are milliseconds. Marks are tone-on durations; gaps are silence durations between consecutive marks. Assert equality within +/- 1 ms.

Standard timing, `Wc = We = 20` WPM (`unit_char = 60` ms):

```text
"E"   -> mark 60
"T"   -> mark 180
"A"   -> mark 60, gap 60, mark 180                       # dit, intra-char gap, dah
"AN"  -> mark 60, gap 60, mark 180, gap 180,             # A, then 3-unit inter-character gap
         mark 180, gap 60, mark 60                        # N = dah dit
"A B" -> [A elements], gap 420, [B elements]              # single 7-unit word gap total, NOT 180 + 420
```

The `"A B"` case is the regression guard: total silence between the last element of `A` and the first element of `B` must equal 7 units (420 ms), never a 3-unit character gap plus a 7-unit word gap.

Farnsworth timing, `Wc = 20`, `We = 10` WPM (`unit_char = 60` ms):

```text
unit_farns = (60/10 - 37.2/20) / 19 = 0.217895 s ~= 217.9 ms
intra-character gap = 60.0 ms          # unchanged, at Wc
inter-character gap = 3 * unit_farns ~= 653.7 ms
word gap            = 7 * unit_farns ~= 1525.3 ms
```

---

## 6. Application architecture

### 6.1 Recommended stack

- React;
- TypeScript with strict checking;
- Vite;
- React Router, used to back the four primary destinations in section 9.1 (Learn, Practice, Progress, Settings). Given that navigation set, routing is expected rather than optional; keep the router at the shell boundary and out of core/domain code;
- Web Audio API;
- IndexedDB via a small, well-maintained wrapper such as Dexie, isolated behind repository interfaces;
- a PWA/service-worker integration compatible with Vite;
- Vitest for unit/component tests;
- React Testing Library for interaction tests;
- Playwright for critical end-to-end flows;
- ESLint and Prettier;
- Capacitor added after the PWA/core experience reaches its milestone gate.

Use current stable, mutually compatible package versions at implementation time. Record the chosen Node/package-manager version and commit the lockfile.

### 6.2 Proposed repository structure

```text
k1frx-morse-trainer/
├── src/
│   ├── core/
│   │   ├── morse.ts
│   │   ├── timing.ts
│   │   ├── curriculum.ts
│   │   ├── scheduler.ts
│   │   ├── scoring.ts
│   │   ├── exercises.ts
│   │   └── types.ts
│   ├── audio/
│   │   ├── cw-engine.ts
│   │   ├── noise.ts
│   │   └── audio-session.ts
│   ├── input/
│   │   ├── key-input.ts
│   │   ├── keyboard-key.ts
│   │   └── pointer-key.ts
│   ├── training/
│   │   ├── learn-session.ts
│   │   ├── copy-session.ts
│   │   └── send-session.ts
│   ├── data/
│   │   ├── schema.ts
│   │   ├── repositories.ts
│   │   ├── indexeddb.ts
│   │   ├── migrations.ts
│   │   └── transfer.ts
│   ├── analytics/
│   │   ├── training-time.ts
│   │   ├── mastery.ts
│   │   ├── confusions.ts
│   │   ├── retention.ts
│   │   └── sending-quality.ts
│   ├── content/
│   │   ├── curriculum-data.ts   # ordered Koch sequence + thresholds (static data)
│   │   ├── words.ts
│   │   ├── ham-terms.ts
│   │   └── milestones.ts
│   ├── ui/
│   │   ├── components/
│   │   ├── screens/
│   │   ├── hooks/
│   │   └── theme/
│   ├── App.tsx
│   └── main.tsx
├── public/
├── tests/
├── docs/
├── capacitor.config.ts
├── package.json
└── README.md
```

Exact filenames may change, but dependency direction may not:

```text
UI -> training/application services -> core domain
                              |       -> data interfaces
                              |       -> audio/input interfaces
IndexedDB implements data interfaces
Web Audio implements audio interfaces
React implements the UI
Analytics reads domain records through data interfaces
```

The `core` layer must not import React, IndexedDB, browser DOM APIs, Capacitor, or UI modules.

### 6.3 Event flow

An exercise completion should produce a domain event rather than writing directly to browser storage:

```ts
type AttemptCompleted = {
  type: "attempt.completed";
  attempt: Attempt;
  masteryChanges: MasteryChange[];
  unlockedCharacter?: string;
  milestones?: string[];
};
```

Application services persist events and update projections. The UI consumes current state and emitted outcomes.

### 6.4 Storage strategy

Use:

- `localStorage` only for tiny boot/settings values where appropriate;
- IndexedDB for sessions, attempts, milestones, mastery snapshots, and schema metadata;
- versioned migrations from the first schema;
- JSON export/import of all user-owned data; and
- reset/delete controls with clear confirmation.

No cloud backend is part of MVP. Design stable identifiers and update timestamps so future sync is possible.

---

## 7. Data model

### 7.1 Session

```ts
type TrainingSession = {
  id: string;
  schemaVersion: number;
  startedAt: string;
  endedAt?: string;
  activeMs: number;
  pausedMs: number;
  mode: "learn" | "copy" | "send" | "review" | "assessment";
  charWpm: number;
  effectiveWpm: number;
  toneHz: number;
  noiseLevel: number;
  unlockedAtStart: string[];
  unlockedAtEnd?: string[];
  appVersion: string;
};
```

Active duration must exclude backgrounded time and long idle intervals according to a documented rule. Initial (tunable) rule:

- pause active-time accrual when the page is hidden (`document.visibilitychange` to hidden) or the app is backgrounded, and resume on return;
- exclude any gap greater than 60 s between consecutive user interactions or attempts as idle, counting only up to the idle threshold; and
- a session is only valid for streak/analytics purposes if it accrues at least 30 s of active time and at least one completed attempt.

These thresholds are named configuration values, covered by tests, and may be tuned after real use. Because streaks and "training today" depend on them, they are fixed at Milestone 0 rather than deferred.

### 7.2 Attempt

```ts
type Attempt = {
  id: string;
  sessionId: string;
  occurredAt: string;
  exerciseType:
    | "copy-character"
    | "send-character"
    | "copy-group"
    | "copy-word"
    | "send-word";
  direction: "rx" | "tx";
  target: string;
  answer?: string;
  decoded?: string;
  correct: boolean;
  responseMs?: number;
  reason: SchedulerReason;
  newestCharacter: boolean;
  charWpm: number;
  effectiveWpm: number;
  toneHz: number;
  noiseLevel: number;
  expectedMorse?: string;
  sentMorse?: string;
  keying?: {
    marksMs: number[];
    spacesMs: number[];
    ditEstimateMs?: number;
  };
};
```

Do not retain individual key events indefinitely if a compact marks/spaces representation is sufficient. Document this decision.

### 7.3 Mastery and history

Maintain a materialized current progress view for fast app startup, but keep raw attempts as the source for analytics. Record milestone and unlock timestamps as explicit events because they are meaningful product history.

### 7.4 Import/export

Export format must contain:

- format and schema version;
- exported timestamp;
- app version;
- settings;
- progress projection;
- sessions;
- attempts;
- milestones; and
- an integrity field or validation metadata sufficient to reject malformed imports.

Every persisted record (session, attempt, milestone, mastery snapshot, settings) must carry a stable, globally unique id (documented scheme, e.g. UUIDv4 or ULID) and an `updatedAt` timestamp from the first schema version. This is a hard Milestone 4 requirement, not optional: without stable ids and update timestamps a future safe merge is impossible, and retrofitting them onto already-exported data is lossy.

Import must validate before mutating local data, preview the consequences, and support either replace or safe merge. MVP may ship replace-only if merge semantics are deferred and clearly labeled, but the export format must already satisfy the id/`updatedAt` requirement above so merge can be added later without a format break.

---

## 8. Analytics and metrics

### 8.1 MVP dashboard

Prioritize:

- training today, this week, and all time;
- session count and average session duration;
- practice days, current streak, and longest streak;
- unlocked and mastered characters over time;
- current character and effective WPM;
- RX and TX accuracy trends;
- per-character recent accuracy and response latency;
- most common confusion pairs; and
- recent milestones.

### 8.2 Future metrics enabled by raw data

- retention after 1, 7, and 30 days;
- review effort required to regain mastery;
- recognition-latency trends at comparable WPM;
- accuracy under different noise levels;
- warm-up and fatigue curves within sessions;
- useful session length for the individual;
- actual sending WPM;
- dit/dah ratio;
- mark and spacing consistency;
- timing-quality trends; and
- content-specific performance for callsigns, words, and QSO fragments.

### 8.3 Metric definitions

Each displayed metric needs a written definition. Avoid misleading lifetime averages. Prefer recent windows for actionable mastery and show sample sizes where low counts could create false confidence.

Initial mastery should remain primarily accuracy-based. Capture latency from the beginning, but do not block progression on latency until sufficient real-world data supports a fair threshold.

---

## 9. UX and screens

### 9.1 Primary navigation

- **Learn**: default guided experience.
- **Practice**: copy, send, targeted character, words, callsigns, and later QSO drills.
- **Progress**: dashboard, character detail, history, milestones.
- **Settings**: sound, speed, input, appearance, data export/import/reset.

### 9.2 Learn screen

Show only what the current exercise requires. Essential elements:

- progress within the short session;
- play/replay when appropriate;
- answer input or large key control;
- concise feedback;
- pause/end session;
- accessible sound-onboarding state; and
- an unobtrusive indication of current character/effective speed.

### 9.3 Session summary

At session end show:

- active practice time;
- attempts and recent accuracy;
- character(s) emphasized;
- improvement or issue worth noticing;
- unlocks/milestones;
- one recommended next action.

Avoid overwhelming the learner with every collected statistic.

### 9.4 Visual style

Create an original K1FRX identity. Aim for focused, warm, technical, and playful rather than childish. Do not reproduce Google's or Duolingo's branding. Support responsive phone layouts, landscape use, and desktop keyboard interaction.

---

## 10. Migration to a dedicated repository

### 10.1 Repository plan

Create a dedicated repository, preferably:

`k1frx-radio/morse-trainer`

If the actual GitHub organization or repository naming differs, confirm before creating or pushing. The project should be independently versioned and releasable.

### 10.2 Migration procedure

1. Inspect the existing Jekyll repository and locate all Morse Trainer markup, styles, scripts, corpora, and assets.
2. Capture a behavioral inventory and baseline screenshots on phone and desktop.
3. Add focused characterization tests or a manual baseline checklist for tone timing, copy generation, key decoding, and controls.
4. Scaffold the new React/TypeScript/Vite repository.
5. Move the Morse dictionary and timing math into pure, tested domain modules.
6. Rebuild the Web Audio scheduler behind an interface and verify it against timing schedules.
7. Extract key input/decoding behind input adapters.
8. Port existing free Copy and Send modes with behavioral parity. In the parity table, mark Farnsworth timing as a _new_ capability rather than a port: the prototype runs a single WPM with no Farnsworth spacing, so effective-speed behavior is added, not reproduced.
9. Add persistence and data migration/import paths. If the old prototype has saved state, explicitly decide whether and how to import it.
10. Build Learn mode and its scheduler on the new foundation.
11. Deploy the web/PWA version.
12. Replace the blog's embedded implementation with a concise product page and launch link. Preserve or redirect the existing `/morse-trainer/` URL so bookmarks do not break.
13. Keep the legacy implementation available in version control until parity and migration are accepted; then remove it in a separate, reviewable change.

### 10.3 History and attribution

If practical, preserve useful commit history when extracting the page. At minimum, document the source commit and migration date. Add an attribution/third-party notices file for any reused open-source code or assets.

### 10.4 Deployment

Initial deployment may remain static and use GitHub Pages. Ensure base paths, service-worker scope, asset URLs, and client routing work correctly under both a repository subpath and a future custom domain. Automate lint, typecheck, tests, build, and deployment in CI.

---

## 11. Delivery roadmap and gates

### Milestone 0: Discovery and migration design

**Deliverables**

- Existing behavior inventory.
- Source/asset/license inventory.
- Chosen Koch sequence and documented initial thresholds.
- Architecture decision record covering web-first + PWA + Capacitor.
- Migration and redirect plan for the blog URL.
- Prioritized backlog and explicit non-goals.

**Gate**

- No known prototype behavior is lost accidentally.
- Repository ownership/name and deployment target are confirmed before remote creation or pushes.

### Milestone 1: New repository and tested core

**Deliverables**

- React/TypeScript/Vite application scaffold.
- CI for format/lint/typecheck/unit tests/build.
- Morse mapping, encoding/decoding, timing, Farnsworth calculations, curriculum state, and scheduler interfaces.
- Unit tests with deterministic seeded scheduling.
- Basic responsive shell and navigation.

**Gate**

- Clean install works from the README.
- CI passes from a fresh checkout.
- Core has no React, storage, or browser dependencies.
- Timing test vectors cover characters, adjacent characters, words, and cancellation schedules.

### Milestone 2: Audio, input, and legacy feature parity

**Deliverables**

- Web Audio playback using scheduled audio events.
- Keyboard and pointer straight-key adapters.
- Copy and Send practice matching the useful prototype behavior.
- WPM, effective WPM, tone, volume, and noise settings.
- Mobile and desktop interaction coverage.

**Gate**

- No stuck tones after rapid input, cancellation, navigation, or backgrounding.
- Character and word gaps pass schedule-level tests.
- A human smoke test confirms recognizable, click-free CW.
- Copy and keying flows work in current Chrome/Android and at least one desktop browser.

### Milestone 3: Learn mode MVP

**Deliverables**

- Two-character start and one-at-a-time learner-accepted unlocks.
- RX-only Koch lessons with continuous-copy advancement evidence.
- Separate RX/TX skill tracking.
- Newest/weakest character weighting.
- Character introduction, isolated copy, random-group, eligible-word, and timed
  continuous-copy exercises.
- Immediate feedback and hints.
- Session start, pause, resume, and summary.

**Gate**

- Completed stream evidence produces the expected offer/no-offer outcomes.
- Completing a qualifying stream does not unlock without explicit acceptance.
- One accepted offer unlocks exactly one character, and TX results cannot affect
  the offer.
- Locked characters never appear in generated exercises or eligible words.
- Scheduler distributions meet documented weighting tolerances under seeded simulations.
- A complete first session is usable on a phone without developer assistance.

### Milestone 4: Persistence and analytics MVP

**Deliverables**

- Versioned IndexedDB schema and migrations.
- Sessions, attempts, milestones, mastery projection, and settings persistence.
- Correct active-time tracking.
- Progress dashboard with MVP metrics.
- Export, validated import, and reset.
- Recovery behavior for interrupted sessions and failed writes.

**Gate**

- Refresh/restart preserves progress.
- Migration tests upgrade fixture databases without data loss.
- Export -> clear -> import reproduces progress and metric totals.
- Malformed and future-version imports fail safely without altering current data.
- Analytics calculations match hand-computed fixtures.

### Milestone 4.5: Learn architecture hardening

Begin after the Milestone 4 dashboard, backup, and documentation scope is
complete and before full TX learning work begins. This is a behavior-preserving
maintainability gate for the existing RX Learn experience.

**Deliverables**

- A typed phase catalog with stable IDs and explicit phase contracts for the
  current introduction, acquisition, remediation, contrast, group, word,
  continuous-copy, and summary phases.
- Learn domain events and React orchestration expose phase identity directly;
  ordering and interaction rules are not inferred from labels, target lengths,
  button text, or fixed card counts.
- Semantic Learn test helpers replace brittle full-lesson loop counts while
  preserving direct keyboard, focus, replay, audio, and prompt-token tests.
- Domain, audio, persistence, and advancement boundaries remain explicit and
  independently testable. Existing learning rules, timing, content weighting,
  persistence semantics, and learner-visible behavior remain unchanged.
- Architecture documentation covers phase changes, evidence eligibility,
  versioning, and the future non-curriculum RX content boundary.

**Future RX content constraint**

Generated lessons and generated Practice content may share normalization,
tokenization, timing, playback, optional grading, and aggregate metrics with a
future learner-supplied text source. Imported content must not become a
`LessonPlan` phase or `LearnSessionMode`, affect curriculum progression, or be
persisted in raw or reconstructable form. Document the current whole-schedule
audio model and the future insertion point for bounded scheduling; do not add
file handling or a speculative streaming subsystem in this milestone.

**Gate**

- Current RX Learn and Practice behavior, thresholds, pacing, persistence,
  advancement acceptance, evidence exclusions, and audio cancellation remain
  unchanged.
- Every Learn phase has a stable typed identity and testable contract.
- Full-lesson tests can advance by phase and semantic event without widespread
  fixed-loop assumptions, wall-clock seeds, or random composition dependence.
- No database or scoring-version change is made unless separately reviewed and
  approved as a correctness requirement.
- The full automated verification suite and desktop/mobile Learn smoke checks
  pass, including automatic/manual pacing, type-behind, continuous copy,
  readiness outcomes, persistence gating, interruption, and GitHub Pages
  subpath refresh behavior.

### Milestone 5: PWA, polish, and web release

Milestone 5 begins after the Milestone 4 persistence, recovery, import/export,
and analytics gates pass. It turns the completed web application into the first
normal day-to-day phone distribution. A separate native application is not
required for this milestone: the learner installs the PWA from its production
HTTPS URL and launches it from the home screen in standalone mode.

**Deliverables**

- Automated production deployment to the confirmed HTTPS URL, initially
  suitable for GitHub Pages under `/morse-trainer/` and compatible with a future
  custom-domain root.
- Installable PWA manifest and service worker.
- Original app icons and visual identity, standalone display metadata, theme
  colors, and mobile safe-area handling for Android and iOS home-screen
  installation.
- Useful offline behavior after first load.
- Explicit caching and update strategy: cache the application shell and bundled
  lesson assets, never treat IndexedDB learner data as disposable cache, and
  notify the learner when a new application version is ready.
- Accessibility and responsive-layout pass.
- Real-device mobile validation covering soft-keyboard focus, physical-keyboard
  input where available, Web Audio start/resume, navigation teardown, screen
  locking/backgrounding, and continuous-copy sessions.
- Clear in-app installation guidance for Android/Chrome and iPhone/Safari when
  installation is available but no automatic prompt is exposed.
- Backup/export access before destructive reset and documentation that progress
  is device-local in this milestone; cross-device synchronization remains
  deferred.
- Blog launch page and preserved/redirected legacy URL.
- Production deployment and release notes.

**Gate**

- A learner can open the production URL on a supported phone, install the app
  to the home screen, launch it in standalone mode, and complete a full RX Learn
  session without developer tools or a development server.
- Install prompt criteria are satisfied where supported.
- Core lessons work offline after installation/first successful load.
- No data loss across service-worker updates.
- Progress survives app close/reopen and production application updates;
  export/import remains functional from the installed PWA.
- Keyboard-only and touch-only critical flows work.
- A real Android/Chrome installation pass is required. An iPhone/Safari
  Add-to-Home-Screen pass is required when that hardware is available; otherwise
  it remains an explicitly reported manual verification item.
- Lighthouse/accessibility checks show no critical failures; document numeric baseline rather than chasing a vanity score.

### Milestone 6: Capacitor feasibility and Android alpha

**Deliverables**

- Capacitor configuration using the production web build.
- Android project and internal/debug build.
- Native lifecycle/audio/storage smoke tests.
- Documented iOS path without requiring iOS release in this milestone.

**Gate**

- The same progress model and training engine run without forks.
- App resume/background transitions do not produce stuck audio or inflated session time.
- Export/import works in the native shell or has a documented platform-specific adapter.

---

## 12. Test strategy

### 12.1 Unit tests

Cover at minimum:

- complete Morse map round trips;
- unsupported input handling;
- standard and Farnsworth timing vectors;
- exact inter-element, character, and word gaps;
- curriculum unlock thresholds and minimum-sample rules;
- latest-stream advancement thresholds, active-set coverage, and explicit
  one-character acceptance;
- never relocking characters;
- separate RX/TX progression;
- rolling-window calculations;
- word eligibility from unlocked character sets;
- scheduler weighting and reason codes;
- confusion-pair aggregation;
- streak/date boundary behavior;
- active-time computation;
- sending timing metrics; and
- schema migrations and import validation.

Use fake clocks where time affects behavior and seeded randomness wherever selection is probabilistic.

### 12.2 Component/integration tests

- audio permission/onboarding state;
- answer entry and feedback;
- keyboard/touch key state;
- pause/resume/end session;
- settings persistence;
- unlock celebration;
- export/import/reset confirmation;
- empty, new-user, returning-user, and corrupted-data states.

Mock the audio output boundary but integration-test the schedule passed to it.

### 12.3 End-to-end tests

Critical flows:

1. New user completes onboarding and first lesson.
2. Seeded user completes a qualifying stream, receives an offer, and explicitly
   unlocks one character.
3. User makes a confusion error and sees it represented in progress.
4. User performs sending practice with keyboard and pointer.
5. User closes/reopens and resumes with preserved data.
6. User exports, resets, and restores data.
7. Installed/offline app completes a cached lesson.

### 12.4 Manual audio QA

Automated schedule tests cannot prove perceptual quality. Maintain a short manual checklist using headphones and phone speakers:

- correct pitch and comfortable envelope;
- no clicks;
- no clipped first element;
- correct relative spacing;
- cancellation and rapid replay;
- volume/noise balance;
- background/foreground transitions.

### 12.5 Performance and durability

- App remains responsive with at least 100,000 attempts in a generated local database.
- Dashboard queries complete within an agreed interactive budget on a representative mid-range phone.
- Long histories do not require loading every attempt into React state.
- Storage failures surface a recoverable warning.

---

## 13. Success metrics

### 13.1 Engineering acceptance metrics

- 100% of CI checks pass on the release commit.
- Zero known critical defects in session persistence, progression, or audio cancellation.
- Export/import round trip preserves all supported records in test fixtures.
- Every displayed metric has a tested definition.
- All stochastic core tests are deterministic.
- No locked character appears across at least 10,000 seeded scheduler selections.
- Koch advancement offers and explicit one-character unlock behavior match the
  documented rules across boundary test cases.
- Critical E2E flows pass on desktop and mobile-sized viewports.

### 13.2 Product validation metrics

For early self-testing/beta use, measure:

- percentage of users who can start their first audible exercise without help;
- first-session completion rate;
- median time from launch to first exercise;
- sessions completed without audio/input failure;
- return practice within 7 days;
- cumulative active practice time;
- characters unlocked/mastered over time;
- RX accuracy and latency trends at comparable settings;
- TX pattern accuracy and later timing quality; and
- explicit feedback on whether the next exercise feels appropriately difficult.

Do not add third-party analytics to MVP merely to obtain these metrics. The app's own private local history should support product evaluation during early testing; any future telemetry requires explicit privacy design and user consent.

### 13.3 Learning success hypothesis

The primary hypothesis is that a learner using short adaptive sessions will progressively recognize more characters at 20 WPM character speed while effective WPM increases and recognition latency falls, without depending on visible dot/dash translation.

This is a hypothesis, not yet a proven claim. Retain data needed to evaluate it.

---

## 14. Scope boundaries

### MVP includes

- dedicated repository;
- web/PWA application;
- extracted and corrected CW audio/keying primitives;
- Koch/Farnsworth Learn mode;
- Copy and Send practice;
- local persistence;
- core analytics;
- export/import;
- original responsive UI; and
- deployment/migration from the blog page.

### Deferred unless needed for MVP quality

- accounts and cloud sync;
- social leaderboards;
- subscriptions or payments;
- iOS/Android store submission;
- physical paddle hardware support;
- microphone decoding;
- advanced propagation/noise simulations;
- localization;
- instructor/classroom features;
- opaque ML-based adaptation; and
- broad backend telemetry.

Capacitor Android alpha is a post-web-MVP milestone, not a reason to delay the PWA.

---

## 15. Risks and mitigations

| Risk                                        | Mitigation                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Browser audio restrictions or timing errors | Explicit audio onboarding; Web Audio clock scheduling; schedule-level tests; device QA           |
| Overcomplicated adaptive algorithm          | Start with named, explainable weights and reason codes; tune using simulations and real practice |
| Gamification distorts learning              | Tie rewards to meaningful practice and skill; keep progression grounded in RX performance        |
| Local-only data is lost                     | Early export/import; transactional writes; migrations; clear backup affordance                   |
| IndexedDB history becomes slow              | Indexed fields, aggregation queries, materialized projections, generated large-dataset tests     |
| Mobile shell behaves differently            | Keep platform boundaries behind adapters; add Capacitor only after web core stabilizes           |
| Copied visual assets create rights issues   | Prefer original assets; audit all reused material; preserve required license notices             |
| Scope expands before a usable trainer ships | Enforce milestone gates and deferred list; always leave a runnable vertical slice                |
| Old URL/bookmarks break                     | Preserve `/morse-trainer/` via hosted app or redirect and test it in production                  |
| Service-worker update loses or strands data | IndexedDB migration tests, backward-compatible releases, safe update UI                          |

---

## 16. Decisions requiring confirmation during implementation

The agent should propose a recommendation and pause only if the choice is irreversible or materially affects user intent:

1. Final repository owner/name and permission to create/push it.
2. Final public product name and package/application identifiers.
3. Initial Koch character order.
4. Whether Google mnemonic images are excluded entirely or separately licensed/attributed for use.
5. Whether the existing URL will host the built app directly or redirect to a new subdomain.
6. Whether any existing browser state from the prototype needs migration.
7. First Android application ID and signing/release ownership, when that milestone begins.

Do not block early local development on branding or app-store decisions.

---

# 17. Copy-paste implementation prompt for a coding agent

Use the prompt below to begin implementation. Provide this entire document to the agent as context.

```text
You are the lead implementation agent for K1FRX Morse Trainer. Build the product described in the attached project plan. Treat that plan as the product and architecture specification, and keep it current when an implementation decision changes it.

MISSION

Turn the existing Morse Trainer prototype embedded in the K1FRX Radio Jekyll site into a dedicated, maintainable, web-first application. The product must teach genuine auditory CW using Koch-style progression, Farnsworth timing, adaptive practice, separate RX/TX mastery, raw session history, useful analytics, and skill-based gamification. It must ship first as a static web app/installable PWA and remain suitable for a later Capacitor Android/iOS wrapper.

WORKING STYLE

- Inspect before editing. Find the existing Jekyll implementation, repository instructions, dirty worktree state, deployment setup, and all related assets.
- Do not overwrite unrelated user changes.
- Before any remote repository creation, push, public deployment, redirect, or deletion of the legacy page, confirm the exact target and authorization if they are not already explicit.
- Work milestone by milestone. At the end of every milestone, leave the project runnable and all completed checks passing.
- Prefer small commits organized by coherent behavior. Do not mix migration, formatting, and feature work unnecessarily.
- Keep a decision log in docs/decisions/ for consequential architecture choices.
- Maintain a short STATUS.md with completed work, current milestone, known issues, and exact next steps.
- When blocked, state the evidence, impact, and smallest decision needed. Continue independent work that is not blocked.
- Do not claim that audio quality or mobile behavior works unless it has been tested at the appropriate level.

NON-NEGOTIABLE ARCHITECTURE

- React + strict TypeScript + Vite.
- Pure domain modules for Morse data, timing, curriculum, scoring, exercise generation, and adaptive scheduling.
- Domain/core code must not import React, IndexedDB, DOM APIs, Capacitor, or UI modules.
- Web Audio is an adapter. Schedule tone/gain changes against AudioContext time; do not use ordinary timers for tone edges.
- Keyboard/touch keying is behind an input adapter.
- Persistence is behind repository interfaces. IndexedDB is the initial implementation.
- Training engine emits results/events; it does not write storage directly.
- Raw sessions and attempts are retained; dashboards derive metrics or use reproducible projections.
- All schema changes are versioned and migrated.
- Randomized scheduling accepts a seeded RNG for deterministic tests.
- Scheduler selections return reason codes.
- The app must work under a GitHub Pages subpath and be configurable for a future custom domain.

PHASE 0: DISCOVERY

1. Locate and read all repository-level instructions.
2. Locate the current Morse Trainer source and deployment configuration.
3. Run the existing app locally if practical.
4. Inventory behavior, settings, assets, corpora, local persistence, dependencies, and known defects.
5. Capture baseline screenshots for phone and desktop sizes.
6. Review Google's open-source Morse trainer only for the progression, word-selection, hint, and content ideas cited in the plan. Record reused code/assets and their licenses. Do not clone its old Phaser application or branding.
7. Write:
   - docs/legacy-behavior.md
   - docs/architecture.md
   - docs/migration.md
   - docs/decisions/0001-web-first-pwa-capacitor.md
8. Propose the initial Koch sequence and precise progression constants, with rationale.

CHECKPOINT 0

Report the inventory, proposed constants, unresolved decisions, and any mismatch between the actual prototype and this plan. Do not create a remote repository or change production at this checkpoint without authorization.

PHASE 1: REPOSITORY AND PURE CORE

1. Scaffold the new application in a dedicated local directory/repository.
2. Configure Node/package-manager version, strict TypeScript, linting, formatting, Vitest, React Testing Library, Playwright, and CI.
3. Implement complete supported Morse mappings and pure encode/decode functions.
4. Implement standard and Farnsworth timing as pure schedule generation.
5. Implement curriculum state, rolling performance windows, separate RX/TX progress, advancement evidence and acceptance rules, and `needsReview` behavior.
6. Define typed exercise, session, attempt, mastery, milestone, and domain-event models.
7. Define the scheduler API, seeded RNG injection, weights, and reason codes. Implement only enough scheduling for unit validation at this phase.
8. Add a minimal responsive application shell.

REQUIRED PHASE 1 TESTS

- Mapping round trips for every supported character.
- Unsupported-character behavior.
- Exact timing vectors for E, T, A, multi-character text, and multiword text.
- Verify word gaps total seven units at standard timing, not character gap plus seven.
- Farnsworth invariants: element timing remains at character speed; added spacing produces the requested effective rate within documented rounding tolerance.
- Advancement offer/no-offer and explicit-acceptance boundary cases.
- Minimum observations for the newest character.
- RX advancement independence from TX performance.
- Never relock an unlocked character.
- Seeded scheduler reproducibility.

CHECKPOINT 1

Run format, lint, typecheck, unit tests, and production build. Report exact commands and results. Show the dependency graph and verify core has no forbidden imports.

PHASE 2: AUDIO, INPUT, AND PROTOTYPE PARITY

1. Implement a Web Audio adapter consuming the pure timing schedule.
2. Use oscillator/gain scheduling and a short anti-click envelope.
3. Implement cancellation, replay, browser audio resume, and safe teardown.
4. Implement keyboard and pointer/touch straight-key adapters using monotonic timestamps and pointer capture.
5. Implement decoding and preserve mark/space durations.
6. Port the useful Copy and Send practice behaviors from the prototype.
7. Add character WPM, effective WPM, tone, volume, and noise settings.
8. Correct any discovered gap-calculation bug rather than reproducing it.

REQUIRED PHASE 2 CHECKS

- No stuck tone after cancellation, rapid replay, route change, pointer cancellation, tab backgrounding, or component unmount.
- Keyboard key repeat does not generate false transitions.
- Pointer leaving the button while pressed still produces a clean key-up.
- Schedule tests prove exact logical timing.
- Manual headphones and phone-speaker smoke tests confirm click-free recognizable output.
- Copy and Send work at phone and desktop viewport sizes.

CHECKPOINT 2

Provide a parity table: legacy behavior, new behavior, test coverage, and intentional changes. Include remaining manual audio risks.

PHASE 3: LEARN MODE VERTICAL SLICE

1. Implement first-run audio/input onboarding.
2. Start with two Koch characters and introduce one at a time.
3. Implement character introduction, isolated RX identification, random-group,
   eligible-word, and timed continuous-copy exercises. Keep TX prompts in
   Practice, not Learn.
4. Implement adaptive weighting toward newest, weak, confused, and overdue characters.
5. Ensure only unlocked characters appear.
6. Implement concise error correction and progressive hints.
7. Implement sessions with start, active time, pause/resume/end, and summary.
8. Add original, simple visual progression and unlock celebration. Do not copy Google or Duolingo branding.

REQUIRED PHASE 3 TESTS

- Qualifying latest-stream evidence offers exactly one expected next character.
- Below-threshold, undersampled, abandoned, incomplete-coverage, or unresolved-review evidence does not produce an offer.
- Completing a qualifying stream does not unlock until explicit acceptance, and repeated acceptance cannot unlock a second character.
- TX weakness may change TX Practice frequency but never affects RX advancement.
- Word candidates contain only unlocked characters and can be forced to contain the newest character.
- Over 10,000 seeded selections, no locked character appears.
- Scheduler distributions fall within documented tolerances for each weighting scenario.
- The first-session E2E flow completes on a mobile viewport.

CHECKPOINT 3

Demonstrate one complete first-user session and one seeded qualifying-stream
session with both **Practice these characters again** and explicit
**Learn {nextCharacter}** paths. Report any threshold tuning suggested by actual
use, but do not silently change the learning rules.

PHASE 4: PERSISTENCE AND ANALYTICS

1. Implement a versioned IndexedDB schema behind repository interfaces.
2. Persist sessions, attempts, milestones, mastery projections, and settings transactionally.
3. Define active time so background/idle time is excluded consistently.
4. Handle interrupted sessions and recoverable write failures.
5. Implement the MVP Progress dashboard:
   - today/week/all-time active practice;
   - sessions and average duration;
   - practice days and streaks;
   - unlocked/mastered characters over time;
   - effective WPM trend;
   - RX/TX accuracy trends;
   - per-character recent accuracy and latency;
   - confusion pairs;
   - milestones.
6. Implement versioned JSON export, validation, replace import, and reset. Add merge import only if semantics are fully specified and tested.
7. Ensure dashboard queries do not load the full attempt history into React state.

REQUIRED PHASE 4 TESTS

- Database creation and every migration path from fixtures.
- Persistence across reload/restart.
- Interrupted session recovery.
- Exact metric results from hand-calculated fixtures.
- Time-zone/date-boundary and streak cases.
- Export -> clear -> import produces equivalent records and metrics.
- Malformed, incompatible, or future-version imports cause no mutation.
- Generated 100,000-attempt dataset remains usable within a documented budget on the available test environment.

CHECKPOINT 4

Publish a data dictionary and metric definitions in docs/data-model.md and docs/metrics.md. Report database size and representative dashboard-query timings for the generated dataset.

PHASE 5: PWA, ACCESSIBILITY, AND WEB RELEASE

Begin only after the Milestone 4 persistence, recovery, analytics, and
backup/restore gates pass. The release target is an installable phone experience
from the production HTTPS URL, not merely a responsive page running from a
development server.

1. Add manifest, original icons, standalone display metadata, service worker,
   offline shell, and cached bundled lesson assets.
2. Define cache ownership explicitly: service-worker updates may replace app
   assets but must never clear or overwrite IndexedDB learner data.
3. Provide an update-ready notification and a controlled activation/reload path.
4. Add installation guidance for Android/Chrome and iPhone/Safari, including
   Add to Home Screen where an automatic prompt is unavailable.
5. Protect user data across app/service-worker updates and keep export/import
   reachable from the installed PWA. State clearly that cross-device sync is not
   included in this milestone.
6. Audit keyboard navigation, focus, labels, contrast, reduced motion, touch
   target size, safe areas, and screen-reader announcements for exercise
   feedback.
7. Add production-safe error boundaries and recovery UI.
8. Add an automated production deployment and verify operation under the
   intended GitHub Pages base path and a root-path preview.
9. Perform real-device checks for soft-keyboard persistence, supported physical
   keyboards, audio start/resume, navigation teardown, background/screen-lock
   behavior, and a complete continuous-copy lesson.
10. Prepare the blog launch page and redirect/preservation strategy for
    `/morse-trainer/`.
11. Create release notes and a rollback plan.

REQUIRED PHASE 5 CHECKS

- Fresh online load and subsequent offline lesson.
- Installability and standalone launch where the browser supports it.
- Update from a previous cached version without loss of IndexedDB data.
- Progress and settings survive closing and reopening the installed PWA.
- Keyboard-only and touch-only completion of critical flows.
- Complete RX Learn session on an installed Android/Chrome PWA without developer
  tools or a development server.
- iPhone/Safari Add-to-Home-Screen pass when hardware is available, otherwise
  report it explicitly as pending manual verification.
- Current Chrome/Android and at least one desktop-browser smoke tests.
- No critical accessibility findings in automated checks; document manual coverage and limitations.

CHECKPOINT 5

Do not change production or delete the legacy implementation without explicit authorization. Present the release candidate URL/build, migration effects, redirect plan, and rollback procedure.

PHASE 6: CAPACITOR AND ANDROID ALPHA

Begin only after the web MVP is accepted.

1. Add Capacitor without forking core or React feature code.
2. Create the Android project and a debug/internal build.
3. Add platform adapters only where required for lifecycle, files, or sharing.
4. Test background/resume audio, active-time accuracy, persistence, import/export, and safe-area/layout behavior.
5. Document iOS prerequisites and remaining work; do not claim an iOS build without testing it.

DEFINITION OF DONE FOR THE INITIAL PRODUCT

- A user can install or open the web app, complete an audible guided RX Koch lesson, return later with progress intact, practice copying and sending, receive an advancement offer from a qualifying latest continuous-copy stream, explicitly unlock one character, and inspect meaningful progress.
- The app records valid sessions and raw attempts without inflating active time.
- The scheduler never presents locked characters and is deterministic in tests.
- Timing calculations and word boundaries are correct.
- Data can be exported and restored safely.
- CI passes on a clean checkout.
- The application is responsive and accessible on representative phone and desktop use.
- Deployment and migration preserve the old public entry point.
- Documentation is sufficient for a new contributor to install, test, build, deploy, understand the learning rules, and evolve the schema.

FUTURE-GROWTH CONSIDERATIONS TO PRESERVE, NOT BUILD YET

- Optional account/cloud sync with conflict resolution.
- Native Android/iOS distribution.
- USB HID/Bluetooth paddle adapters.
- Iambic keyer support.
- Better sending-quality analysis and individualized dit estimation.
- Noise, fading, QRM, QRN, and weak-signal progression.
- Callsign/QSO curricula and simulated contacts.
- Localization and alternative curricula.
- Privacy-preserving opt-in product telemetry.
- Instructor/classroom modes.

When a future need conflicts with MVP simplicity, preserve a clean interface and record the decision; do not build speculative infrastructure.
```

---

## 18. Handoff checklist

Before giving this plan to the implementation agent, provide or confirm:

- access/path to the current K1FRX Radio Jekyll repository;
- desired GitHub repository owner and exact new repository name;
- whether the agent may create the remote repository and push branches;
- preferred package manager, if any;
- intended initial deployment URL;
- whether current prototype browser progress exists and matters;
- whether visual branding/assets already exist; and
- devices/browsers available for manual audio testing.

If these are unknown, the agent can complete local discovery and architecture work first, then request only the decisions needed for remote or production actions.
