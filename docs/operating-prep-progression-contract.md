# Operating-Prep Progression Contract

This document completes issue #95 by defining the product and domain contract
for first-contact operating preparation.

Scope:

- design and documentation only
- no implementation of #96-#101 in this issue
- no change to Learn advancement thresholds or unlock semantics
- no branding or visual redesign work

## 1. Ownership boundaries

## Learn (existing unlock authority)

Responsibilities:

- unlock progression through the existing RX lesson model
- evaluate advancement only from latest completed continuous-copy evidence
- require explicit learner acceptance for unlock/completion transitions

Hard constraint:

- Learn is the sole character-unlock authority.

## Practice (existing skill reinforcement)

Responsibilities:

- reinforce RX/TX skill through copy/send/imported-text practice
- persist attempts and active time for analytics and history

Hard constraints:

- Practice cannot unlock characters.
- Practice cannot clear Learn review/advancement gating by itself.

## Operating-prep (new contract surface)

Responsibilities:

- rehearse authentic first-contact content (vocabulary, callsigns, exchange
  elements, full QSO flow, realism layers)
- produce readiness analytics for operating confidence

Hard constraints:

- operating-prep has no direct unlock path
- operating-prep never writes progression events that change curriculum state
- any operating-prep readiness indicator is advisory and separate from
  curriculum unlock state

## 2. Stage model and progression gates

The operating-prep track is a staged readiness model layered on top of existing
Learn progression. Stages are sequential for readiness reporting, but they do
not replace Learn progression.

Terminology:

- current band: the learner's normalized `charWpmBand`
- valid session: source-aware valid session under existing session-validity
  policy
- exact copy accuracy: session/window exact-match rate, where each graded
  transcription attempt contributes `1` when
  `normalizedTarget === normalizedResponse` and `0` otherwise; denominator is
  the count of graded transcription attempts in scope
- aligned character accuracy: `alignedCorrect / targetCharacters`

## Stage contract

| Stage ID | Stage name                   | Entry criteria                                                                                                      | Completion criteria                                                                                                  | Primary evidence                                | Notes                                                |
| -------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| OP-0     | Learn readiness baseline     | Latest Learn continuous-copy assessment is `READY` or `COMPLETE` at current band; no unresolved Learn `needsReview` | Satisfied when entry is met (baseline checkpoint)                                                                    | Learn advancement assessment + curriculum state | Reuses existing unlock/readiness semantics unchanged |
| OP-1     | On-air vocabulary RX         | OP-0 complete                                                                                                       | Last 2 OP-1 sessions both valid, each with exact copy accuracy >= 0.90 and aligned character accuracy >= 0.92        | OP vocabulary attempts/sessions                 | Feeds #96                                            |
| OP-2     | Callsign RX                  | OP-1 complete                                                                                                       | Last 2 OP-2 sessions valid, each with exact copy accuracy >= 0.88 and callsign-field accuracy >= 0.92                | OP callsign attempts with field-level scoring   | Feeds #97                                            |
| OP-3     | Structured exchange elements | OP-2 complete; learner profile available or fallback profile active                                                 | Last 3 OP-3 sessions valid; critical-field capture >= 0.90 for required fields; exact copy accuracy >= 0.85          | OP structured-exchange attempts                 | Feeds #98 and #99                                    |
| OP-4     | Full simulated QSO flow      | OP-3 complete                                                                                                       | Last 3 OP-4 sessions valid; scenario completion >= 0.80; critical-field capture >= 0.90; comprehension score >= 0.80 | OP scenario sessions                            | Feeds #100                                           |
| OP-5     | Realism-conditioned copy     | OP-4 complete                                                                                                       | For each enabled realism tier, 2 valid sessions with critical-field capture >= 0.85 and comprehension score >= 0.75  | OP realism-tier sessions                        | Feeds #101                                           |

Stage-window interpretation:

- "Last N sessions" means the most recent N valid sessions for that exact
  stage within the same `charWpmBand`.
- Unless explicitly stated otherwise, every session in the window must satisfy
  every threshold listed for the stage.
- A session that misses any required threshold causes the stage to remain
  incomplete; qualification requires a fresh trailing window where all sessions
  satisfy the criteria.

## Gate semantics

- Gates are evaluated within current `charWpmBand`.
- Stage qualification is tracked per stage and per `charWpmBand`.
- If `charWpmBand` changes, prior-band OP completion remains historical evidence
  only and does not count as current-band qualification.
- After a band change, the active stage enters provisional status in the new
  band and must satisfy its full stage completion criteria at that band to
  restore qualification.
- One valid new-band session can establish baseline evidence for the active
  stage, but it cannot by itself override stage requirements that call for
  two/three qualifying sessions.
- Earlier stages do not require full re-qualification unless later policy says
  otherwise; the active stage gate is the normative resume point after a band
  change.
- Provisional OP status does not alter Learn unlock state.

## 3. Grading contract by stage

Grading modes are additive; later stages use earlier signals plus stage-specific
signals.

## A. Character accuracy (all OP stages)

- Based on existing alignment observations (`match/substitution/deletion/insertion`).
- Metric: aligned character accuracy.
- Use existing normalization rules (uppercase, whitespace-insensitive).

## B. Exact transcription (OP-1 through OP-4)

- Metric: exact copy accuracy (`normalizedTarget === normalizedResponse`).
- Session exact-copy accuracy = exact matches / graded transcription attempts in
  the session.
- Window exact-copy accuracy (when needed for analytics) = exact matches /
  graded transcription attempts across the stage window.
- Sessions with zero graded transcription attempts are invalid for OP-stage
  completion and do not satisfy window requirements.
- Purpose: preserve disciplined copy quality before heavy realism.

## C. Critical-field capture (OP-2 through OP-5)

- Content is parsed into required and optional fields per drill/scenario
  template.
- Required fields must meet stage thresholds regardless of optional fields.
- Initial required-field sets:
  - OP-2: prefix, numeral, suffix for callsigns
  - OP-3: callsign, RST, name, QTH
  - OP-4/OP-5: scenario-specific required exchange items

Field-scoring rule:

- field capture score = required fields captured correctly / required fields
- For OP-3/OP-4 completion windows, each qualifying session must meet the
  critical-field threshold using that session's own required fields.
- Missing required fields count as uncaptured fields.

## D. QSO comprehension (OP-4 and OP-5)

- Scenario-level intent scoring independent of exact text.
- Comprehension covers whether the learner extracted exchange meaning and flow
  outcomes (for example: station identity, report exchange completion,
  acknowledgment, close).
- comprehension score = completed required scenario intents / required intents
- For OP-4/OP-5 completion windows, each qualifying session must meet the
  comprehension threshold for its scenario template.

## 4. Persistence contract

Operating-prep data must remain analytically useful while isolated from
curriculum progression authority.

## Session layer

- Add a dedicated session source for operating-prep (separate from Learn and
  existing Practice sources).
- Persist stage identity (`opStage`) and scenario/template identity when
  applicable.
- Preserve existing active-time and validity semantics.

## Attempt layer

- Reuse existing normalized target/response and alignment model.
- Add grading metadata:
  - `gradingMode`: `character` | `exact` | `field-capture` | `comprehension`
  - `requiredFieldResults` (for OP-2+)
  - `scenarioIntentResults` (for OP-4+)
  - `realismTier` (for OP-5)

## Progression safety

- Operating-prep commits must be forbidden from including curriculum,
  introductions, progression events, or advancement payloads.
- Learn advancement evaluators must ignore operating-prep attempts.

## 5. Analytics contract

Operating-prep analytics are separate from unlock progression and are designed
for readiness visibility.

Required projections:

- stage completion status per `charWpmBand`
- recent exact copy accuracy by stage
- recent critical-field capture by stage/template
- recent comprehension score by scenario
- realism-tier performance trend (OP-5)

Constraints:

- no new unlock metric derived from operating-prep data
- no mutation of curriculum state from operating-prep analytics

## 6. Dependency mapping to #96-#101

- #96 vocabulary tracks implement OP-1 content sets and exact-copy grading.
- #97 callsign progression implements OP-2 templates and field-capture rules.
- #98 learner profile provides OP-3/OP-4 data inputs (callsign/name/QTH).
- #99 structured drills implement OP-3 required-field scoring.
- #100 full simulated QSO sessions implement OP-4 scenario/comprehension logic.
- #101 realism modifiers implement OP-5 tiered conditioning and thresholds.

## 7. Support for future #80/#81 redesigns

This contract gives Learn/Practice redesign work stable product rules:

- Learn UI stays unlock-authoritative and separate from operating-prep readiness.
- Practice UI can host operating-prep entry points without implying unlock side
  effects.
- Screen flows can render stage gates/status with deterministic criteria rather
  than inferred copy.
- Grading output types are defined ahead of visual design, so #80/#81 can focus
  interaction design instead of re-defining domain behavior.

## 8. Acceptance checklist for issue #95

- documented non-overlapping Learn/Practice/operating-prep boundaries
- concrete stage entry/completion/gating criteria
- explicit grading rules for character/exact/field/comprehension modes
- persistence and analytics requirements that avoid competing progression
- dependency contract for #96-#101 and UI redesign consumers (#80/#81)
