# Feature Specification: Corpus Gap Closure

**Feature Branch**: `feature/corpus-gap-closure` (long-lived; spec dir `specs/009-corpus-gap-closure` resolved via `.specify/feature.json`, not the branch name)

**Created**: 2026-07-13

**Status**: Draft

**Input**: Design record `docs/superpowers/specs/2026-07-13-corpus-gap-closure-design.md`. A governed, non-coding **research program** to close the gap the `corpus-coverage-audit` measures. Supersedes the narrow acquisition-only framing (TASK-17, since completed). Full scope, **no YAGNI**.

## Context

The `corpus-coverage-audit` (spec 007) **measures** how complete the archive is against the full evidentiary record of the Port Breton / Marquis de Rays affair; it does not **close** the gap. Today the audit reads the gap as mostly `unknown`: search history is **empty**, `knownMemberCount` is `unknown` for every campaign, **13/13 sources are unclassified**, suspected leads are unresolved, and sources are unacquired across **multiple repositories** (Gallica *and* Trove). This program is the governed process that drives that measured gap down and keeps it measured. It reuses the shipped pipeline (`source-group-acquisition`: discover → inventory → verify → promote → acquire → reconcile) and the audit (`bib coverage`, search-log, evidence-class, reconcile). It is a research effort — its "output" is a more complete, better-measured corpus, not code — but it is structured with a spec and plan and executed as repeatable loops.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Search a repository and log the result (Priority: P1)

The researcher searches an in-scope repository (e.g. Gallica, Trove, Internet Archive) for a campaign's sources and records the search in the search-log — which repository, which campaign, the date, what was covered, and what questions remain. Empty search history is the dominant gap; every logged search converts an `unknown` into a measured "searched N, found M, remaining Q."

**Why this priority**: Nothing else can be measured until search history exists — it is the load-bearing move that turns `unknown` into evidence and is the source of every newly-discovered candidate.

**Independent Test**: Run one search-and-log for a repository × campaign; `bib coverage` then shows that pair in Search History with a date and coverage note (previously "(none)").

**Acceptance Scenarios**:

1. **Given** an empty search-log, **When** the researcher searches Gallica for the PB-P004 trial corpus and logs it, **Then** `bib coverage` shows `PB-P004 × Gallica` with a date, coverage descriptor, and remaining-questions, and the repository rollup lists Gallica.
2. **Given** a repository with no automated search mechanism, **When** the researcher searches it manually and records the outcome, **Then** the search-log entry is accepted the same as an automated one (manual search is a first-class path).
3. **Given** a search that returns candidates, **When** it is logged, **Then** each candidate is captured for the discovery step (US4) rather than lost.

---

### User Story 2 - Reconcile already-acquired sources into the SSOT (Priority: P1)

The researcher closes sources whose page-image masters are already in the object store but whose SSOT `RepositoryRecord` status is stale (e.g. PB-P003 Baudouin book; PB-P001 partial), so the audit reflects them as acquired rather than `to-collect`.

**Why this priority**: Immediate, visible gap reduction using shipped tooling (`bib reconcile`) — the audit understates completeness until these are reconciled.

**Independent Test**: Run `bib reconcile PB-P003`; its RepositoryRecord advances to `archived` and `bib coverage` reflects the acquisition; `bib validate` clean.

**Acceptance Scenarios**:

1. **Given** PB-P003's masters are in the object store but its record reads `to-collect`, **When** the researcher reconciles it, **Then** its status advances to `archived` (all pages object-store-backed) and coverage reflects it.
2. **Given** PB-P001 is partially captured (`collecting`), **When** reconciled, **Then** its status resolves to the state its provenance supports (`collected` for partial), never overstated as `archived`.

---

### User Story 3 - Acquire a known-missing source from any repository (Priority: P2)

The researcher acquires an approved, rights-cleared source and advances it to archived — from Gallica via the shipped pipeline, or from another repository via that repository's adapter. When acquiring from a repository with no adapter yet (e.g. Trove for PB-P005), the adapter is built as part of the work; acquisition is never abandoned because a source is "not Gallica."

**Why this priority**: Acquisition is the concrete corpus-growth step; multi-repository support is core, not optional — but it depends on candidates being discovered/approved (US4) and rights cleared.

**Independent Test**: Acquire a Gallica monograph (PB-P002 once its ark is resolved) end-to-end; its masters land in the object store and its record reconciles to `archived`. Separately, a non-Gallica source is acquired through a newly-built adapter.

**Acceptance Scenarios**:

1. **Given** an approved Gallica source with a resolved ark and public-domain rights, **When** acquired, **Then** its masters + provenance are stored and its record reconciles to `archived`.
2. **Given** an approved source held only at Trove, **When** the Trove adapter is built and the source acquired, **Then** it is archived the same as a Gallica source, and the adapter is reusable for future Trove sources.
3. **Given** a source whose rights are not public-domain, **When** acquisition is attempted, **Then** it is refused (fail loud) and the source remains tracked in the bibliography as known-but-restricted, not mirrored.

---

### User Story 4 - Discover sources not yet known (forward discovery) (Priority: P2)

The researcher surfaces sources the corpus does not yet know exist — from repository search results (US1), from mining the bibliographies/citations/footnotes/advertisements of acquired sources, and from resolving `suspected`/`referenced` leads — then inventories, verifies, and promotes the genuine ones into the corpus.

**Why this priority**: Closing the gap is not just processing today's known list; the record is open and new sources must be actively found. This is what keeps the loop going after the known set is acquired.

**Independent Test**: Mine an acquired source's bibliography, surface a cited work, resolve it to a real identifier, and inventory it — it appears as a new member/candidate in `bib coverage`.

**Acceptance Scenarios**:

1. **Given** an acquired source citing another work, **When** the researcher mines it and identifies the cited work, **Then** a candidate is created and taken through inventory/verify/promote.
2. **Given** PB-P006's suspected New Italy Museum items, **When** the researcher investigates them, **Then** each is either identified (→ inventory) or documented as unavailable/undigitized with a basis — never left as an unexamined `suspected`.
3. **Given** an ambiguous or unverifiable lead, **When** discovery runs, **Then** it fails loud and records the ambiguity — it never fabricates an identifier or invents a candidate.

---

### User Story 5 - Classify every source by evidence-class (Priority: P2)

The researcher assigns an evidence-class (book, pamphlet, prospectus, newspaper, trial-record, government-report, correspondence, map, photograph, memoir, survivor-account, …) to every source, so the audit's evidence-class distribution has no `unclassified` bucket hiding what kinds of evidence are held vs missing.

**Why this priority**: Classification makes the gap legible by evidence type (e.g. "we have the newspaper but no trial records") and is cheap; it currently reads 13/13 unclassified.

**Independent Test**: Classify a source; `bib coverage`'s evidence-class distribution moves it out of `unclassified` into its class.

**Acceptance Scenarios**:

1. **Given** an unclassified source, **When** the researcher assigns its evidence-class, **Then** the audit's distribution reflects it and the `unclassified` count drops.
2. **Given** every source classified, **When** `bib coverage` runs, **Then** the evidence-class distribution has an empty `unclassified` bucket.

---

### User Story 6 - Establish known-extent where researchable (Priority: P3)

The researcher sets a campaign's `knownMemberCount` (believed extent) where research supports a defensible number (e.g. a bounded set of trial documents), and otherwise records an explicit `unknown` with basis — so coverage is a real fraction where knowable and an honest `unknown` where not.

**Why this priority**: Converts the denominator from blanket `unknown` to a measured figure where the historical record bounds it; lower priority because much of the corpus legitimately stays `unknown`.

**Independent Test**: Set a campaign's known extent from documented research; `bib coverage` reports a numeric gap for it instead of `unknown`.

**Acceptance Scenarios**:

1. **Given** a campaign whose extent research can bound, **When** the researcher records `knownMemberCount`, **Then** coverage shows a numeric gap (actual vs believed).
2. **Given** a campaign whose extent is genuinely unknowable, **When** left `unknown`, **Then** coverage shows `unknown` (never `0`, blank, or a fabricated number).

---

### User Story 7 - Declare measured closure (Priority: P3)

The researcher determines when a repository × campaign is "searched for now" (after N consecutive dry search rounds), and when the program's overall gap is measured-closed: every surfaced lead resolved-or-acquired, every in-scope repository logged, and the remaining `unknown` documented as an irreducible residual.

**Why this priority**: Gives the open-ended program a defensible, non-arbitrary stopping condition and prevents "endless search" or "false done."

**Independent Test**: After the closure conditions hold for a campaign, `bib coverage` shows no unexamined leads, all repositories logged, and only documented `unknown` remaining; the program can assert measured-closure for that campaign.

**Acceptance Scenarios**:

1. **Given** a repository × campaign with N consecutive dry rounds, **When** evaluated, **Then** it is marked searched-for-now with the dry-round evidence, not silently dropped.
2. **Given** all leads resolved/acquired and all repositories logged, **When** closure is evaluated, **Then** the residual is only documented `unknown` and the campaign is declared measured-closed — never asserted as zero/complete.

### Edge Cases

- A repository is unreachable or rate-limits during search → the search-log records the attempt and its incompleteness (fail loud on the mechanism, do not silently record "nothing found").
- A candidate surfaces at multiple repositories → the work is counted once; per-repository copies are tracked separately (the audit's single-work rule).
- A discovered source is in copyright → tracked in the bibliography as known-but-restricted; excluded from mirroring; still counts toward "known."
- `bib migrate` is invoked by habit → must be avoided; it rebuilds the SSOT from stale legacy inputs and would corrupt curation (relates to TASK-8).
- A source is acquired out-of-band (masters appear in the object store without going through `acquire`) → `bib reconcile` closes it without re-fetching.
- Two sessions touch the archive concurrently → per-session archive clones only; never a shared working tree.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The program MUST search each in-scope repository per campaign and record the outcome in the search-log (repository × campaign, date, coverage descriptor, remaining-questions), so search history is never silently empty. Manual search-and-log is a first-class path where no automated mechanism exists.
- **FR-002**: The program MUST reconcile the SSOT `RepositoryRecord` acquisition status from object-store provenance for any source acquired out-of-band or previously unreconciled, without re-fetching (via the shipped `bib reconcile`).
- **FR-003**: The program MUST be able to acquire an approved, rights-cleared source from **any** in-scope repository — Gallica via the shipped pipeline, other repositories via per-repository adapters. When a repository has no adapter, building one is in scope; acquisition MUST NOT be abandoned because a source is non-Gallica.
- **FR-004**: The program MUST perform **forward discovery**: mine acquired sources' bibliographies/citations/footnotes/advertisements, and resolve `suspected`/`referenced` leads, into candidate sources taken through inventory → verify → promote.
- **FR-005**: The program MUST assign an evidence-class to every source; the audit's `unclassified` bucket MUST reach empty.
- **FR-006**: The program MUST set `knownMemberCount` where research supports a defensible number, and otherwise record an explicit `unknown` with basis — never `0`, blank, or a fabricated number.
- **FR-007**: The program MUST determine per-item public-domain rights before any acquisition (per repository); a non-public-domain source MUST be refused for mirroring but retained in the bibliography as known-but-restricted.
- **FR-008**: Discovery MUST fail loud on ambiguous/unverifiable leads and MUST NOT fabricate identifiers or invent candidates.
- **FR-009**: After each loop iteration the program MUST re-measure with `bib coverage`; the program's state of record is the audit's measured output, not an asserted narrative.
- **FR-010**: The program MUST define measured-closure — all surfaced leads resolved-or-acquired, all in-scope repositories logged, remaining `unknown` documented as irreducible residual (with basis). Closure is measured, never asserted as zero/complete.
- **FR-011**: The program MUST mark a repository × campaign "searched-for-now" after a defined number of consecutive dry search rounds, recording the dry-round evidence.
- **FR-012**: The program MUST reuse the shipped `source-group-acquisition` pipeline (discover/inventory/verify/promote/acquire/reconcile) and MUST NOT use `bib migrate` (which rebuilds from stale legacy inputs).
- **FR-013**: The program MUST track per-repository capability gaps (missing acquisition/discovery adapters, e.g. Trove) as first-class work items as they surface, without those gaps blocking progress on other repositories.
- **FR-014**: The program MUST operate against per-session archive clones only (never a shared working tree); the shared object store (B2) is the only shared asset store.
- **FR-015**: The program MUST count a single intellectual work once in coverage; multiple repository copies of the same work are tracked as separate RepositoryRecords, not duplicate works. (Enforced by the reused coverage-audit's single-work invariant — see data-model Invariants; no new code, asserted in the T026 validate pass rather than a dedicated build task.)

### Key Entities *(include if feature involves data)*

- **Repository (as a research object)**: a source archive/catalogue searched for the corpus (Gallica, BnF, Trove/NLA, Internet Archive, HathiTrust, WorldCat, National Archives, State Library of Queensland, New Italy Museum, in-source bibliographies). Attributes: name, kind, search mechanism (automated adapter | manual), rights-determination approach, acquisition adapter (present | to-build).
- **Search-log record**: one search event — repository × campaign, date, coverage descriptor, remaining-questions, and (implicitly) the dry/non-dry outcome. The evidence that turns `unknown` into measured.
- **Campaign**: a research-defined collection (source-group, e.g. PB-P004 trial corpus, PB-P006 New Italy) — members, actual member count (derived), `knownMemberCount` (authored or `unknown`).
- **Candidate**: a discovered but not-yet-inventoried lead — identifier/title/creator/date hints and the provenance of the lead (which search or which acquired source's bibliography surfaced it).
- **Source / RepositoryRecord** (existing model): the intellectual work + its per-archive copies; Source lifecycle (`discovered`→`approved-for-acquisition`→`excluded`) and RepositoryRecord acquisition status (`wanted`→`to-collect`→`collecting`→`collected`→`archived`), plus the evidence-class facet.
- **Suspected/Referenced lead**: an item believed to exist (basis recorded) but not yet identified — resolution state (unexamined → identified → inventoried, or excluded/unavailable with reason).
- **Evidence-class**: the genre facet (book, pamphlet, prospectus, newspaper, trial-record, government-report, parliamentary-paper, correspondence, map, photograph, memoir, survivor-account, missionary-record, …), orthogonal to the structural `kind`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every in-scope repository has at least one dated search-log entry per campaign it is relevant to — search history is no longer empty for any campaign. The SC-001-binding set for the program's initial measured-closure is **{Gallica, BnF catalogue, Trove/NLA, New Italy Museum}** (the repositories with a relevant campaign today; see tasks T008–T009). Further repositories (Internet Archive, HathiTrust, WorldCat, National Archives, State Library of Queensland, …) are **captured-when-reached** as first-class capability items per FR-013 / T027 — they extend the binding set as a relevant campaign surfaces there, and are not required for SC-001's first satisfaction.
- **SC-002**: 100% of sources carry an evidence-class (the audit's `unclassified` bucket is empty).
- **SC-003**: Every source whose masters are in the object store shows an acquired RepositoryRecord status — zero acquired-but-unreconciled sources remain.
- **SC-004**: Every `suspected`/`referenced` lead is resolved — identified-and-inventoried, or documented as excluded/unavailable with a stated basis; none remain unexamined.
- **SC-005**: Every `unknown` in the coverage report is either replaced by a measured value or explicitly documented as an irreducible residual with basis — no dimension renders as a silent blank or a fabricated number.
- **SC-006**: At least one non-Gallica source is acquired through a purpose-built adapter (proving the multi-repository claim end-to-end).
- **SC-007**: The program can, at any time, produce a `bib coverage` report in which no dimension is silently empty — `unknown` is always explicit — and progress between two runs is demonstrable (searches added, sources reconciled/acquired, leads resolved, sources classified).

## Assumptions

- Reuses the shipped `corpus-coverage-audit`, `source-group-acquisition`, `gallica-fetcher`, `canonical-source-metadata`, and `archive-object-store` features.
- The historical corpus is **open** — it cannot be exhaustively enumerated — so "closed" means *measured*, with a documented `unknown` residual, not zero.
- Discovery mechanisms are nascent (one spiked BnF-SRU mechanism + operator-supplied ARKs); **manual search-and-log is a valid, first-class path** wherever no automated adapter exists.
- Public-domain determination is per item and per repository; non-public-domain sources are tracked but not mirrored.
- Non-Gallica acquisition/discovery adapters are built **as sources demand** (Trove first for PB-P005); they are tracked capability items, not up-front blockers.
- Work is done in per-session archive clones; the object store (B2) is the only shared asset store.
- This program supersedes the narrow acquisition-only framing; the completed PB-P004 acquisition (TASK-17) and the new `bib reconcile` verb (TASK-21) are inputs, not the whole mandate.
