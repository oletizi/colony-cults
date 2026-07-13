---
title: Coverage (Gap Audit) Web View — Design
roadmap-item: impl:feature/coverage-web-view
date: 2026-07-12
house-rules: stack-control-design-v1
status: operator-approved
---

# Coverage (Gap Audit) Web View — Design

A public research-status page in the corpus-browser Astro site that renders the
`CoverageReport` projection produced by the corpus-coverage-audit feature —
showing, honestly, what the corpus holds and what evidence is still missing. It
is a *rendered projection* of committed bibliography data, generated statically
on every deploy; it adds no new stored facts and no parallel research tree.

## Problem domain

The corpus-coverage-audit feature answers **"what evidence are we still
missing?"** as a derived `CoverageReport` — a pure projection over the committed
bibliography (`bibliography/sources/*.yml`) plus the append-only search log
(`bibliography/search-log.yml`). Today that report is reachable only through the
`bib coverage` CLI (text or `--json`). It is invisible to anyone reading the
corpus on the web.

The corpus-browser site is public-reader-facing: it renders `Source → Issue →
Page` facsimiles with parallel text. Source-groups (discovery *campaigns* such
as `PB-P004`, the de Rays trial-records campaign) hold no facsimiles, so they do
not appear in the reading site at all — yet they are exactly where the "what's
missing" story lives. There is currently no place on the site that frames the
corpus as an in-progress research effort rather than a finished collection.

The report is a projection built by the pure function
`buildCoverageReport({ sources, searchLog }): CoverageReport`
(`src/bibliography/coverage/coverage-model.ts`). Its four parts:

1. **Per-campaign coverage** (`perCampaign: CampaignCoverage[]`) — per
   source-group: members by lifecycle state, actual vs believed member count,
   and the `gap` (a count or the literal `unknown`).
2. **Evidence-class distribution** — corpus-wide counts by evidence class
   (pamphlet, trial-record, map, … + `unclassified`).
3. **Unresolved-references register** — citations mined from held sources that
   do not yet resolve to a held work, grouped by campaign plus an explicit
   "no campaign" (ungrouped) bucket; each entry is a *cited-but-unidentified*
   reference or a *suspected* gap, with its free-form `basis` and owner.
4. **Search history** — a repository × campaign matrix (last searched,
   currently-open questions) plus a by-repository rollup.

### Constraints carried from the feature

- **No headline coverage percentage, ever.** The audit's governing constraint:
  every gap is a concrete count or the literal `unknown` — never a percentage
  over a mostly-unknown denominator (false precision). The web view MUST NOT
  introduce a percentage, ratio badge, or completeness progress bar.
- **Derived, never persisted.** The report is regenerated from committed source
  data; the view renders it at build time and commits no derived artifact.
- **Fail loud, no fallbacks.** A malformed bibliography must fail the build, not
  render a partial or placeholder report.
- **UI is frontend-design-gated.** Per Constitution Principle I (project
  commandment), the markup/CSS is authored through `/frontend-design`.

## Solution space

### Chosen — Import the projection directly at build time

`site/src/pages/coverage/index.astro` loads the report in build-time frontmatter
via a thin, testable helper `loadCoverageReport(repoRoot?)` that wraps the exact
CLI call — `loadAllSources(sourcesDir)` + `loadSearchLog(searchLogPath)` →
`buildCoverageReport({ sources, searchLog })` — and passes the `CoverageReport`
to four focused section components.

This works on Netlify because `bibliography/` is **committed in this repo**
(unlike the corpus page images, whose absence on Netlify is precisely why *those*
needed a committed snapshot). One source of truth, zero drift, no extra artifact
— and it mirrors how the site already imports `@/browser/…` at build.

### Rejected — Generate and read a JSON artifact

Run `bib coverage --json` into a file the page reads. This decouples the site
build from the bibliography loader, but adds a build step and a derived artifact
that can drift from source — and the feature's governing rule is that derived
views are *never* committed. The direct-import path already gives the site the
loader; the artifact buys isolation the small in-repo dataset does not need.

### Rejected — Client-side render

Ship the report as JSON and render in the browser. Pointless for a static site
whose data is fully known at build time; it would add client JS, a fetchable
data blob, and a loading state for content that can be plain server-rendered
HTML.

## Decisions

- **D1 — One page, four sections.** A single `/coverage` route composes four
  small, independent Astro section components (campaign coverage, evidence-class
  distribution, unresolved-references register, search history). Each has one
  clear purpose and renders one slice of the `CoverageReport`. Right-sized to
  the current one-case, ~11-source corpus; no per-campaign drill-down routes
  (add later if campaigns multiply).
- **D2 — Thin build helper.** `loadCoverageReport(repoRoot?)` lives beside the
  projection in `src/bibliography/coverage/` and is the single build-time entry
  point (used by the Astro page; independently unit-testable). Astro frontmatter
  stays a one-liner, decoupled from path/loader details.
- **D3 — Cross-link into the existing site.** A campaign id and a register
  entry's owner link to `/sources/<id>` when such a page exists; otherwise they
  render as plain identifiers (source-groups have no reading page). No dangling
  links.
- **D4 — Explicit empty states, not blanks.** Empty search log (the loader's
  documented `[]`) renders "no searches logged yet"; an empty register or a
  campaign with no members renders an explicit note. A section is never silently
  blank, and an empty state is never an error.
- **D5 — Counts and `unknown`, never a percentage.** Believed extent renders as
  "*N held of M believed (gap G)*" or "*believed extent unknown*"; evidence
  classes render as counts. No percentage, ratio, or progress affordance
  anywhere (enforces the audit's core constraint).
- **D6 — Global nav entry.** One masthead link (e.g. "Coverage" / "Research
  status") makes the view a first-class, public part of the site.
- **D7 — Visual identity via frontend-design.** The page adopts the site's
  existing Prospectus/Dossier identity; the actual layout/typography/markup is
  produced through `/frontend-design` during implementation, not designed here.

## Architecture

```
bibliography/sources/*.yml ─┐
bibliography/search-log.yml ┘
        │  loadAllSources + loadSearchLog
        ▼
loadCoverageReport(repoRoot?)  ──►  buildCoverageReport(...)  ──►  CoverageReport
        │                                                             │
        ▼ (build-time frontmatter)                                    ▼
site/src/pages/coverage/index.astro  ──►  <CampaignCoverage/> <EvidenceDistribution/>
                                          <ReferenceRegister/> <SearchHistory/>
```

- **New:** `src/bibliography/coverage/load-coverage-report.ts` (the helper);
  `site/src/pages/coverage/index.astro`; four section components under
  `site/src/components/coverage/`; one masthead nav link.
- **Unchanged:** the projection (`coverage-model.ts`) and its inputs.

## Error handling

- Malformed bibliography SSOT → `loadAllSources` throws → build fails loud.
- Absent `search-log.yml` → loader returns `[]` (documented "none logged yet")
  → search-history section renders its empty state, not an error.
- Empty register / campaign with no members → explicit per-section empty state.

## Testing

- **Unit:** `loadCoverageReport` against the committed bibliography — resolves
  paths and returns a well-formed `CoverageReport` (the projection itself is
  already covered by the coverage-audit unit tests).
- **Build:** the site builds `/coverage` successfully; the page contains the
  live campaign id(s) and the section headings. Visual correctness is validated
  through the frontend-design pass.

## Out of scope (YAGNI)

- Per-campaign drill-down pages; filtering, sorting, or in-page search.
- Client-side JavaScript; a fetchable JSON blob or "download report" affordance.
- Any coverage percentage, ratio badge, or completeness progress indicator.
- Changes to the projection, the bibliography schema, or the CLI.

## Open questions

- **Nav label** — "Coverage" vs "Research status" vs "What's missing." A
  copy/frontend-design decision; does not block the plan.
- **By-repository rollup placement** — shown alongside the search matrix vs as a
  compact secondary block. A layout decision for the frontend-design pass.

## Provenance

- **Roadmap item:** `impl:feature/coverage-web-view`
  (`docs/engineering-roadmap.md`), status `planned`, depends-on
  `impl:feature/corpus-coverage-audit` (the `CoverageReport` projection and its
  committed inputs) and `impl:feature/corpus-browser` (the Astro site and its
  `/sources/<id>` routes + masthead).
- **Design phase:** operator-driven brainstorming (2026-07-12) via the
  `superpowers:brainstorming` skill; approach A (direct import) selected over the
  decoupled-JSON-artifact alternative.
- **Existing code surveyed:** `src/bibliography/coverage/coverage-model.ts`
  (`buildCoverageReport`, `CoverageReport`), `src/cli/bib-coverage.ts`
  (load→build→render wiring), `src/bibliography/load.ts` /
  `src/bibliography/search-log.ts` (loaders), `bibliography/sources/PB-P004.yml`
  + `bibliography/search-log.yml` (committed inputs), the existing
  `site/src/pages/sources/[sourceId]/…` routes and masthead.
- **Dependency spec:** `specs/007-corpus-coverage-audit`.
- **Next step:** on operator approval, hand off to `/stack-control:define` to
  author the Spec Kit spec, then `execute`.
