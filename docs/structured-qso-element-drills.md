# Structured QSO Element Drills (#99)

This document defines the OP-3 structured exchange drills and required-field
scoring used by issue #99.

## Drill sequence

Review-mode operating-prep runs these templates before continuous copy:

1. `op3-callsign-rst` (Callsign + report)
2. `op3-name-qth` (Name + QTH)
3. `op3-structured-exchange` (combined callsign/RST/name/QTH with optional WX)

Templates are deterministic for a fixed RNG seed.

## Required vs optional fields

- Required fields are scored for OP-3 completion evidence.
- Optional fields are recorded for visibility but do not reduce required-field
  capture score.

Current field requirements by template:

- `op3-callsign-rst`: required `callsign`, `rst`
- `op3-name-qth`: required `name`, `qth`
- `op3-structured-exchange`: required `callsign`, `rst`, `name`, `qth`; optional `wx`

## Scoring model

Each drill produces two independent outcomes:

- Exact copy match: normalized prompt equals normalized response.
- Required-field capture: captured required fields / required field count.

This separation allows analytics to distinguish near-complete field extraction
from strict full-string correctness.

## Data contract

Attempt persistence stores:

- `exactCopyMatched`
- `fieldCapture` metadata (template id, required counts, score, per-field results)

These records preserve compatibility with existing Learn advancement semantics:

- No change to unlock authority.
- No direct operating-prep unlock path.
