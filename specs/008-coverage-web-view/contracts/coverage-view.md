# Contract: `/coverage` view (rendering guarantees)

The page and its four section components render the `CoverageReport` under these guarantees.
Visual/layout/typography is authored through `/frontend-design`; this contract fixes *what must
be true of the rendered output*, not how it looks.

## Route

- **G-1 — Route.** The site serves a page at `/coverage` (`site/src/pages/coverage/index.astro`),
  built statically. Its data comes from `loadCoverageReport()` in build-time frontmatter.

## Sections (one page, four components)

- **G-2 — Per-campaign coverage** (`CampaignCoverage.astro`). For each `perCampaign` entry:
  the campaign id, its `membersByLifecycleState` as state→count, `actualMemberCount`, and the
  believed extent rendered as *N held of M believed (gap G)* — or *believed extent unknown* when
  `knownMemberCount === 'unknown'` (then `gap` renders the literal `unknown`).
- **G-3 — Evidence-class distribution** (`EvidenceDistribution.astro`). Each
  `evidenceClassDistribution` row as class→**count**, including the `unclassified` row.
- **G-4 — Unresolved-references register** (`ReferenceRegister.astro`). `register.byCampaign`
  grouped by campaign, then `register.ungrouped` under an explicit **"no campaign"** heading.
  Each entry shows its kind (*cited-but-unidentified reference* for `reference`, *suspected gap*
  for `suspected`), its `citedAs`/`description`, its `basis`, and its `owner`.
- **G-5 — Search history** (`SearchHistory.astro`). The `searchHistory.matrix` as a
  repository × campaign layout with each cell's `lastSearched` and `openQuestions`, plus the
  `byRepository` rollup.

## Invariants (fail the review if violated)

- **G-6 — No percentage, ever.** No coverage percentage, ratio badge, or completeness/progress
  indicator appears anywhere on the page. Gaps render as a count or the literal `unknown`.
- **G-7 — Cross-links, no dead links.** A campaign id or a register owner links to
  `/sources/<id>` iff that reading page exists; otherwise it renders as a plain identifier.
  A source-group id is never linked. No dangling link is emitted.
- **G-8 — Explicit empty states.** An empty `searchHistory` renders "no searches logged yet";
  an empty `register` renders an explicit "nothing unresolved" state; a campaign with no members
  renders an explicit empty members state. No section renders blank, and no empty state is an
  error.
- **G-9 — Fail loud at build.** If `loadCoverageReport()` throws (malformed bibliography), the
  build fails; the page is never emitted with a partial or placeholder report.
- **G-10 — One nav entry.** Exactly one global-navigation (masthead) link points to `/coverage`.
- **G-11 — Design-skill gated.** The page, the four components, the empty states, and the nav
  link are authored through `/frontend-design:frontend-design`, adopting the site's existing
  visual identity; no markup/CSS is written before that skill is invoked.
