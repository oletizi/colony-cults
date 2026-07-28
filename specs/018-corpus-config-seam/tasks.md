# Tasks: Corpus Config Seam

**Feature dir**: `specs/018-corpus-config-seam/` · **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

A disciplined refactor + new config layer. **Behavior-preserving for Port Breton; proven by a synthetic second corpus.** Test-first (Constitution VII); `@/` imports, no `any`, files ≤ 300–500; composition/DI, narrow interfaces, no service locator. Commit + push per coherent unit.

## Phase 1: Setup — the characterization gate (do FIRST, before any edit)

- [ ] T001 Capture the **characterization fixture**: snapshot every relevant `src/archive/location.ts` output for the **9 legacy Port Breton Sources** (current behavior) and commit it as the byte-identical gate fixture. This must exist before `SOURCE_LAYOUTS` is touched.

## Phase 2: Foundational — the `corpus/` seam (blocking prerequisites)

- [ ] T002 [code] `CorpusManifest` type + typed loader in `src/corpus/manifest.ts` (discriminated `schemaVersion`); test: rejects unsupported version / malformed shape (fail loud).
- [ ] T003 [code] Config validator + repo-wide collision rules in `src/corpus/validate.ts`; tests: schema version, unique corpus id, ≥1 case, unique case ids (within + across manifests), valid + unique source-ID prefix, positive bounded pad, capability subset (INV-2/7, SC-005).
- [ ] T004 [code] `selectCorpus({cliCorpus, envCorpus})` in `src/corpus/select.ts`: precedence `--corpus` → `COLONY_CORPUS` → **throw**; unknown id → throw; tests (INV-1/3).
- [ ] T005 [code] Narrow policy derivation in `src/corpus/policies.ts` (`deriveScopeContext` / `deriveSourceIdPolicy` / `deriveArchiveLayoutPolicy` / `deriveBrowserProfile`); unit tests. **No omnibus object exported to consumers.**
- [ ] T006 Author `corpora/port-breton.yml` (schemaVersion 1; `cases: [port-breton]`; `sourceIds: {prefix: PB-P, padWidth: 3}`) from the current constants — instance #1.

## Phase 3: User Story 1 — Explicit corpus selection (P1)

**Goal**: one unambiguous active corpus, fail loud with no default. **Independent test**: `--corpus port-breton` runs; no selection fails loud; unknown corpus fails loud.

- [ ] T007 [US1] Wire `selectCorpus` at the CLI **composition root**; add the `--corpus` flag; derive + inject the narrow policies downward (no per-module env reads).
- [ ] T008 [US1] Integration test: no selected corpus and unknown corpus each fail loud (non-zero, descriptive), never partial (SC-002); `--corpus` overrides `COLONY_CORPUS`.

## Phase 4: User Story 2 — Port Breton behavior-preserving (P1)

**Goal**: zero data/behavior change for the live corpus. **Independent test**: full suite + `bib validate` + `bib coverage` identical; 9 legacy paths byte-identical.

- [ ] T009 [US2] `bibliography/scope.ts`: replace `PORT_BRETON_CASE_ID` with the injected `validCaseIds` (via `ScopeResolutionContext`).
- [ ] T010 [US2] `sourcegroup/id-alloc.ts`: replace module constants with the injected `SourceIdPolicy { prefix, padWidth }`.
- [ ] T011 [US2] `archive/location.ts`: retire `SOURCE_LAYOUTS` behind the characterization gate (T001) — route all through generic `deriveSourceLayout`; add a **validated per-`Source` override** ONLY where a path is not byte-reproducible; the characterization test (T001 fixture) passes (SC-001).
- [ ] T012 [US2] `browser/config.ts`: replace the default source list with the injected `BrowserProfile` (deployment policy; `CORPUS_SOURCES` override preserved).
- [ ] T013 [US2] Full regression under `--corpus port-breton`: existing suite green; `bib validate` clean; `bib coverage` semantically identical; **no canonical data migration** (SC-001).

## Phase 5: User Story 3 — Second corpus, zero core edits (P2) — the load-bearing proof

**Goal**: prove the constants were removed, not relocated. **Independent test**: a synthetic corpus is selectable with the diff touching only config/data/fixtures.

- [ ] T014 [US3] Add a **synthetic second corpus**: `corpora/_fixtures/synthetic.yml` (different id, case id, source prefix, browser-default policy) + a small fixture `Source`. No real research content.
- [ ] T015 [US3] Integration test: select the synthetic corpus; scope resolution, ID allocation, archive layout, and browser defaults all use ITS policies; a synthetic ID allocates with its prefix/pad and is globally unique; assert the change set touches **zero** core `src/` implementation modules (SC-003, INV-5).

## Phase 6: User Story 4 — Config validation gate (P2)

**Goal**: malformed/colliding config fails at the load boundary. **Independent test**: each failure condition rejected with a specific message; valid set passes.

- [ ] T016 [US4] `bib validate-config` CLI verb + **startup validation** for the selected corpus; tests for every FR-008 condition incl. repository-wide prefix/case-id collisions (SC-005, INV-7); startup fails loud on a referenced-but-unavailable capability.

## Phase 7: Polish & guards

- [ ] T017 [P] Guard test: none of the four corpus-specific constants (`port-breton` `SOURCE_LAYOUTS` entries, `PORT_BRETON_CASE_ID`, `PB-P` allocator literal, browser default list) remain as literals in core modules (SC-004, INV-6).
- [ ] T018 [P] Guard test: no spec-2 field (`discoveryMechanism` / `dateNormalizer`) appears in the spec-1 types (INV-8, FR-012).
- [ ] T019 [P] Docs: `corpora/README.md` (manifest shape + selection + validation); note the seam. Commit + push per unit (Principle IX).

## Dependencies & order

- **T001 first** (characterization fixture) — the byte-identical gate must predate the `location.ts` edit (T011).
- Foundational (T002–T006) → user-story phases.
- **P1 = MVP**: US1 (selection) + US2 (Port Breton unchanged) — the seam exists and the live corpus is preserved.
- US3 (T015) depends on US1/US2 + T014; US4 (T016) depends on the validator (T003).

## Parallel opportunities

- T002/T003/T004/T005 (independent `corpus/` units) → parallel [P].
- The four hotspot edits (T009/T010/T011/T012) are largely independent once the policies (T005) exist.
- Guard tests T017/T018 [P].

## MVP scope

**US1 + US2** (P1): the composition-time selection seam exists (fail loud, no default) and Port Breton runs byte-identically. US3 then *proves* the seam with a synthetic second corpus; US4 hardens config integrity.
