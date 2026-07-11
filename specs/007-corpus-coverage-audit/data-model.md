# Phase 1 Data Model: Corpus Coverage & Discovery Audit

Extends the shipped canonical-metadata model (`@/model/source`,
`@/model/repository-record`, `@/bibliography/vocab`). All additions are **optional** and
**additive** — existing sources load unchanged. Derived structures (register, report) are
computed, never persisted.

## Authored additions

### `Source` — new optional fields

```
evidenceClass?: EvidenceClass          // closed-extensible vocab; genre/evidence class,
                                        //   orthogonal to structural `kind`
references?: Reference[]                // citations mined from THIS source
```

- **`evidenceClass`** — validated against `EVIDENCE_CLASS_VALUES`. Orthogonal to `kind`
  (a `monograph` may be a `pamphlet`, `prospectus`, …). Absent → counted *unclassified* by the
  report (not an error).
- **`references`** — see `Reference` below. Valid on any `Source` (a work may cite others).

### `Reference` (element of `Source.references[]`)

```
citedAs: string                        // required — how the work appears in the citation
citedKind?: CitedKind                  // optional — closed-extensible vocab (journal/book/…)
basis?: string                         // optional — FREE-FORM: how it was cited (prose)
resolvedTo?: string                    // optional — sourceId of the identified work
notes?: string                         // optional
```

- A `Reference` **without** `resolvedTo` = the *referenced-but-unidentified* population.
- `resolvedTo`, when present, MUST resolve to an existing `sourceId` (referential check).
- `citedKind`, when present, MUST be in `CITED_KIND_VALUES` (fail loud otherwise).
- `basis` is explanatory prose — NOT validated against any vocabulary.

### Source-group (`Source` with `kind: 'source-group'`) — new optional fields

```
knownMemberCount?: number | 'unknown'  // believed TOTAL extent (denominator), authored
suspected?: SuspectedGap[]             // inferred, uncited pre-discovery gaps
```

- Both fields are valid **only** on `kind: 'source-group'`; authoring either on a non-group
  source fails loud.
- **`knownMemberCount`** — a non-negative integer or the literal string `unknown`. Distinct
  from the *derived* count of actual members (from `partOf` edges). Absent → treated as
  `unknown` (extent not asserted). `unknown ≠ incomplete ≠ 0`.
- **`suspected`** — see `SuspectedGap`.

### `SuspectedGap` (element of source-group `suspected[]`)

```
description: string                    // required — what is suspected to exist
basis: string                          // required — FREE-FORM: why inferred (prose)
evidenceClass?: EvidenceClass          // optional — closed vocab, if a class is expected
notes?: string                         // optional
```

- Boundary with `Reference`: a gap whose basis is a *direct citation by an acquired source*
  belongs in that source's `references[]` (referenced-but-unidentified), not here. `suspected[]`
  is for genuinely inferred gaps (publication pattern, testimony, indirect mention).

## New authored file — `bibliography/search-log.yml`

Append-only, date-ordered list of `SearchLogEntry`. Committed as authored primary data.

### `SearchLogEntry`

```
id: string                             // required — stable flat-opaque, e.g. SRCH-0001; UNIQUE
date: string                           // required — ISO date (YYYY-MM-DD) of the search
repository: string                     // required — repository searched (e.g. "State Library of Queensland")
campaign: string                       // required — a source-group sourceId (e.g. PB-P004)
scope: string                          // required — what was searched (query/coverage scope)
coverage: string                       // required — what the search covered / found
remainingQuestions?: string[]          // optional — open questions after the search
notes?: string                         // optional
```

- `id` MUST be unique across the file (duplicate → fail loud).
- Entries are only appended; existing entries and ids are stable.

## New vocabularies (`@/bibliography/vocab`)

```
EVIDENCE_CLASS_VALUES = [ 'book', 'pamphlet', 'prospectus', 'newspaper',
                          'trial-record', 'gov-report', 'map',
                          'correspondence', 'periodical-article' ]   // closed-EXTENSIBLE
CITED_KIND_VALUES     = [ 'journal', 'book', 'newspaper', 'pamphlet',
                          'government-record', 'article' ]           // closed-EXTENSIBLE
```

- Both are closed at runtime (validated) but *extensible* by a one-line source edit — the same
  discipline as the shipped `RIGHTS_VALUES` / `OCR_STATUS_VALUES`. The initial sets above are the
  design's illustrative examples made concrete; adding a value is a deliberate one-line change.
- Predicates mirror the shipped `isAllowed`/`isSourceLifecycleStatus` style
  (`isEvidenceClass`, `isCitedKind`).

## Derived structures (computed, never persisted)

### `CoverageReport` (projection over the loaded model + search-log)

```
perCampaign: CampaignCoverage[]        // one per source-group
evidenceClassDistribution: {           // corpus-wide counts by class (+ 'unclassified')
  class: EvidenceClass | 'unclassified', count: number }[]
register: {                            // unresolved-references register
  byCampaign: { campaign: string, entries: RegisterEntry[] }[],
  ungrouped: RegisterEntry[]           // refs on sources with no partOf ("no campaign")
}
searchHistory: {
  matrix: { repository: string, campaign: string,
            lastSearched: string, openQuestions: string[] }[],
  byRepository: { repository: string,                       // repository-axis rollup
                  lastSearched: string, openQuestions: string[] }[]
}
```

### `CampaignCoverage`

```
campaign: string                       // source-group sourceId
membersByLifecycleState: { state: SourceLifecycleStatus | 'unset', count: number }[]
actualMemberCount: number              // DERIVED from partOf edges (per work)
knownMemberCount: number | 'unknown'   // authored believed extent (or 'unknown' if absent)
gap: number | 'unknown'                // knownMemberCount - actual, or the literal 'unknown'
```

### `RegisterEntry`

```
kind: 'reference' | 'suspected'
citedAs?: string                       // for references
description?: string                   // for suspected gaps
basis?: string
owner: string                          // sourceId (references) or group id (suspected)
```

### Per-work counting rule

All member/lifecycle counts are computed **per work** (`Source`), never per RepositoryRecord.
A work held at N archives contributes 1 to lifecycle counts; per-archive copy counts are a
separate `copiesByArchive` view and never feed work-level totals.

## Validation rules (added to `@/bibliography/validate-checks`)

| # | Rule | Failure |
|---|------|---------|
| V1 | `evidenceClass` ∈ `EVIDENCE_CLASS_VALUES` | fail loud, name value + sourceId |
| V2 | `references[].citedKind` ∈ `CITED_KIND_VALUES` (when present) | fail loud, name value + sourceId |
| V3 | `references[].resolvedTo` resolves to an existing `sourceId` | fail loud, name dangling ref |
| V4 | `knownMemberCount` / `suspected` only on `kind: 'source-group'` | fail loud, name field + sourceId |
| V5 | `knownMemberCount` is a non-negative integer or the literal `'unknown'` | fail loud |
| V6 | `search-log.yml` entry `id`s are unique | fail loud, name duplicate id |
| V7 | `search-log.yml` entry has required fields (`id/date/repository/campaign/scope/coverage`) | fail loud, name entry |

`basis` is intentionally excluded from validation (free-form prose).

## State transitions

None. This feature adds no lifecycle state machine (the two shipped lifecycles are unchanged).
The only "transition" is a `Reference` gaining a `resolvedTo` edge — a plain field edit,
authored by hand, with no state machinery.
