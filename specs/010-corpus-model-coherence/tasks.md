# Tasks: Corpus Model Coherence

**Feature dir**: `specs/010-corpus-model-coherence/` · **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

A CODE feature, **test-first** (`vitest`, RED→GREEN), TypeScript via `tsx`, `@/` imports, no `any`, files ≤ 300–500 lines. **Clean breaks only** (FR-013): no transitional/back-compat path, no tolerated legacy key — every cutover fails loud on the retired shape. Extends the shipped `bibliography` tree; NEVER `bib migrate`. Each task carries a `[tier:<label>]` (fast=haiku | balanced=sonnet | powerful=opus).

## Phase 1: Setup

- [ ] T001 [tier:fast] Capture baseline before any change: run `npx tsx src/index.ts bib validate` (expect clean) and `bib coverage`; note the pre-cutover evidence-class + search-history state (for the SC-002/005/006 before/after).

## Phase 2: Foundational (blocking — the Scope core; every user story depends on it)

- [ ] T002 [P] [tier:balanced] Write failing vitest for `isFetchableWork` (true for `monograph`/`periodical`; false for `source-group`) in `tests/unit/bibliography/scope.test.ts`.
- [ ] T003 [P] [tier:powerful] Write failing vitest for `resolveScopeRef` covering all four kinds and **every** fail-loud kind/referent mismatch — `{work, <a source-group>}`, `{work-bundle, <a non-group>}`, `{thread, <absent from scopes.yml>}`, `{case, !=port-breton}` (INV-1) in `tests/unit/bibliography/scope-resolve.test.ts`.
- [ ] T004 [tier:powerful] Implement the `ScopeRef` discriminated union + `resolveScopeRef(ref, corpus)` (fail-loud per data-model resolution table) + `isFetchableWork(source)` in `src/bibliography/scope.ts`; make T002/T003 green (INV-1, INV-3).
- [ ] T005 [tier:fast] Add `SCOPE_KIND_VALUES` (`case|thread|work-bundle|work`) to `src/bibliography/vocab.ts` (keep `EVIDENCE_CLASS_VALUES`).
- [ ] T006 [tier:balanced] Extend the model in `src/bibliography/model.ts`: add `Source.threads?: string[]`; change `SearchLogEntry` to carry `scope: ScopeRef` and **remove** `campaign` (type-only; consumers updated in their stories).
- [ ] T007 [P] [tier:balanced] Write failing vitest for the scopes-registry loader (parse `{id,name,description}`; empty list valid; fail loud on duplicate id / missing field / unknown key) in `tests/unit/bibliography/scopes-registry.test.ts`.
- [ ] T008 [tier:balanced] Implement `src/bibliography/scopes-registry.ts` (load + validate `bibliography/scopes.yml`); make T007 green.
- [ ] T009 [tier:fast] Create `bibliography/scopes.yml` as an empty list (`[]`) with a header comment stating the registry is defined but unpopulated this build (FR-011).

## Phase 3: User Story 1 — Search-log speaks Scope, clean-break cutover (P1)

**Goal**: log a search against any scope; `campaign:` is a hard error. **Independent test**: `scope: {kind: work, id: PB-P001}` accepted; `scope: {kind: work, id: PB-P004}` and any `campaign:` key rejected loud.

- [ ] T010 [P] [US1] [tier:balanced] Write failing vitest: the search-log loader **rejects a `campaign:` key** (INV-2), accepts a well-formed `scope:` entry, and validation fails loud when a `scope` does not resolve — `tests/unit/bibliography/search-log-scope.test.ts`.
- [ ] T011 [US1] [tier:balanced] Cut over `src/bibliography/search-log.ts`: parse **only** `scope:` into a `ScopeRef`; a `campaign:` or unknown top-level key **throws** (fail loud). No dual-schema, no alias.
- [ ] T012 [US1] [tier:balanced] Extend `src/bibliography/validate-search-log.ts`: each entry's `scope` MUST `resolveScopeRef` (fail loud); make T010 green.
- [ ] T013 [US1] [tier:fast] Rewrite the single existing entry SRCH-0001 in `bibliography/search-log.yml`: `campaign: PB-P004` → `scope: {kind: work-bundle, id: PB-P004}` (hand-edit of one entry — NOT `bib migrate`).

## Phase 4: User Story 2 — Works-only counting (P1)

**Goal**: the evidence-class distribution counts works only. **Independent test**: with 11 works classified + 2 groups, `unclassified 0`.

- [ ] T014 [P] [US2] [tier:balanced] Write failing vitest: evidence-class distribution over 11 works + 2 source-groups yields `unclassified 0`, the groups excluded (INV-4) — `tests/unit/bibliography/coverage-count.test.ts`.
- [ ] T015 [US2] [tier:balanced] Change `src/bibliography/coverage/coverage-model.ts`: the evidence-class distribution counts only `isFetchableWork` Sources (`kind: source-group` excluded, never `unclassified`, never a work); make T014 green (FR-008).

## Phase 5: User Story 3 — Fetchable-work approval (P2)

**Goal**: a standalone work is approvable/acquirable; a container is not. **Independent test**: approve PB-P002 → eligible; approve/acquire a source-group → rejected loud.

- [ ] T016 [P] [US3] [tier:balanced] Write failing vitest: the approve/acquire gate accepts a standalone work and **rejects a source-group loud** (INV-3 gate), independent of group membership — `tests/unit/bibliography/approve-gate.test.ts`.
- [ ] T017 [US3] [tier:balanced] Gate the promote/approve + acquire path on `isFetchableWork(source)` (reject a work-bundle loud, preserving the container prohibition; FR-007) in `src/sourcegroup/promote.ts` and `src/sourcegroup/acquire.ts` (the approval/acquire logic lives under `src/sourcegroup/`); make T016 green.

## Phase 6: User Story 4 — Per-scope coverage reporting (P2)

**Goal**: coverage reports per resolved scope. **Independent test**: search history lists a work scope and a work-bundle scope, each resolved; an unresolved ref fails the report loud.

- [ ] T018 [P] [US4] [tier:balanced] Write failing vitest: search history grouped **per resolved ScopeRef** (labeled by kind); a persisted ref that does not resolve fails the report loud (INV-SCOPE) — `tests/unit/bibliography/coverage-per-scope.test.ts`.
- [ ] T019 [US4] [tier:powerful] Change `src/bibliography/coverage/coverage-history.ts` + `coverage-render.ts`: key search history per `ScopeRef`, resolve each (fail loud on unresolved), render per-scope labeled by kind; measured-closure per scope is **search-evidence-based, never inferred from acquisition** (FR-009/FR-012); make T018 green.

## Phase 7: User Story 5 — Thread machinery defined, not populated (P3)

**Goal**: the `threads:` field + registry validate; an empty registry is valid; no thread is populated. **Independent test**: empty `scopes.yml` validates; a `threads:` id absent from the registry fails loud.

- [ ] T020 [P] [US5] [tier:balanced] Write failing vitest: an empty `scopes.yml` + no `threads` validates clean; a Source `threads: [id]` with `id` absent from the registry fails loud (INV-5) — `tests/unit/bibliography/threads-validate.test.ts`.
- [ ] T021 [US5] [tier:balanced] Extend `src/bibliography/load-coverage-fields.ts` + `validate-checks.ts`: parse + validate `Source.threads[]` (each id ∈ `scopes.yml`, fail loud); make T020 green (FR-010/FR-011). Populate NO thread.

## Phase 8: Polish & cross-cutting

- [ ] T022 [P] [tier:fast] Verify SC-005: `grep -c 'campaign:' bibliography/search-log.yml` is `0`; confirm the loader rejects a reintroduced `campaign:` (covered by T010).
- [ ] T023 [tier:balanced] Full-corpus validation (INV-6, SC-006): `bib validate` clean; `bib coverage` shows `unclassified 0` + per-scope search history; every pre-existing datum (source-groups, classified works, reconciled statuses, rewritten SRCH-0001) still valid; fix any drift.
- [ ] T024 [P] [tier:balanced] Clean-breaks audit (FR-013): grep the touched modules for any transitional/alias/back-compat path or tolerated legacy key; confirm **none**; then commit + push (Principle IX).

## Dependencies & order

- Setup (T001) → **Foundational (T002–T009)** → user-story phases → Polish.
- **T004 (`scope.ts`) is the linchpin** — it blocks every consumer of `resolveScopeRef`/`isFetchableWork` (T011, T012, T015, T017, T019, T021).
- T013 (SRCH-0001 rewrite) runs **after** T011/T012 (loader + validator speak `scope:`), so `bib validate` passes.
- US1 + US2 (P1) are the earliest complete increments; US3/US4/US5 (P2/P3) each depend only on Foundational + their own pieces.

## Parallel opportunities

- The RED test tasks are `[P]` across stories (T002, T003, T007, T010, T014, T016, T018, T020) — different files, no shared state.
- T005 / T009 (vocab const, empty registry file) are independent `[P]` foundational edits.

## MVP scope

**US1 + US2** (P1): the search-log `campaign:`→`scope:` clean-break cutover + works-only counting. This lands the load-bearing decoupling (search-scope off source-group) and the honest `unclassified 0`; US3/US4/US5 extend the model to approval, per-scope reporting, and the (unpopulated) thread machinery.
