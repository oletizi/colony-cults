# Feature Specification: Coverage (Gap Audit) Web View

**Feature Branch**: `feature/coverage-web-view`

**Created**: 2026-07-12

**Status**: Draft

**Input**: Design record `docs/superpowers/specs/2026-07-12-coverage-web-view-design.md` (operator-approved 2026-07-12); roadmap item `impl:feature/coverage-web-view`.

## Overview

A public **research-status** page at `/coverage` in the existing corpus-browser site
that renders the corpus-coverage-audit **coverage report** — the derived projection
answering *"what evidence do we hold, and what are we still missing?"* Today that report
is reachable only through the `bib coverage` CLI and is invisible to anyone reading the
corpus on the web; discovery **campaigns** (source-groups such as `PB-P004`, the de Rays
trial-records campaign) hold no facsimiles and never appear in the reading site at all.
This view is where they first become visible, and where the corpus is framed honestly as
an in-progress research effort rather than a finished collection.

The page is a **rendered projection** of already-committed research data — regenerated on
every build, storing no new facts and committing no derived artifact. Its governing
constraint, inherited from the audit feature: **every gap is a concrete count or the
literal `unknown` — never a coverage percentage** (false precision over a mostly-unknown
denominator).

All user-facing layout, components, empty states, and navigation for this feature are
produced **through the `/frontend-design:frontend-design` skill** (project commandment /
Constitution Principle I), invoked before any markup or styling is written.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the corpus's research status at a glance (Priority: P1)

A reader or collaborator opens `/coverage` and sees, on one page, what the corpus holds
and what is still explicitly missing: for each discovery campaign, how many members are
held against the believed extent (or `unknown`); the corpus-wide spread of evidence by
class; the register of cited-but-unlocated works and suspected gaps; and the record of
where and when repositories were searched with what still open. Nothing is a headline
percentage — every gap is a count or `unknown`.

**Why this priority**: This is the whole feature — a single honest snapshot of coverage.
Delivered alone it stands as a complete, viable increment.

**Independent Test**: Build the site and open `/coverage`; confirm the four sections
render from the committed bibliography with real campaign ids, counts, and the literal
`unknown` where extent is unknown, and that no percentage or progress bar appears.

**Acceptance Scenarios**:

1. **Given** the committed bibliography includes source-group `PB-P004` with a believed
   extent and members, **When** the reader opens `/coverage`, **Then** the per-campaign
   section shows `PB-P004`'s members-by-lifecycle-state counts and its believed extent as
   *N held of M believed (gap G)*, or *believed extent unknown* when the count is unknown.
2. **Given** sources carry evidence classes, **When** the page renders, **Then** the
   evidence-class section lists each class (including `unclassified`) with a corpus-wide
   **count** — and no percentage, ratio, or progress indicator anywhere on the page.
3. **Given** a held source cites a work that does not resolve to a held work, **When** the
   page renders, **Then** that citation appears in the unresolved-references register
   under its owning campaign (or the explicit "no campaign" bucket), marked as a
   cited-but-unidentified reference, with its basis and owner.
4. **Given** the search log records searches, **When** the page renders, **Then** the
   search-history section shows a repository × campaign matrix with each cell's last-searched
   date and currently-open questions, plus a by-repository rollup.

---

### User Story 2 - Cross into the held record from a gap (Priority: P2)

From a campaign or a register entry, the reader follows a link to the owning source's
existing reading page (`/sources/<id>`) to inspect the held evidence — without hitting a
dead link when no such page exists (e.g. a source-group, which has no reading page).

**Why this priority**: Navigational connective tissue that makes the audit actionable;
valuable but the P1 snapshot stands without it.

**Independent Test**: On `/coverage`, confirm every identifier that has a `/sources/<id>`
page is a working link to it, and every identifier that does not (a source-group id) is
rendered as plain text with no link.

**Acceptance Scenarios**:

1. **Given** a register entry owned by a source that has a reading page, **When** the
   reader clicks its owner, **Then** they land on that source's `/sources/<id>` page.
2. **Given** a campaign id (a source-group with no reading page), **When** the page
   renders, **Then** the id is shown as a plain identifier with no dangling link.

---

### User Story 3 - Reach coverage from anywhere on the site (Priority: P3)

A reader anywhere in the site uses a single global-navigation link to reach the coverage
page.

**Why this priority**: Discoverability; the page is usable by direct URL without it, so it
is the lowest-priority slice.

**Independent Test**: From any page, confirm one masthead/global-nav link leads to
`/coverage`.

**Acceptance Scenarios**:

1. **Given** the reader is on any site page, **When** they use the global navigation,
   **Then** exactly one link takes them to the coverage page.

---

### Edge Cases

- **Malformed bibliography**: if the committed research data is invalid, the build MUST
  fail loud (surfacing the offending source/entry), never render a partial or placeholder
  report.
- **No searches logged**: an absent/empty search log renders an explicit "no searches
  logged yet" state — not an error, and not a blank section.
- **Empty register**: when no unresolved references or suspected gaps exist, the register
  section renders an explicit "nothing unresolved" state, never a blank.
- **Campaign with no members / unknown extent**: renders the members list (possibly empty,
  explicitly) and the extent as the literal `unknown`; the gap is `unknown`, never `0`
  inferred from absence.
- **A campaign with no `partOf` members / references with no campaign**: unresolved
  references whose owning source has no campaign appear under the explicit "no campaign"
  (ungrouped) bucket — never silently dropped.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The site MUST expose a coverage page at `/coverage` that presents the
  coverage report as one page composed of four sections: per-campaign coverage,
  evidence-class distribution, unresolved-references register, and search history.
- **FR-002**: The page MUST be generated at build time from the committed research data
  (the bibliography sources and the search log) using the existing coverage-report
  projection — deriving the view, not re-deriving or duplicating the underlying facts.
- **FR-003**: The build MUST NOT require the private archive, an image snapshot, or any
  network access to render the coverage page, and MUST NOT commit any derived report
  artifact.
- **FR-004**: The per-campaign section MUST show, for each discovery campaign
  (source-group): its members counted by lifecycle state, the actual member count, the
  believed member count (or the literal `unknown`), and the gap as a concrete count or the
  literal `unknown`.
- **FR-005**: The evidence-class section MUST show corpus-wide **counts** per evidence
  class, including an explicit `unclassified` bucket.
- **FR-006**: The unresolved-references register MUST list each unresolved citation and
  suspected gap grouped by campaign, with an explicit "no campaign" (ungrouped) bucket,
  each entry distinguishing a cited-but-unidentified reference from a suspected gap and
  showing its basis and owner.
- **FR-007**: The search-history section MUST present a repository × campaign matrix with
  each cell's last-searched date and currently-open questions, plus a by-repository
  rollup.
- **FR-008**: The page MUST NOT display any coverage percentage, ratio badge, or
  completeness/progress indicator; every gap is expressed as a concrete count or the
  literal `unknown`.
- **FR-009**: Identifiers on the page (campaign ids, register-entry owners) MUST link to
  the corresponding `/sources/<id>` reading page when one exists, and MUST render as plain
  identifiers (no link) when none exists — no dangling links.
- **FR-010**: The site MUST provide exactly one global-navigation (masthead) link to the
  coverage page.
- **FR-011**: When the underlying research data is malformed, the build MUST fail loud and
  name the offending item; it MUST NOT substitute a fallback, placeholder, or partial
  report.
- **FR-012**: When a section has no data (no searches logged, empty register, campaign
  with no members), the page MUST render an explicit empty state for that section, never a
  blank or an error.
- **FR-013**: All user-facing layout, components, empty states, and the navigation link
  MUST be authored through the `/frontend-design:frontend-design` skill, adopting the
  site's existing visual identity; markup/styling MUST NOT be written before that skill is
  invoked.

### Key Entities *(include if feature involves data)*

- **Coverage report**: the derived, non-persisted projection over the committed research
  data; the whole of what this page renders. Comprises the four parts below.
- **Campaign coverage**: per discovery campaign (source-group) — members by lifecycle
  state, actual member count, believed member count (or `unknown`), and gap (or `unknown`).
- **Evidence-class distribution**: corpus-wide count per evidence class, plus
  `unclassified`.
- **Unresolved-references register**: entries (a cited-but-unidentified reference or a
  suspected gap) grouped by campaign plus an ungrouped "no campaign" bucket; each has a
  basis and an owner.
- **Search history**: a repository × campaign matrix (last-searched date, currently-open
  questions) and a by-repository rollup.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reader opening `/coverage` can identify, for every discovery campaign, how
  many members are held and whether the believed extent is a number or `unknown`, without
  reading any other page.
- **SC-002**: The page shows zero coverage percentages, ratio badges, or progress
  indicators — 100% of gaps are expressed as a count or the literal `unknown`.
- **SC-003**: The coverage page builds with no private archive, no image snapshot, and no
  network access, and adds no committed derived report file to the repository.
- **SC-004**: Every identifier shown on the page that has a reading page resolves to a live
  `/sources/<id>` page, and every identifier without one is unlinked — zero dangling links.
- **SC-005**: Introducing a malformed bibliography entry fails the build with a message
  naming the offending item; the page never renders a partial report.
- **SC-006**: From any page in the site, a reader reaches `/coverage` via exactly one
  global-navigation link.

## Assumptions

- The corpus-coverage-audit feature is present and its coverage-report projection and its
  committed inputs (the bibliography sources and the search log) are available in this
  repository (depends-on `impl:feature/corpus-coverage-audit`).
- The corpus-browser site, its `/sources/<id>` reading routes, and its global masthead are
  present and are the host for this page (depends-on `impl:feature/corpus-browser`).
- The committed bibliography is the single source of truth for coverage; this feature adds
  no research facts, no schema fields, and no changes to the projection or the CLI.
- The current corpus is one case (~11 sources, `PB-P004` the live campaign); the page is
  right-sized to that and needs no per-campaign drill-down, filtering, or sorting yet.
- The site is a statically built site whose research data is fully known at build time, so
  the page needs no client-side JavaScript.

## Out of Scope

Per the approved design (stated scope, not new cuts):

- Per-campaign drill-down pages or routes.
- Filtering, sorting, or in-page search of the report.
- Client-side JavaScript, a fetchable JSON data blob, or a "download report" affordance.
- Any coverage percentage, ratio badge, or completeness/progress indicator.
- Changes to the coverage-report projection, the bibliography schema, or the CLI.
