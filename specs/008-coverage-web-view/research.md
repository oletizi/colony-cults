# Phase 0 Research: Coverage (Gap Audit) Web View

No `NEEDS CLARIFICATION` remained after the approved design; this file records the decisions
the design already fixed, in the plan's decision format, plus the two facts that had to be
confirmed against the code.

## Decision 1 — Get the report by importing the projection at build time

- **Decision**: The Astro page obtains the `CoverageReport` by calling, in build-time
  frontmatter, a thin helper `loadCoverageReport(repoRoot?)` that performs the exact CLI
  load+build: `loadAllSources(<root>/bibliography/sources)` + `loadSearchLog(<root>/bibliography/search-log.yml)` → `buildCoverageReport({ sources, searchLog })`.
- **Rationale**: One source of truth, zero drift, no committed derived artifact. `bibliography/`
  is committed in this repo, so it is present in the Netlify build context (unlike the corpus
  page images, whose absence is precisely why *those* needed a committed snapshot). Mirrors how
  the site already imports `@/browser/…` at build.
- **Alternatives considered**: (a) Generate and read a `bib coverage --json` artifact — rejected:
  adds a build step and a derived artifact that can drift, and the audit's governing rule is that
  derived views are never committed. (b) Client-side render from shipped JSON — rejected:
  pointless for a static site whose data is fully known at build time; adds client JS + a
  loading state for plain server-rendered HTML.

## Decision 2 — Helper placement and testability

- **Decision**: `loadCoverageReport` lives at `src/bibliography/coverage/load-coverage-report.ts`,
  beside the projection it wraps, and is the single build-time entry point (used by the Astro
  page; independently unit-tested). It resolves the repo root (default: the shipped
  `resolveRepoRoot()`), and is fail-loud: it does not swallow loader errors.
- **Rationale**: Keeps Astro frontmatter a one-liner and decouples path/loader details from
  rendering; a plain function is trivially unit-testable where an `.astro` page is not.
- **Alternatives considered**: inline the three calls in the page frontmatter — rejected: not
  unit-testable and duplicates path logic if a second consumer ever appears.

## Decision 3 — No client-side JavaScript; counts and `unknown` only

- **Decision**: The page is pure server-rendered HTML with no client JS; every gap renders as a
  concrete count or the literal `unknown`; no percentage/ratio/progress affordance appears.
- **Rationale**: The data is fully known at build time (static), and the audit feature's core
  constraint forbids a coverage percentage over a mostly-unknown denominator (false precision).
- **Alternatives considered**: interactive filtering/sorting — rejected as YAGNI for a ~11-source,
  one-campaign corpus (design out-of-scope).

## Confirmed against the code

- **Projection + loaders exist and are pure/reusable**: `buildCoverageReport(input: CoverageInput): CoverageReport` (`src/bibliography/coverage/coverage-model.ts`) is pure; `loadAllSources`
  (`@/bibliography/load`) and `loadSearchLog` (`@/bibliography/search-log`) are the loaders the
  CLI (`src/cli/bib-coverage.ts`) uses. This feature reuses them **unchanged**.
- **Inputs are committed in this repo**: `bibliography/sources/*.yml` (incl. the `PB-P004`
  source-group) and `bibliography/search-log.yml` are tracked, so the build needs no archive,
  snapshot, or network. `loadSearchLog` returns `[]` when the log is absent (documented "none
  logged yet", not a fallback).
