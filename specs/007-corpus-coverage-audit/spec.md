# Feature Specification: Corpus Coverage & Discovery Audit

**Feature Branch**: `feature/corpus-coverage-audit`

**Created**: 2026-07-11

**Status**: Draft

**Input**: Design record `docs/superpowers/specs/2026-07-11-corpus-coverage-audit-design.md` (operator-approved 2026-07-11); roadmap item `impl:feature/corpus-coverage-audit`.

## Overview

A lightweight audit layer that answers **"what evidence are we still missing?"** as a
*projection* of the existing bibliography — never a parallel, hand-maintained research
tree. The governing rule: **no fact is stored in two places.** Every new fact is authored
exactly once, on the bibliography node that owns its evidence; the unresolved-references
*register* and the coverage *report* are derived views printed on demand and never
committed. Every derived view MUST be completely regenerable from committed source data.

Right-sized to the current one-case (`port-breton`, ~11 sources) corpus; `PB-P004` (the
trial-records campaign) is the validation case. It reuses the shipped model
(source-groups *are* discovery campaigns; members derive from `partOf` edges) and adds no
fetch/acquisition machinery.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generate the coverage report (Priority: P1)

A researcher runs one command and sees, for the whole corpus, what is known and what is
explicitly unknown — per-campaign member counts against believed extent, evidence-class
distribution, the unresolved-references register, and search history — with every gap shown
as a concrete count or the literal `unknown`, and never a headline coverage percentage.

**Why this priority**: This is the feature's reason to exist — the generated answer to
"what are we missing?" It is the one surface that ties every authored fact together, and it
delivers value even before any new field is populated (it reports the current, mostly-empty
state honestly). It is the MVP: shippable on its own over today's bibliography.

**Independent Test**: Run `bib coverage` (and `bib coverage --json`) against the current
`port-breton` corpus and confirm it prints per-campaign counts, evidence-class distribution,
the (possibly empty) unresolved-references register, and the search-history matrix — with
explicit `unknown` values and no coverage percentage — deriving entirely from committed
source data with nothing written to disk.

**Acceptance Scenarios**:

1. **Given** the committed bibliography, **When** the researcher runs `bib coverage`,
   **Then** it prints per-campaign counts (members by lifecycle state; `knownMemberCount`
   vs. the derived actual count; the gap as a number **or** the literal `unknown`), the
   corpus-wide evidence-class distribution, the unresolved-references register, and the
   repository × campaign search-history matrix plus the repository-axis rollup — and writes
   nothing to disk.
2. **Given** a campaign whose `knownMemberCount` is `unknown`, **When** the report renders,
   **Then** the gap cell shows the literal `unknown` (never `0`, a blank, or a percentage),
   keeping `unknown` distinct from `incomplete` and from `0`.
3. **Given** a work held at more than one archive (multiple RepositoryRecords), **When** the
   report counts it, **Then** it counts the **work once** by lifecycle state and reports
   per-archive copy counts separately, never inflating the work-level totals.
4. **Given** `bib coverage --json`, **When** it runs, **Then** it emits the same information
   as machine-readable structured output suitable for a downstream consumer.
5. **Given** two runs against the same committed state, **When** both complete, **Then** the
   reports are identical (deterministic, regenerable from committed source).

---

### User Story 2 - Record an unresolved citation and resolve it later (Priority: P1)

While reading an acquired source, a researcher records that it cites a work not yet held or
identified (e.g. `PB-P007` cites the journal *la Nouvelle France*). Later, when that work is
identified in an archive, the researcher records the resolution as a single edge — and the
register reflects the change on the next report, with no second store to update.

**Why this priority**: This is the "how was this source found?" provenance trail and the
population of the unresolved-references register (roadmap e / the cited half of b). Without
it the register is always empty. It is authored once, on the source that owns the evidence.

**Independent Test**: Add a `references[]` entry (no `resolvedTo`) to a source YAML, run
`bib coverage`, and confirm it appears in the register as referenced-but-unidentified; then
set `resolvedTo` to an identified source id, re-run, and confirm it drops out of the
unresolved bucket — with the citation authored in exactly one place throughout.

**Acceptance Scenarios**:

1. **Given** an acquired source with a `references[]` entry lacking `resolvedTo`, **When**
   `bib coverage` runs, **Then** that citation appears in the unresolved-references register
   as *referenced-but-unidentified*, grouped under its campaign.
2. **Given** that citation later gains a `resolvedTo` pointing at an identified `sourceId`,
   **When** the report re-runs, **Then** the citation no longer appears as unresolved, and
   the `resolvedTo` edge stands as the recorded provenance for how that source was found.
3. **Given** a `references[]` entry whose `resolvedTo` names a `sourceId` that does not
   exist, **When** the bibliography is validated, **Then** validation fails loud, naming the
   dangling reference.
4. **Given** the citation is recorded, **When** it is stored, **Then** it exists only on the
   acquiring source; no `Source.status` lifecycle value is added or changed to represent it.

---

### User Story 3 - Record a suspected (inferred) gap on a campaign (Priority: P2)

A researcher records a gap they *infer* exists though no acquired source directly cites it
(e.g. "the colony likely issued a prospectus"), capturing the basis for the suspicion so the
reasoning survives, and sees it surface in the register under its campaign.

**Why this priority**: Inferred gaps (roadmap c / the inferred half of b) are how a campaign
declares "we believe more exists here." They complete the register alongside cited gaps but
are secondary to the cited population, which has harder evidence.

**Independent Test**: Add a `suspected[]` entry (with `basis`) to a source-group YAML, run
`bib coverage`, and confirm it appears in the register under that campaign with its basis
preserved.

**Acceptance Scenarios**:

1. **Given** a source-group with a `suspected[]` entry carrying a `description` and a
   `basis`, **When** `bib coverage` runs, **Then** the suspicion appears in the register
   under that campaign, with its `basis` shown so the reason is not lost.
2. **Given** a `suspected[]` or `knownMemberCount` field authored on a non-source-group
   source, **When** the bibliography is validated, **Then** validation fails loud (these
   fields are valid only on `kind: source-group`).
3. **Given** a suspected gap whose stated basis is in fact a *direct citation by an acquired
   source*, **When** it is recorded, **Then** it belongs in that source's `references[]`
   (referenced-but-unidentified), not in `suspected[]` — preserving the cited-vs-inferred
   boundary.

---

### User Story 4 - Declare a campaign's believed extent, including explicit unknown (Priority: P2)

A researcher declares how many members they believe a campaign contains in total — a real
number when known, or the literal `unknown` when the extent is genuinely not known — so the
report can distinguish "complete", "incomplete", and "extent unknown".

**Why this priority**: `knownMemberCount` is the denominator that makes the per-campaign gap
meaningful and keeps `unknown` first-class. Without it, every campaign looks equally
open-ended.

**Independent Test**: Set `knownMemberCount` on a source-group (once to a number, once to
`unknown`), run `bib coverage`, and confirm the per-campaign gap renders as a number in the
first case and the literal `unknown` in the second, distinct from `0`.

**Acceptance Scenarios**:

1. **Given** a campaign with `knownMemberCount: N`, **When** the report renders, **Then** it
   shows the believed extent `N`, the derived actual member count, and the gap as their
   difference.
2. **Given** a campaign with `knownMemberCount: unknown`, **When** the report renders,
   **Then** the gap is the literal `unknown`, held distinct from `0` and from `incomplete`.
3. **Given** a campaign with no `knownMemberCount` authored, **When** the report renders,
   **Then** the extent is treated as `unknown` (absence means the extent is not asserted).

---

### User Story 5 - Log a repository search and see it in the history (Priority: P2)

A researcher records that they searched a repository for a campaign on a given date — what
scope they covered and what questions remain — in an append-only log, and sees it aggregated
into the report's search-history views.

**Why this priority**: Search history is genuinely-new information nothing else records
(RepositoryRecords are per-copy, not per-search). It turns "have we looked here yet?" into a
recorded fact and makes repositories themselves research objects.

**Independent Test**: Append an entry to `bibliography/search-log.yml` with a unique `id`,
run `bib coverage`, and confirm it appears both in the repository × campaign matrix and in
the repository-axis rollup.

**Acceptance Scenarios**:

1. **Given** an entry in `search-log.yml` (`id`, `date`, `repository`, `campaign`, `scope`,
   `coverage`, `remainingQuestions[]`), **When** `bib coverage` runs, **Then** it appears in
   the repository × campaign matrix (last-searched date, open questions) and is aggregated
   into the repository-axis rollup across all campaigns.
2. **Given** two search-log entries sharing the same `id`, **When** the bibliography is
   validated, **Then** validation fails loud, naming the duplicate id.
3. **Given** the search-log, **When** entries are added over time, **Then** it is only
   ever appended to (existing entries and their ids are stable), and it is committed as
   authored primary data.

---

### User Story 6 - Classify a source's evidence class (Priority: P3)

A researcher tags a source with its genre / evidence class (pamphlet, trial-record,
prospectus, …), orthogonal to its structural `kind`, and sees the corpus-wide distribution
in the report.

**Why this priority**: The evidence-class facet (roadmap a) enriches the report's
distribution view and lets coverage questions be asked per evidence class, but the audit is
useful without it; it is the most incremental of the additions.

**Independent Test**: Set `evidenceClass` on a source to a vocab value, run `bib coverage`,
and confirm the source is counted in that class in the distribution; set an
out-of-vocabulary value and confirm validation fails loud.

**Acceptance Scenarios**:

1. **Given** a source with `evidenceClass` set to a value in the vocabulary, **When**
   `bib coverage` runs, **Then** the source is counted under that class in the evidence-class
   distribution.
2. **Given** a source with an `evidenceClass` value not in the vocabulary, **When** the
   bibliography is validated, **Then** validation fails loud, naming the offending value.
3. **Given** a source with no `evidenceClass`, **When** the report renders, **Then** it is
   counted as evidence-class *unclassified* (absence is not an error).

---

### Edge Cases

- **Empty corpus / no campaigns**: `bib coverage` runs cleanly and prints empty sections
  with explicit `unknown`/zero markers — it never errors on absence of data.
- **Campaign with zero members but a non-zero `knownMemberCount`**: the gap equals the full
  believed extent; the register still renders.
- **Reference resolving to a source that is itself unidentified**: `resolvedTo` must point
  at an existing `sourceId`; whether that target is fully processed is not this feature's
  concern (only referential existence is validated).
- **A work with multiple RepositoryRecords across archives**: counted once at work level;
  copy counts reported separately (never inflating totals).
- **Malformed `search-log.yml`** (missing required entry field, duplicate id): fails loud at
  load/validate, naming the entry.
- **Report requested as a preserved artifact**: produced as a release/publication artifact
  tied to the generating commit; it is never committed into the source tree.

## Requirements *(mandatory)*

### Functional Requirements

**Authored fields (each fact stored once):**

- **FR-001**: The `Source` model MUST support an optional `evidenceClass` facet, orthogonal
  to the structural `kind`, validated against a new **closed-but-extensible** evidence-class
  vocabulary; an out-of-vocabulary value MUST fail loud at validation.
- **FR-002**: The `Source` model MUST support an optional `references[]` list of citations
  mined from that source, each with `citedAs`, optional `citedKind`, optional `basis` (how
  the work was cited), optional `resolvedTo` (a `sourceId`), and optional `notes`.
- **FR-003**: A `references[]` entry **without** `resolvedTo` MUST be treated as the
  *referenced-but-unidentified* population; a `resolvedTo` value MUST resolve to an existing
  `sourceId` or validation fails loud.
- **FR-004**: The closed `SOURCE_LIFECYCLE_STATUS` vocabulary MUST NOT be changed by this
  feature; pre-discovery states are properties of *derived* register entries, not
  `Source.status` values.
- **FR-005**: A source-group MUST support an optional `suspected[]` list of inferred
  pre-discovery gaps, each with `description`, optional `evidenceClass`, `basis` (why
  inferred), and optional `notes`.
- **FR-006**: A source-group MUST support an optional `knownMemberCount` of either a
  non-negative integer or the literal `unknown`, representing the campaign's *believed total
  extent* (the denominator), distinct from the derived count of actual members.
- **FR-007**: `suspected[]` and `knownMemberCount` MUST be valid only on `kind:
  source-group`; authoring either on a non-group source MUST fail loud at validation.
- **FR-008**: A new append-only, date-ordered `bibliography/search-log.yml` MUST record
  per-search facts, each entry carrying a stable flat-opaque `id`, `date`, `repository`,
  `campaign` (a source-group id), `scope`, `coverage`, `remainingQuestions[]`, and optional
  `notes`; entry `id`s MUST be unique or validation fails loud.

**Generated views (derived, never committed):**

- **FR-009**: The system MUST provide a `bib coverage` command that derives and prints a
  coverage report to standard output, with a `--json` machine-readable variant, writing
  nothing to disk by default.
- **FR-010**: The report MUST include, per campaign, member counts by lifecycle state, the
  `knownMemberCount` vs. the derived actual count, and the gap rendered as a number **or**
  the literal `unknown`.
- **FR-011**: The report MUST include a corpus-wide evidence-class distribution (sources
  without an `evidenceClass` counted as *unclassified*).
- **FR-012**: The report MUST include the unresolved-references register — every unresolved
  `references[]` entry plus every `suspected[]` entry — grouped by campaign.
- **FR-013**: The report MUST include a repository × campaign search-history matrix
  (last-searched date, open questions) **and** a repository-axis rollup treating each
  repository as a research object (last-searched across all campaigns, aggregated open
  questions).
- **FR-014**: The report MUST count per **work**: a `Source` held at multiple archives
  (multiple RepositoryRecords) MUST count once by lifecycle state, with per-archive copy
  counts reported separately and never inflating work-level totals.
- **FR-015**: The report MUST NOT present a headline coverage percentage; it MUST surface
  explicit `unknown` values wherever the denominator is not known.
- **FR-016**: Every derived view MUST be completely regenerable from committed source data
  (source YAMLs + `search-log.yml`); the register and report MUST NOT be written into the
  repository as source, and running the report twice against the same committed state MUST
  produce identical output.

### Key Entities *(include if feature involves data)*

- **Reference** (on `Source`): a citation of another work mined from this source —
  `citedAs`, `citedKind?`, `basis?`, `resolvedTo?`, `notes?`. Unresolved = the
  referenced-but-unidentified population; `resolvedTo` is the found-it provenance edge.
- **SuspectedGap** (on a source-group): an inferred, uncited pre-discovery gap —
  `description`, `evidenceClass?`, `basis`, `notes?`.
- **EvidenceClass** (facet on `Source`): genre/evidence-class value from a closed-extensible
  vocabulary, orthogonal to structural `kind`.
- **KnownMemberCount** (on a source-group): believed total extent — a non-negative integer
  or the literal `unknown` — the campaign's denominator, distinct from the derived actual
  count.
- **SearchLogEntry** (in `bibliography/search-log.yml`): one recorded repository search —
  `id`, `date`, `repository`, `campaign`, `scope`, `coverage`, `remainingQuestions[]`,
  `notes?`. Append-only, committed.
- **Unresolved-references register** (derived): projection of unresolved References +
  SuspectedGaps, grouped by campaign. Never stored.
- **Coverage report** (derived): projection over all of the above + the shipped
  Source/RepositoryRecord model. Never stored.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A researcher can answer "what are we missing?" for the whole corpus with a
  single command, seeing per-campaign, evidence-class, unresolved-reference, and
  search-history views together.
- **SC-002**: Every gap in the report is shown either as a concrete count or as the literal
  `unknown`; the report contains **zero** headline coverage percentages.
- **SC-003**: Every fact the feature adds is authored in exactly one location; there is no
  second store to keep in sync, and no derived view is committed to the repository.
- **SC-004**: The report is fully regenerable — two runs against the same committed state
  produce identical output, and a snapshot for any past commit can be reproduced by running
  at that commit.
- **SC-005**: 100% of invalid authored inputs fail loud at validation — an out-of-vocabulary
  `evidenceClass`, a dangling `resolvedTo`, a group-only field on a non-group source, and a
  duplicate search-log `id` each produce a descriptive error naming the offending item.
- **SC-006**: A work held at multiple archives is counted exactly once at work level in the
  report (validated on a fixture with two RepositoryRecords for one Source).
- **SC-007**: The `PB-P004` trial-records campaign is used as the validation case end to end,
  with no code path special-cased to it (the same commands work unchanged on any
  source-group).

## Assumptions

- The shipped `impl:feature/canonical-source-metadata` model (`Source`, `RepositoryRecord`,
  source-groups, `partOf` membership, the two lifecycle vocabularies) is present and reused;
  this feature adds fields and one file, not a new model.
- The coverage report and register are consumed by a person (or a downstream tool via
  `--json`) by hand; no query automation or scheduled generation is in scope.
- Search-log entries are authored by hand into `search-log.yml`; whether a convenience writer
  command is added is deferred to a later scoping pass (see design record open questions).
- Grouping of unresolved references is by campaign; whether to additionally surface a flat
  global list for references tied to no campaign is deferred (design record open question).
- The report surface is a `bib` subaction; a top-level cross-tool verb is deferred unless a
  cross-tool consumer appears.
- The pre-existing committed derived `sources.csv` (via `bib regenerate`) is out of scope;
  this feature's no-commit-derived rule applies to its own new views, with reconciliation of
  the older CSV left as a possible follow-up.

## Out of Scope

- No fetch, OCR, or translation; no new acquisition pipeline; no query/search automation.
- No new or extended lifecycle state machine (the third-party proposal's 11-stage linear
  lifecycle is rejected as false precision; the two shipped lifecycles stand unchanged).
- No research-program-management subsystem heavier than the ~11-source corpus it audits.

## Dependencies

- **`impl:feature/canonical-source-metadata`** — the shipped Source/RepositoryRecord model,
  source-group container, and lifecycle vocabularies this feature projects over and extends.
