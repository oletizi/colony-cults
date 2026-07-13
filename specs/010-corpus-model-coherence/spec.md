# Feature Specification: Corpus Model Coherence

**Feature Branch**: `feature/corpus-gap-closure` (long-lived; spec dir `specs/010-corpus-model-coherence` resolved via `.specify/feature.json`, not the branch name)

**Created**: 2026-07-13

**Status**: Draft

**Input**: Approved design record [docs/superpowers/specs/2026-07-13-corpus-model-coherence-design.md](../../docs/superpowers/specs/2026-07-13-corpus-model-coherence-design.md). Roadmap item `impl:feature/corpus-model-coherence`. Originates from backlog **TASK-22** (coverage counts containers), **TASK-24** (search-log keyed by group only), **TASK-27** (standalone-source approval path) — surfaced by the 009 corpus-gap-closure research. First tool-on-demand pulled by the 009 program.

## Context

The corpus coverage model (spec 007 + the source-group / search-log tooling) overloads a single concept — **source-group** — to do three unrelated jobs at once: it is (a) the **search scope** a search is logged against, (b) the **container** that bundles member works, and (c) the **gate** that makes a source acquirable. Doing the 009 gap-closure research surfaced this as three concrete blockers that are one root cause: a standalone work's real search cannot be logged (no group to file it under), containers are counted as works in the evidence-class distribution (`unclassified` cannot reach 0), and a standalone work cannot be approved for acquisition. This feature decouples the three jobs onto a coherent first-class **Scope** model.

**Non-negotiable governing constraint — CLEAN BREAKS ONLY.** No intermediate migrations, no transitional dual-representations, no backwards-compatibility shims or aliases anywhere. Every schema/format/interface change is a single clean cutover: existing data is rewritten to the new canonical shape and every consumer speaks **only** the new shape, **failing loud on the old one** (a retired field/key is a hard error, never a tolerated alias or silently-ignored key). This is distinct from — and must not become — a `bib migrate` (separately prohibited: it rebuilds the SSOT from stale legacy inputs).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Log a search against any scope (Priority: P1)

The researcher logs a repository search whose scope is a single **work**, the whole **case**, or a **thread** — not only a source-group — so the standalone sources' real searches (e.g. PB-P001's State Library of Queensland + Gallica searches) can finally be recorded. The search-log speaks the new `scope:` shape only.

**Why this priority**: This is the blocker that stranded search history for 6 of 13 sources; it is the load-bearing decoupling (search-scope off source-group) and delivers immediate measured coverage the current model cannot represent.

**Independent Test**: Author a search-log entry with `scope: {kind: work, id: PB-P001}`; `bib coverage` shows it under the work scope with a date. A `scope: {kind: work, id: PB-P004}` (PB-P004 is a source-group) is rejected loud. A legacy `campaign:` key is rejected loud.

**Acceptance Scenarios**:

1. **Given** the search-log speaks `scope:`, **When** the researcher logs a search with `scope: {kind: work, id: PB-P001}`, **Then** it is accepted and `bib coverage` reports it under that work scope.
2. **Given** the single pre-existing entry SRCH-0001 (keyed to PB-P004 under the old `campaign:` shape), **When** the cutover runs, **Then** that one entry is rewritten to `scope: {kind: work-bundle, id: PB-P004}` and remains valid — no data lost.
3. **Given** the cutover is complete, **When** any search-log entry carries a `campaign:` key, **Then** the loader rejects it as a hard error (fail loud) — `campaign:` is not a tolerated alias.

---

### User Story 2 - Count works, not containers, in coverage (Priority: P1)

The researcher runs `bib coverage` and the evidence-class distribution counts **only fetchable works**; source-groups (containers) are excluded — so `unclassified` reaches 0 honestly once every work is classified.

**Why this priority**: Immediate, visible correctness fix; the current model reports `unclassified 2` for two containers that are not works, making SC-002 of the 009 program unreachable.

**Independent Test**: With all 11 individual works classified and the 2 source-groups present, `bib coverage` evidence-class distribution shows `unclassified 0` (the containers are not counted).

**Acceptance Scenarios**:

1. **Given** every fetchable work carries an evidence-class and two source-groups exist, **When** `bib coverage` runs, **Then** the evidence-class distribution counts 11 works and shows `unclassified 0` — the source-groups are excluded.
2. **Given** a source-group with no evidence-class, **When** coverage runs, **Then** it is not reported as `unclassified` (a container is not a work).

---

### User Story 3 - Approve a standalone work for acquisition (Priority: P2)

The researcher approves a work that belongs to no source-group for acquisition, and acquires it — while a source-group (container) remains un-approvable and un-acquirable.

**Why this priority**: Unblocks acquisition of standalone works (e.g. PB-P002) that the group-keyed approval gate stranded; depends on the work/container distinction (US1/US2) being in place.

**Independent Test**: Approve PB-P002 (a standalone work) → it becomes acquire-eligible. Attempt to approve or acquire a source-group → rejected loud (containers are not fetchable).

**Acceptance Scenarios**:

1. **Given** PB-P002 is a fetchable work in no group, **When** the researcher approves it for acquisition, **Then** it advances to `approved-for-acquisition` and acquire accepts it — independent of group membership.
2. **Given** a source-group (work-bundle), **When** approval or acquisition is attempted on it, **Then** it is rejected loud — the container prohibition is preserved.

---

### User Story 4 - Report coverage per scope (Priority: P2)

The researcher runs `bib coverage` and sees search history and measured-closure reported **per scope** (case, thread, work-bundle, work), not only per source-group.

**Why this priority**: Makes the decoupled scopes legible in the audit; without it the newly-loggable work/case/thread searches would have no home in the report.

**Independent Test**: With searches logged against a work scope and a work-bundle scope, `bib coverage` lists a per-scope search-history section that includes both, each resolvable.

**Acceptance Scenarios**:

1. **Given** searches logged against different scope kinds, **When** `bib coverage` runs, **Then** it reports search history per scope, each `ScopeRef` resolved to its referent.
2. **Given** a persisted `ScopeRef`, **When** coverage resolves it, **Then** it resolves under its declared kind or the report fails loud (no silently-dangling scope).

---

### User Story 5 - Thread scope kind defined (not populated) (Priority: P3)

The researcher has a thread scope kind available in the model — a thin registry (`bibliography/scopes.yml`) owning thread identity + description, and a one-directional `threads: [ids]` field on a Source — defined and validated, but this build populates no threads.

**Why this priority**: The thread concept is what makes the model future-proof for the cross-cutting analysis themes, but populating them is later research; this build only lands the machinery so the wall is not hit again.

**Independent Test**: Declare a thread in `scopes.yml` and tag a Source with it; `bib validate` accepts the membership and rejects a `threads:` id absent from the registry; coverage requires no thread to exist.

**Acceptance Scenarios**:

1. **Given** an empty thread registry, **When** `bib validate` and `bib coverage` run, **Then** they succeed (no thread is required to exist).
2. **Given** a Source tagged with a `threads:` id not present in `scopes.yml`, **When** validation runs, **Then** it is rejected loud (thread membership must resolve to a registered thread).

### Edge Cases

- A `ScopeRef` whose `id` does not resolve **under its declared kind** (e.g. `{kind: work, id: PB-P004}` where PB-P004 is a source-group) → **fail loud**; kind/referent agreement is checked, never assumed.
- A `campaign:` key encountered anywhere after the cutover → **fail loud** (retired shape, not tolerated).
- Approval or acquisition attempted on a source-group (work-bundle) → **fail loud** (containers are not fetchable works).
- A Source's `threads: [id]` referencing a thread absent from `bibliography/scopes.yml` → **fail loud**.
- A search scope pointing at a nonexistent id of any kind → **fail loud** (no fabricated scope).
- Measured closure asked about a `work` scope that has been acquired but not fully searched across repositories → **not** auto-closed; closure remains search-evidence-based.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST model a search/coverage **Scope** as a discriminated reference `ScopeRef { kind, id }` with `kind ∈ { case, thread, work-bundle, work }` — NOT a single persisted entity.
- **FR-002**: The system MUST resolve and **validate every `ScopeRef` fail-loud under its declared kind**: `work` → a fetchable, non-container Source (`kind != source-group`); `work-bundle` → a `kind: source-group` Source; `thread` → an entry in `bibliography/scopes.yml`; `case` → the stable slug `port-breton`. A `ScopeRef` whose `id` does not resolve under its kind MUST be rejected loud.
- **FR-003**: The system MUST treat an existing **source-group as the `work-bundle` scope kind** by reinterpretation — no data migration; existing on-disk data (source-groups, classified works, reconciled statuses, the pre-existing search-log entry) MUST stay valid.
- **FR-004**: The search-log MUST target a `ScopeRef` (a `scope:` field); the loader and coverage MUST read **only** the `scope:` shape and MUST reject a `campaign:` key as a hard error (fail loud) — no dual-schema, no tolerated alias.
- **FR-005**: The single pre-existing search-log entry (SRCH-0001) MUST be rewritten to the `scope:` shape as a **clean one-time cutover** (a hand-edit of the one entry, NOT a `bib migrate`), preserving its content.
- **FR-006**: The **case scope MUST have the stable id `port-breton`**, so every persisted `ScopeRef` is resolvable and a future second case needs no migration.
- **FR-007**: `approved-for-acquisition` and the approve path MUST apply **only to fetchable work Sources** (`isFetchableWork(source)` = not a work-bundle scope), independent of group membership; a source-group MUST remain un-approvable and un-acquirable (fail loud) — the existing container prohibition is preserved.
- **FR-008**: The evidence-class distribution in `bib coverage` MUST count **works only** (`kind: source-group` excluded); a container MUST NOT be reported as `unclassified` or as a work.
- **FR-009**: `bib coverage` MUST report search history and measured-closure **per scope** (case/thread/work-bundle/work), each `ScopeRef` resolved to its referent (fail loud on an unresolved ref).
- **FR-010**: Thread membership MUST be authored in **one direction — on the Source** (`threads: [ids]`), with reverse membership derived (the existing `partOf` precedent; no fact stored twice). The thread registry `bibliography/scopes.yml` MUST own thread **identity + description only**, never a member list.
- **FR-011**: The `threads:` Source field and the `bibliography/scopes.yml` registry MUST be **defined and validated but NOT populated** by this build (no thread is required to exist; an empty registry is valid).
- **FR-012**: Measured closure MUST be **explicit and evidence-based for every scope kind — never inferred from acquisition**. A `work` scope MAY have simpler closure criteria (all repository copies searched, each acquired-or-documented) but MUST still close on search evidence, not on a single acquisition.
- **FR-013**: The implementation MUST honor the **clean-breaks constraint** everywhere: no transitional dual-representation, back-compat shim, or tolerated legacy key; every cutover fails loud on the retired shape.

### Key Entities *(include if feature involves data)*

- **ScopeRef**: a discriminated reference `{ kind, id }` (`case | thread | work-bundle | work`); the unit a search is logged against and measured-closure is asked about. Resolved across existing stores; never itself a single persisted table.
- **Thread**: a registry entry in `bibliography/scopes.yml` — `id`, `name`, `description` (identity + description only; no member list). A cross-cutting research scope. Not populated by this build.
- **Source** (existing, extended): gains a one-directional `threads: [ids]` field. The `work` vs `work-bundle` distinction is `kind != source-group` vs `kind == source-group`. Approval (`approved-for-acquisition`) applies only to fetchable works.
- **SearchLogEntry** (existing, cut over): targets `scope: ScopeRef` (replacing the retired `campaign:` group id).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A search can be logged against a `work`, `case`, or `thread` scope (not only a source-group) — the previously-strandable standalone-source searches (6 of 13) become loggable.
- **SC-002**: With every fetchable work classified, the `bib coverage` evidence-class `unclassified` bucket is **0** (the two containers are excluded, not force-classified).
- **SC-003**: A standalone work can be approved and acquired; a source-group cannot (approval/acquisition on a container fails loud).
- **SC-004**: `bib coverage` reports search history per scope, and **every persisted `ScopeRef` resolves** under its declared kind (no dangling or kind-mismatched reference survives).
- **SC-005**: **Zero `campaign:` keys** remain in the search-log and the loader rejects a `campaign:` key fail-loud — the clean break is verifiable, no dual-schema.
- **SC-006**: `bib validate` is clean after the cutover, and all pre-existing data (source-groups, classified works, reconciled statuses, the rewritten SRCH-0001) remains valid — the reinterpretation broke nothing.

## Assumptions

- Reuses and **extends** the shipped `bibliography` / `coverage` / `source-group` tooling (spec 004/006/007); does not replace it.
- Exactly one case (`port-breton`) exists for now; a `case` scope resolves to that slug.
- Threads are **defined, not populated** — the analysis-theme threads are later research; an empty `scopes.yml` is valid.
- The suspected-lead **`resolution` state** and the **three-state `knownMemberCount`** (`unexamined`/`irreducible`) — TASK-25 — are a **separate** spec, out of scope here.
- No UI — CLI / `bib coverage` output only (Constitution XI N/A).
- The clean-breaks governing constraint is non-negotiable and overrides any inclination toward a compatibility window.
- Code feature: TypeScript via `tsx`, `@/` imports, no `any`/`as`/`@ts-ignore`, files ≤ 300–500 lines, `vitest` test-first (Constitution VI/VII).
