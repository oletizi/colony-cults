# Tasks: Corpus Coverage & Discovery Audit

**Feature**: `specs/007-corpus-coverage-audit/` | **Branch**: `feature/corpus-coverage-audit`

**Input**: [spec.md](./spec.md), [plan.md](./plan.md), [data-model.md](./data-model.md),
[contracts/](./contracts/), [research.md](./research.md), [quickstart.md](./quickstart.md)

Every task carries a `[tier:<label>]` tag (`stack-control-model-tier-v1`), resolved by this
installation's `tier_map` at `resolve-tiers`: `fast`→haiku, `balanced`→sonnet, `powerful`→opus.
Heuristic: mechanical/RED-test/doc → `fast`; standard implementation → `balanced`;
cross-cutting/architectural/high-blast-radius → `powerful`.

Conventions: `[P]` = parallelizable (different files, no incomplete deps). Tests are RED-first
(TDD, project convention). All paths are repo-relative.

---

## Phase 1: Setup

- [ ] T001 [P] [tier:fast] Add a synthetic coverage test fixture under `tests/fixtures/coverage/` — a small bibliography (2 campaigns, members across lifecycle states, one work with two RepositoryRecords, `references[]` resolved + unresolved, an uncampaigned source with a reference, `suspected[]`, `knownMemberCount` number + `unknown`) plus a `search-log.yml` fixture.

---

## Phase 2: Foundational (blocking prerequisites — MUST complete before user stories)

- [ ] T002 [P] [tier:balanced] Add `EVIDENCE_CLASS_VALUES` and `CITED_KIND_VALUES` closed-extensible vocabularies plus `isEvidenceClass` / `isCitedKind` predicates in `src/bibliography/vocab.ts` (mirroring the shipped `RIGHTS_VALUES` / `isAllowed` style).
- [ ] T003 [P] [tier:balanced] Extend the `Source` type with optional `evidenceClass` and `references?: Reference[]` (new `Reference` type: `citedAs`, `citedKind?`, `basis?`, `resolvedTo?`, `notes?`) in `src/model/source.ts`.
- [ ] T004 [tier:balanced] Add the `SearchLogEntry` type and an append-only loader for `bibliography/search-log.yml` in `src/bibliography/search-log.ts` (fail loud on malformed/missing-required-field entries).
- [ ] T005 [tier:powerful] Wire the new authored fields through the loader — `Source.evidenceClass`/`references[]` and source-group `knownMemberCount`/`suspected[]` — in `src/bibliography/load-fields.ts` and `src/bibliography/load.ts`, preserving existing load behavior (fields optional/additive).
- [ ] T006 [tier:balanced] Add the `coverage` subaction (with `--json` flag parsing) to the `bib` CLI dispatch in `src/cli/bibliography.ts`, delegating to a new `src/bibliography/coverage/` module.
- [ ] T007 [tier:powerful] Create the coverage projection skeleton `src/bibliography/coverage/coverage-model.ts` (pure `CoverageReport` builder over the loaded model — no I/O) and renderer `src/bibliography/coverage/coverage-render.ts` (text + `--json`), rendering all section headers deterministically even when empty.

**Checkpoint**: `bib coverage` runs over the current corpus and prints well-formed (possibly
empty) sections; new fields load without breaking existing bibliography validation.

---

## Phase 3: User Story 1 — Generate the coverage report (Priority: P1) 🎯 MVP

**Goal**: One command yields per-campaign counts and the report shell, per-work counting, with
explicit `unknown`s and no coverage percentage.

**Independent test**: `bib coverage` / `--json` over the fixture and current corpus → correct
per-campaign counts, per-work counting, explicit unknowns, no `%`, writes nothing.

- [ ] T008 [P] [US1] [tier:fast] RED: unit tests for per-campaign lifecycle counts and per-work counting (a work with two RepositoryRecords counts once; copies reported separately) in `tests/unit/coverage/counts.test.ts`.
- [ ] T009 [P] [US1] [tier:fast] RED: integration test — `bib coverage` text + `--json` over the fixture asserts explicit `unknown`, no headline `%` (INV-1/INV-2), per-work counting (INV-3), and a clean working tree after run (INV-4) in `tests/integration/coverage-report.test.ts`.
- [ ] T010 [US1] [tier:powerful] Implement per-campaign counts in `coverage-model.ts` — members by lifecycle state, derived `actualMemberCount` (per work), authored `knownMemberCount` (or `unknown` when absent), and `gap` as a number **or** the literal `unknown`; implement the per-work counting rule (dedupe multi-archive works; separate `copiesByArchive`).
- [ ] T011 [US1] [tier:balanced] Implement text + `--json` rendering of the report shell and per-campaign section in `coverage-render.ts`, enforcing the no-headline-`%` and explicit-`unknown` invariants; render empty register/history/distribution section headers cleanly.
- [ ] T012 [US1] [tier:balanced] Determinism/regenerability test — two runs produce identical output and no file is written (SC-004, INV-5) in `tests/integration/coverage-determinism.test.ts`.

**Checkpoint**: MVP shippable — the report generates honestly over today's corpus.

---

## Phase 4: User Story 2 — Record and resolve a citation (Priority: P1)

**Goal**: Unresolved citations populate the register (by campaign + ungrouped bucket); resolution
is a single edge; `citedKind`/`resolvedTo` validated.

**Independent test**: add a `references[]` entry (no `resolvedTo`) → appears in register; set
`resolvedTo` → drops out; dangling `resolvedTo` → validation fails loud.

- [ ] T013 [P] [US2] [tier:fast] RED: validation tests for `citedKind` vocab (V2) and dangling `resolvedTo` (V3) in `tests/unit/validate-references.test.ts`.
- [ ] T014 [P] [US2] [tier:fast] RED: register-projection test — unresolved references grouped by campaign, with the explicit ungrouped ("no campaign") bucket for references on sources lacking `partOf` (FR-012) in `tests/unit/coverage/register.test.ts`.
- [ ] T015 [US2] [tier:balanced] Add validation checks V2 (`citedKind` ∈ `CITED_KIND_VALUES`) and V3 (`references[].resolvedTo` resolves to an existing `sourceId`) to `src/bibliography/validate-checks.ts`, failing loud with the offending value + sourceId.
- [ ] T016 [US2] [tier:balanced] Implement the unresolved-references register in `coverage-model.ts` (unresolved `references[]` grouped by campaign + ungrouped bucket) and render it in `coverage-render.ts`.

---

## Phase 5: User Story 3 — Record a suspected (inferred) gap (Priority: P2)

**Goal**: `suspected[]` gaps surface in the register under their campaign with `basis` preserved;
group-only placement enforced.

**Independent test**: add a `suspected[]` entry with `basis` → appears under its campaign;
authoring it on a non-group source → validation fails loud.

- [ ] T017 [P] [US3] [tier:fast] RED: test that `suspected[]` on a non-source-group fails loud (V4) in `tests/unit/validate-group-only.test.ts`, and that suspected gaps render in the register with `basis`.
- [ ] T018 [US3] [tier:balanced] Add validation check V4 (`suspected` valid only on `kind: source-group`) to `src/bibliography/validate-checks.ts`.
- [ ] T019 [US3] [tier:balanced] Extend the register projection + render to include `suspected[]` entries (with `basis`) grouped by campaign in `coverage-model.ts` / `coverage-render.ts`.

---

## Phase 6: User Story 4 — Believed extent with explicit unknown (Priority: P2)

**Goal**: `knownMemberCount` renders the per-campaign gap as a number or the literal `unknown`,
distinct from `0`/`incomplete`; validated as group-only int|`unknown`.

**Independent test**: set `knownMemberCount` to a number then `unknown` → gap renders number then
literal `unknown`; bad type or non-group placement → fails loud.

- [ ] T020 [P] [US4] [tier:fast] RED: tests for gap semantics (`unknown` ≠ `incomplete` ≠ `0`; absent → `unknown`) and validation V4/V5 (group-only; non-negative integer or literal `unknown`) in `tests/unit/known-member-count.test.ts`.
- [ ] T021 [US4] [tier:balanced] Add validation check V5 (`knownMemberCount` is a non-negative integer or the literal `'unknown'`; group-only via V4) to `src/bibliography/validate-checks.ts`.
- [ ] T022 [US4] [tier:balanced] Ensure the per-campaign gap rendering treats absent `knownMemberCount` as `unknown` and keeps `unknown`/`0` distinct in `coverage-model.ts` / `coverage-render.ts`.

---

## Phase 7: User Story 5 — Log a repository search (Priority: P2)

**Goal**: Search-log entries surface in the repository × campaign matrix and the repository-axis
rollup; ids unique and entries well-formed.

**Independent test**: append an entry → appears in both search views; duplicate `id` → validation
fails loud.

- [ ] T023 [P] [US5] [tier:fast] RED: tests for search-log uniqueness (V6) and required fields (V7), and for the matrix + repository-axis rollup projection in `tests/unit/coverage/search-history.test.ts`.
- [ ] T024 [US5] [tier:balanced] Add validation checks V6 (unique `id`) and V7 (required entry fields) for `search-log.yml`, wired into the bibliography validate flow.
- [ ] T025 [US5] [tier:balanced] Implement the repository × campaign matrix (last-searched date, open questions) and the repository-axis rollup in `coverage-model.ts`; render both in `coverage-render.ts`.

---

## Phase 8: User Story 6 — Classify a source's evidence class (Priority: P3)

**Goal**: `evidenceClass` counts into the corpus-wide distribution (incl. `unclassified`);
out-of-vocab values fail loud.

**Independent test**: set `evidenceClass` → counted in distribution; out-of-vocab → fails loud.

- [ ] T026 [P] [US6] [tier:fast] RED: tests for evidence-class validation V1 and the distribution projection (incl. `unclassified` for absent) in `tests/unit/coverage/evidence-class.test.ts`.
- [ ] T027 [US6] [tier:balanced] Add validation check V1 (`evidenceClass` ∈ `EVIDENCE_CLASS_VALUES`) to `src/bibliography/validate-checks.ts`.
- [ ] T028 [US6] [tier:balanced] Implement the corpus-wide evidence-class distribution (with `unclassified`) in `coverage-model.ts` and render it in `coverage-render.ts`.

---

## Phase 9: Polish & Cross-Cutting

- [ ] T029 [P] [tier:fast] Run the full [quickstart.md](./quickstart.md) validation scenarios against `PB-P004` (the trial-records campaign) and confirm every command works unchanged on a second source-group — no PB-P004 special-casing (SC-007).
- [ ] T030 [P] [tier:fast] Confirm `tsc --noEmit` clean (no `any`/`as`/`@ts-ignore`) and all new modules ≤300–500 lines; split `coverage-model.ts`/`coverage-render.ts` further if over.
- [ ] T031 [tier:balanced] Author an example `bibliography/search-log.yml` seed entry (or `.gitkeep`) and document the `bib coverage` command + new authored fields in the bibliography README/notes (no derived output committed).

---

## Dependencies & execution order

- **Phase 1 → Phase 2 → Phase 3 (MVP)**; Phases 4–8 depend on Phase 2 foundational substrate and
  extend the Phase 3 report projection/render (so run after US1, but are independent of each
  other and may proceed in parallel once US1 lands).
- **Foundational (Phase 2)** blocks everything: T005 (loader wiring) depends on T002/T003/T004;
  T007 (projection skeleton) depends on T005/T006.
- **Within a story**: RED tests (fast) precede implementation; validation-check tasks and
  projection/render tasks touch shared files (`validate-checks.ts`, `coverage-model.ts`,
  `coverage-render.ts`) so are sequential within their story, `[P]` only across distinct files.
- **Polish (Phase 9)** last.

## Parallel opportunities

- Setup: T001 alone.
- Foundational: T002 ∥ T003 (distinct files), then T004, then T005, then T006, then T007.
- Per story: the RED test tasks (`[P]`) run together; implementation tasks that touch the shared
  `coverage-model.ts`/`validate-checks.ts` serialize.
- Across stories US2–US6: once US1 is done, each story's RED tests can be written in parallel.

## Implementation strategy

MVP = Phase 1 + Phase 2 + Phase 3 (US1): a working, honest coverage report over today's corpus.
Then layer US2 (citations/register) and US4 (believed extent) — the highest-value inputs — then
US3, US5, US6. Each story is an independently testable increment; validation always fails loud.
