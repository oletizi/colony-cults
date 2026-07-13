# Phase 1 Data Model: Coverage (Gap Audit) Web View

This feature **adds no persisted entities and no schema fields.** It consumes the existing,
already-modeled `CoverageReport` projection (`src/bibliography/coverage/coverage-model.ts`,
shipped by corpus-coverage-audit) and renders it. The only new code artifact with a "shape" is
the build helper's signature. The entities below are the *consumed* projection — reproduced
here for the rendering contract, with `coverage-model.ts` as the single source of truth.

## Consumed projection (SSOT: `coverage-model.ts`) — do not redefine

### `CoverageReport`

```
perCampaign: CampaignCoverage[]                       // one per source-group
evidenceClassDistribution: { class: EvidenceClass | 'unclassified', count: number }[]
register: {
  byCampaign: { campaign: string, entries: RegisterEntry[] }[],
  ungrouped: RegisterEntry[]                           // refs on sources with no partOf
}
searchHistory: {
  matrix: { repository: string, campaign: string, lastSearched: string, openQuestions: string[] }[],
  byRepository: { repository: string, lastSearched: string, openQuestions: string[] }[]
}
```

### `CampaignCoverage`

```
campaign: string                                      // source-group sourceId (e.g. PB-P004)
membersByLifecycleState: { state: SourceLifecycleStatus | 'unset', count: number }[]
actualMemberCount: number                             // derived from partOf edges, per work
knownMemberCount: number | 'unknown'                  // authored believed extent
gap: number | 'unknown'                               // knownMemberCount - actual, or 'unknown'
```

### `RegisterEntry`

```
kind: 'reference' | 'suspected'
citedAs?: string                                      // references
description?: string                                  // suspected gaps
basis?: string                                        // free-form prose
owner: string                                         // sourceId (reference) or group id (suspected)
```

**Rendering invariants derived from these shapes** (enforced by the view, not the model):
- `gap` and `knownMemberCount` render the literal `unknown` verbatim when unknown — never
  coerced to a number, never a percentage.
- `evidenceClassDistribution` renders **counts**; `unclassified` is a first-class row.
- `register.ungrouped` renders under an explicit "no campaign" bucket — never dropped.
- `searchHistory.matrix[].openQuestions` is the *currently-open* set (already computed by the
  projection); the view lists it as-is and does not re-derive closure.

## New code artifact — the build helper

### `loadCoverageReport(repoRoot?: string): CoverageReport`

- **Location**: `src/bibliography/coverage/load-coverage-report.ts`.
- **Behavior**: resolves `repoRoot` (default: `resolveRepoRoot()`), then
  `loadAllSources(<root>/bibliography/sources)` + `loadSearchLog(<root>/bibliography/search-log.yml)`
  → `buildCoverageReport({ sources, searchLog })`. Returns the `CoverageReport`.
- **Failure**: fail-loud — propagates the loader's error (malformed SSOT) unchanged; no
  fallback, no partial report. An absent search log yields `[]` (the loader's documented case),
  not an error.
- **Purity/State**: read-only; no writes, no network, no persisted output.

## Relationships to the existing site

- A `CampaignCoverage.campaign` or a `RegisterEntry.owner` MAY correspond to a source that has a
  `/sources/<id>` reading page (rendered by corpus-browser). The view links to it when such a
  page exists and renders a plain identifier otherwise (source-groups have no reading page).
  The set of linkable source ids is the corpus-browser source list; a campaign id (source-group)
  is never linkable.
