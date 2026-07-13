# Contract: `loadCoverageReport` build helper

The single build-time entry point that turns committed research data into the rendered report.

## Signature

```ts
// src/bibliography/coverage/load-coverage-report.ts
export function loadCoverageReport(repoRoot?: string): CoverageReport;
```

`CoverageReport` is imported from `@/bibliography/coverage/coverage-model` (unchanged).

## Guarantees

- **G-1 — Same load path as the CLI.** Resolves `repoRoot` (default `resolveRepoRoot()`), then
  reads `<root>/bibliography/sources` via `loadAllSources` and `<root>/bibliography/search-log.yml`
  via `loadSearchLog`, and returns `buildCoverageReport({ sources, searchLog })`. It reuses the
  shipped projection and loaders unchanged (no reimplementation).
- **G-2 — Fail loud, no fallback.** If `loadAllSources` throws on malformed SSOT, the error
  propagates unchanged (naming the offending item). The helper substitutes no default, partial,
  or mock report.
- **G-3 — Absent search log is not an error.** When `search-log.yml` is absent, `loadSearchLog`
  returns `[]` (its documented "none logged yet" case); the returned report's `searchHistory`
  is empty, and the helper does not throw.
- **G-4 — Read-only.** No writes, no network, no committed artifact; calling it twice on
  unchanged inputs returns an equivalent report.
- **G-5 — Type-clean.** No `any`/`as`/`@ts-ignore`; `@/` imports; file ≤300–500 lines.

## Test obligations (vitest)

- Returns a well-formed `CoverageReport` from the committed bibliography (has `perCampaign`,
  `evidenceClassDistribution`, `register`, `searchHistory`); includes the live `PB-P004` campaign.
- Propagates a loader error (fail-loud) rather than returning a partial/empty report when a
  source is malformed (fixture-driven).
- Does not throw when the search log is absent (returns a report with empty `searchHistory`).
