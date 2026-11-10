# Structured QSO Element Drills (#99)

This document defines the OP-3 structured exchange drills and required-field
scoring used by issue #99.

## Drill sequence

Operating-prep runs these templates in a separate session that ends after the
third drill:

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
- Source `operating-prep` and stage `OP-3`
- `fieldCapture` metadata (template id, required counts, score, per-field results)

Operating-prep writes no curriculum or introduction records and is excluded from
Learn proficiency evidence. Field values must match completely; normalization
ignores case and whitespace, including multiword QTH values.

These records preserve compatibility with existing Learn advancement semantics:

- No change to unlock authority.
- No direct operating-prep unlock path.
