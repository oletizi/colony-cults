# Phase 0 Research: Corpus Coverage & Discovery Audit

No open `NEEDS CLARIFICATION` items entered planning — the operator-approved design record and
the `/speckit-clarify` session resolved every decision. This file records the load-bearing
decisions with rationale and rejected alternatives, so the design phase is auditable.

## Decision 1 — Audit layer is a projection, not a store

- **Decision**: Every new fact is authored once, on the bibliography node that owns its
  evidence; the register and report are derived views printed on demand and never committed.
  Every derived view is fully regenerable from committed source (`bibliography/sources/*.yml`
  + `bibliography/search-log.yml`).
- **Rationale**: Eliminates source-of-truth divergence (the legacy-CSV drift trap the roadmap
  forbids). A view that is never stored cannot drift; regenerability means a preserved snapshot
  is reproducible at any commit, so none needs committing.
- **Alternatives considered**: (a) a hand-maintained `research/` tree or `unresolved.yml`
  register — rejected as a second source of truth; (b) committing generated reports — rejected
  because a committed derived doc invites future agents to hand-edit it as SSOT (explicit
  operator directive).

## Decision 2 — Pre-discovery states are register properties, not `Source.status` values

- **Decision**: Do NOT extend the closed `SOURCE_LIFECYCLE_STATUS` vocab. A cited-but-unfound
  work is a `references[]` entry lacking `resolvedTo`; an inferred gap is a `suspected[]` entry
  on the campaign. "referenced-but-unidentified" and "suspected" are states of *derived*
  register entries.
- **Rationale**: A `Source` is an identified work with a real title; a bare citation is not.
  Extending the lifecycle vocab would force title-less `Source` stubs and pollute the
  identified-works set.
- **Alternatives considered**: adding `referenced-but-unidentified`/`suspected` to
  `SOURCE_LIFECYCLE_STATUS` — rejected (strains Source invariants).

## Decision 3 — Validation posture for descriptor fields (from /speckit-clarify)

- **Decision**: `evidenceClass` and `citedKind` are **closed-but-extensible validated
  vocabularies** (new `EVIDENCE_CLASS_VALUES`, `CITED_KIND_VALUES` in `vocab.ts`, checked like
  the shipped closed vocabs). `basis` (on `references[]` and `suspected[]`) is **free-form**
  text and is NOT validated.
- **Rationale**: `citedKind`/`evidenceClass` are small, enumerable, and keyed on by the report's
  distribution/rollup — a controlled vocab keeps those aggregations honest. `basis` records
  *why* in prose; validating it would fight its purpose.
- **Alternatives considered**: both closed (rejected — `basis`-as-enum strains when reasoning
  doesn't fit a preset); both free (rejected — `citedKind` drift undercuts the distribution).

## Decision 4 — Register grouping (from /speckit-clarify)

- **Decision**: Group the register by campaign, with an explicit "no campaign" / ungrouped
  bucket for references on standalone sources (no `partOf`). No separate flat global list.
- **Rationale**: Nothing known is silently dropped (the feature's whole point); the ungrouped
  bucket is visible and honest without a second redundant view.
- **Alternatives considered**: campaign-only omitting uncampaigned refs (rejected — drops real
  gaps); an additional flat global list (rejected — redundant at this corpus size).

## Decision 5 — Counting is per work

- **Decision**: A `Source` held at multiple archives (multiple RepositoryRecords) counts once
  by lifecycle state; per-archive copy counts are reported separately.
- **Rationale**: Coverage is a question about works, not copies; counting copies as works would
  inflate totals and mislead.
- **Alternatives considered**: counting RepositoryRecords (rejected — inflates work-level
  totals).

## Decision 6 — Search-log is authored primary data in its own file

- **Decision**: `bibliography/search-log.yml`, append-only, date-ordered, structured YAML,
  each entry carrying a stable flat-opaque `id` (e.g. `SRCH-0001`); committed.
- **Rationale**: Per-search facts exist nowhere else (RepositoryRecords are per-copy). A
  separate file keeps immutable history out of mutable entity records; structured YAML lets the
  report aggregate it. Flat-opaque ids follow the repo's `PB-P###` convention and avoid the
  date-encoded-id correction hazard.
- **Alternatives considered**: search fields on the source-group record (rejected — mixes
  history into current state, rewritten on regenerate); markdown log (rejected — not
  machine-aggregable); date-encoded ids like `SEARCH-YYYYMMDD-NNN` (rejected — double-encodes
  the date, breaks on correction). Whether to add a `bib log-search` writer verb is deferred to
  a later scoping pass; entries are hand-authored for now.

## Decision 7 — Report home is a `bib` subaction

- **Decision**: `bib coverage` (+ `--json`), added to the existing bibliography CLI dispatch.
- **Rationale**: Consistent with the shipped `bib` verbs (`show`, `validate`, `inventory`, …);
  no cross-tool consumer exists to justify a top-level `stackctl` verb.
- **Alternatives considered**: a top-level `stackctl` verb (deferred until a cross-tool consumer
  appears).
