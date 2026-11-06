# First-Contact CW Curriculum Proposal

This document fulfills roadmap issue #87 by defining a staged progression from
character recognition to realistic first-contact CW exchanges and by splitting
that direction into bounded implementation issues.

## Goals

- Preserve current Learn invariants: RX-only advancement authority, explicit
  advancement acceptance, and no unlocks from Practice.
- Increase authenticity gradually, moving from clean-copy drills to realistic
  exchange material.
- Keep work independent of branding and visual identity decisions.
- Provide implementation slices that are small enough to ship and validate
  independently.

## Boundaries

- Learn remains the unlock authority.
- Practice/operating-prep reinforces skill and measures readiness, but does not
  directly unlock characters.
- This proposal defines curriculum/content progression and domain contracts, not
  broad UI redesign.
- Ham utilities (logging, spotting, propagation dashboards, callsign lookup)
  remain out of scope.

## Staged progression

The learner journey should progress through the following stages:

1. Character recognition and short groups.
2. Focused words and continuous copy.
3. Staged on-air vocabulary and abbreviations.
4. Staged callsign recognition.
5. Learner-specific station material (callsign, name, QTH).
6. Structured exchange-element drills.
7. Full simulated QSO flow.
8. Layered realism modifiers (QSB/QRN-like effects, timing/pitch variation)
   after clean-copy proficiency.

Each stage should gate difficulty based on existing readiness signals (for
example, speed-band and recent proficiency evidence) so learners do not jump
from random groups directly into full noisy QSO simulations.

## Outstanding design-contract decisions (deferred to #95)

This proposal establishes direction and candidate sequencing, but the following
product/domain decisions are intentionally not finalized in #87 and must be
resolved in #95 before implementation work proceeds:

- exact ownership boundaries between Learn, Practice, and operating-prep
  surfaces.
- stage entry/completion criteria and the concrete progression contract.
- speed-band/proficiency gate rules per stage.
- grading model choices by stage (exact transcription vs field-capture vs
  comprehension-oriented scoring).
- persistence and analytics contracts for operating-prep outcomes.

#95 is a design-contract phase, not curriculum feature implementation.

## Proposed issue slices

### 1. #95 - Define operating-prep progression contract and stage gates

Role:
Foundational product/domain contract that clarifies stage ownership,
Learn/Practice/operating-prep boundaries, and entry/completion criteria.

Why first:
All later slices depend on shared stage definitions, grading semantics, and
persistence boundaries.

Design-phase note:
#95 resolves the outstanding contract decisions listed above; it does not
implement callsign/vocabulary/QSO features.

### 2. #96 - Add staged on-air vocabulary tracks for RX training

Role:
Build staged vocabulary sets and selectors for authentic on-air terms.

Why early:
Provides reusable content inputs for callsign, exchange-element, and full-QSO
stages.

### 3. #97 - Add realistic callsign curriculum progression

Role:
Introduce staged callsign complexity from simple to realistic variants.

Why here:
Callsign handling is central to first contact and should mature before
structured exchange drills.

### 4. #98 - Add learner station profile for self-relevant CW practice

Role:
Add minimal profile fields (callsign, name, QTH, optional hints) and
persistence so drills can use learner-specific content.

Why here:
Structured exchange drills and simulations should practice realistic personal
material instead of generic placeholders.

### 5. #99 - Implement structured QSO element drills with field-based grading

Role:
Introduce drill templates for exchange components and grade critical-field
capture, not only strict full-string match.

Why here:
Bridges the gap between token/phrase copy and complete conversation flow.

### 6. #100 - Implement complete simulated CW QSO practice sessions

Role:
Combine callsigns, station info, and exchange flow into complete first-contact
rehearsal scenarios.

Why here:
Depends on the content and grading primitives from earlier slices.

### 7. #101 - Add layered realism modifiers for operating-prep copy

Role:
Add staged reception realism after baseline scenario proficiency is in place.

Why last:
Realism multipliers should increase challenge after learners can complete clean
scenario flows.

## Prioritization rationale

Priority order balances learning value, implementation complexity, and
dependency flow:

1. #95 (high dependency, moderate complexity, high leverage)
2. #96 (high content leverage, low/moderate complexity)
3. #97 (high first-contact value, moderate complexity)
4. #98 (high realism value, moderate complexity)
5. #99 (high learning value, moderate/high complexity)
6. #100 (highest authenticity value, high complexity)
7. #101 (important realism layer, moderate/high complexity, intentionally last)

## Acceptance mapping from #87

- End-to-end progression documented: yes (stages above).
- Learn/Practice/operating-prep boundary explicit: partially. High-level
  boundary intent is documented, but concrete ownership contracts are deferred
  to #95.
- Initial authentic-content scope defined: yes (#96, #97, #99).
- Learner-specific station information defined: yes (#98).
- Realism dimensions staged: yes (#101 after #100).
- Follow-up work split into bounded issues: yes (#95-#101).
- Enough direction for #80/#81 redesigns: partially. The sequence and
  curriculum direction are defined; detailed stage contracts still require #95
  before screen-specific redesigns consume the model.
