# Callsign Curriculum Progression (#97)

This document defines the staged callsign progression for OP-2 (Callsign RX)
and the generator constraints used by the content/training layers.

## Stage model

- `basic-domestic`: simple domestic-style callsigns with familiar prefix+digit+suffix patterns.
- `international`: realistic international prefixes with variable suffix lengths.
- `portable-identifiers`: portable/mobile/expedition-style variants including slash forms.
- `special-event`: short event and commemorative formats (for example one-by-one, `GB` event forms).

## Plausibility constraints

All generated callsigns are synthetic and plausible by structure. They are not
license-database lookups and are not validated against real assignments.

- `basic-domestic`: `^[KNW][0-9][A-Z]{1,3}$` or `^[A-Z]{2}[0-9][A-Z]{1,3}$`
- `international`: `^[A-Z]{1,2}[0-9][A-Z]{1,3}$`
- `portable-identifiers`:
  - `^[A-Z]{1,2}[0-9][A-Z]{1,3}/(P|M|QRP)$`
  - `^[A-Z0-9]{2,4}/[A-Z]{1,2}[0-9][A-Z]{1,3}$`
  - `^[A-Z]{1,2}[0-9][A-Z]{1,3}/[0-9]$`
- `special-event`:
  - `^[KNW][0-9][A-Z]$`
  - `^GB[0-9][A-Z]{2}$`
  - `^(II|AO|TM|LZ|9A)[0-9][A-Z]{2}$`

## Determinism and seeded behavior

- Curated examples are stage-tagged and deterministic by data.
- Generated callsigns are deterministic for a fixed RNG seed.
- Selection prefers stage-eligible curated entries when available and falls
  back to seeded generation with bounded retries.

## Eligibility and OP-2 gating hooks

- Callsigns are filtered by unlocked characters only (including `/` when needed).
- Training hooks expose stage-specific pool eligibility with length bounds and
  minimum pool-size thresholds so OP-2 gates can advance complexity without any
  separate character unlock mechanism.

Portable slash path:

- Portable identifiers require `/` plus at least one unlocked letter and digit.
- The Learn curriculum order already includes `/`, so portable OP-2 eligibility
  is reachable through the existing unlock progression without introducing a
  separate symbol-unlock authority.
- Until `/` is unlocked, portable stage selection is intentionally ineligible.

## Scope guardrails

- No unlock-authority changes: Learn remains the sole source of unlock state.
- No callsign lookup integration.
- No UI redesign or QSO simulation work in this slice.
