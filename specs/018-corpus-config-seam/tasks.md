# Tasks: Corpus Config Seam

**Feature dir**: `specs/018-corpus-config-seam/` · **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

A disciplined refactor + new config layer. **Behavior-preserving for Port Breton; proven by a synthetic second corpus.** Test-first (Constitution VII); `@/`, no `any`, files ≤ 300–500; composition/DI, narrow immutable policies, no service locator. Commit + push per unit. Revised after the spec review.

## Phase 1: Setup — characterization gate + command scope (FIRST)

- [ ] T001 Capture the **characterization fixture**: snapshot every relevant `archive/location.ts` output for the **9 legacy Port Breton Sources** and commit it as the byte-identical gate — before `SOURCE_LAYOUTS` is touched.
- [ ] T001b Produce the **corpus-dependent command table** (FR-014): classify every `bib`/CLI command as corpus-dependent vs exception (`bib validate-config`, help/version, non-corpus diagnostics); record it in the plan.

## Phase 2: Foundational — the `corpus/` seam (blocking)

- [ ] T002 [code] `CorpusManifest` type + typed loader in `src/corpus/manifest.ts` (discriminated `schemaVersion`; `basename==id`; fields incl. `requiredCapabilities`, `archiveLayoutOverrides`); tests: rejects unsupported version / malformed / id-mismatch.
- [ ] T002b [code] `BrowserProfile` type + loader in `src/corpus/browser-profile.ts` (`corpora/<id>.browser.yml`); tests.
- [ ] T003 [code] Config validator in `src/corpus/validate.ts` — per-manifest (schema, id/basename, ≥1 case, case-id grammar, prefix grammar, `padWidth ∈ 1..8`), **repository-wide** (unique corpus ids; **prefix disjointness** — none equal/leading-substring of another; unique case ids; browser-profile→known-corpus + unique profile ids; override→known Source/relative/no-escape/reason), **existing-data** (global Source-ID uniqueness, per-corpus conformance, next-ID non-collision), and **capability subset** at selection; tests for every failure (INV-2/7/9/10/11/12, SC-005). **Strict policy**: all committed manifests valid before any corpus runs.
- [ ] T004 [code] `selectCorpus({cliCorpus, envCorpus})` in `src/corpus/select.ts`: `--corpus` → `COLONY_CORPUS` → **throw**; unknown → throw; tests (INV-1/3).
- [ ] T005 [code] Narrow policy derivation in `src/corpus/policies.ts` (`deriveScopeContext`/`deriveSourceIdPolicy`/`deriveArchiveLayoutPolicy`/`deriveBrowserProfile`) returning **immutable** collections; unit tests. No omnibus object exported.
- [ ] T006 Author `corpora/port-breton.yml` (+ `requiredCapabilities`; `archiveLayoutOverrides: null` pending T011) and `corpora/port-breton.browser.yml`, from the current constants — instance #1.

## Phase 3: User Story 1 — Explicit corpus selection (P1)

- [ ] T007 [US1] Wire `selectCorpus` at the CLI composition root; add `--corpus`; derive + inject narrow policies; exception commands bypass selection (T001b table).
- [ ] T008 [US1] Integration test: no/unknown corpus fail loud (non-zero, never partial, SC-002); `--corpus` overrides env; an exception command runs with no selection (US1.5).

## Phase 4: User Story 2 — Port Breton behavior-preserving (P1)

- [ ] T009 [US2] `bibliography/scope.ts`: `PORT_BRETON_CASE_ID` → injected `validCaseIds`.
- [ ] T010 [US2] `sourcegroup/id-alloc.ts`: module constants → injected `SourceIdPolicy`.
- [ ] T011 [US2] `archive/location.ts`: retire `SOURCE_LAYOUTS` behind the characterization gate (T001) — generic derivation; add a **validated per-`Source` override (with reason)** ONLY where a path is not byte-reproducible; characterization test passes (SC-001, INV-4/10).
- [ ] T012 [US2] `browser/config.ts`: default list → injected `BrowserProfile` (`CORPUS_SOURCES` override preserved; absence OK for non-browser commands).
- [ ] T013 [US2] Full regression under `--corpus port-breton`: suite green; `bib validate` clean; **structured coverage-snapshot comparison** (counts/statuses/leads/extents/holdings/ordering/ids/links) identical; no data migration (SC-001).

## Phase 5: User Story 3 — Second corpus as fixtures, zero core edits (P2) — load-bearing proof

- [ ] T014 [US3] Add the **synthetic second corpus as FIXTURES**: `tests/fixtures/corpora/synthetic.yml` + `tests/fixtures/browser-profiles/synthetic.yml` + `tests/fixtures/cases/<second-case>/…` (different id, case id, source prefix, browser policy; no real content).
- [ ] T015 [US3] Integration test: run the **same composition path** against the fixture root; scope/id/layout/browser all use its policies; a synthetic ID allocates with its (disjoint) prefix/pad and is globally unique; **enforced via the fixture layout, not git-diff** — adding the corpus touched only fixtures (SC-003, INV-5).

## Phase 6: User Story 4 — Config validation gate (P2)

- [ ] T016 [US4] `bib validate-config` verb (full, all manifests + profiles + overrides) + **startup validation** for the selected corpus (selected-manifest + global-identity index + capability subset); tests for every FR-008/FR-002a/FR-007 condition (SC-005, INV-2/7/9/10/11/12).

## Phase 7: Polish & guards

- [ ] T017 [P] Guard test: none of the four corpus-specific constants remain as literals in core modules (SC-004, INV-6).
- [ ] T018 [P] Guard test: no spec-2 field (`discoveryMechanism`/`dateNormalizer`) in spec-1 types (INV-8, FR-012).
- [ ] T019 [P] Docs: `corpora/README.md` (manifest + browser profile + overrides + selection + validation + the strict policy). Commit + push per unit.

## Dependencies & order

- **T001/T001b first**; foundational (T002–T006) → user-story phases.
- **P1 = MVP**: US1 + US2 (seam exists, Port Breton byte-identical). US3 proves it; US4 hardens integrity.
- US3 (T015) depends on US1/US2 + T014; US4 (T016) depends on the validator (T003).

## Parallel opportunities

- T002/T002b/T003/T004/T005 (independent `corpus/` units) [P]; the four hotspot edits (T009–T012) once policies (T005) exist; guards T017/T018 [P].

## MVP scope

**US1 + US2** (P1): the composition-time selection seam (fail loud, no default) + Port Breton byte-identical. US3 proves the seam with a fixture-only synthetic corpus; US4 hardens config integrity (disjoint namespaces, capability + override + profile validation).
