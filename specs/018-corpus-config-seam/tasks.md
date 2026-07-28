# Tasks: Corpus Config Seam

**Feature dir**: `specs/018-corpus-config-seam/` · **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

A disciplined refactor + new config layer. **Behavior-preserving for Port Breton; proven by a synthetic second corpus.** Test-first (Constitution VII); `@/`, no `any`, files ≤ 300–500; composition/DI, narrow immutable policies, no service locator. Commit + push per unit. Revised after the spec review; task ids renumbered sequentially and model tiers declared after `/speckit-analyze`.

**Model tiers**: each task declares `[tier:<label>]` resolved through the installation `tier_map` (`fast` / `balanced` / `powerful`). Tiers are operator data — adjust freely.

## Phase 1: Setup — characterization gate + command scope (FIRST)

- [ ] T001 [tier:balanced] Capture the **characterization fixture**: snapshot every relevant `archive/location.ts` output for the **9 legacy Port Breton Sources** (`PB-P001/002/003/054/055/056/057/058/059`) and commit it as the byte-identical gate — before `SOURCE_LAYOUTS` is touched.
- [ ] T002 [tier:balanced] Produce the **corpus-dependent command table** (FR-014): classify every `bib`/CLI command as corpus-dependent vs exception (`bib validate-config`, help/version, non-corpus diagnostics); record it in the plan.

## Phase 2: Foundational — the `corpus/` seam (blocking)

- [ ] T003 [P] [tier:balanced] `CorpusManifest` type + typed loader in `src/corpus/manifest.ts` — `loadCorpusManifest(corporaRoot, id)` + `listCorpusManifests(corporaRoot)` reading `<corporaRoot>/<id>.yml` (discriminated `schemaVersion`; `basename==id`; fields incl. `requiredCapabilities`, `archiveLayoutOverrides`). **`corporaRoot` is a parameter — never a module literal** (FR-016). Tests: rejects unsupported version / malformed / id-mismatch; loads from an arbitrary injected root.
- [ ] T004 [P] [tier:balanced] `BrowserProfile` type + loader in `src/corpus/browser-profile.ts` — `loadBrowserProfile(corporaRoot, id)` reading `<corporaRoot>/<id>.browser.yml`, beside the manifest under the same injected root (FR-005/016); tests.
- [ ] T005 [P] [tier:powerful] Config validator in `src/corpus/validate.ts` — `validateCorpora(corporaRoot, sourcesDir, installedCapabilities)`: per-manifest (schema, id/basename, ≥1 case, case-id grammar, prefix grammar, `padWidth ∈ 1..8`), **repository-wide** over every manifest enumerated under `corporaRoot` (unique corpus ids; **prefix disjointness** — none equal/leading-substring of another; unique case ids; browser-profile→known-corpus + unique profile ids; override→known Source/relative/no-escape/reason), **existing-data** from `sourcesDir` (global Source-ID uniqueness, per-corpus conformance, next-ID non-collision), and **capability subset** at selection; tests for every failure (INV-2/7/9/10/11/12, SC-005). **Strict policy**: all committed manifests valid before any corpus runs. **Add a pad-overflow rule** (flagged by T023): an allocator running past `10^padWidth - 1` writes e.g. `PB-P1000.yml`, which no exact-width policy shape can see — silent invisibility one layer down. Gate it here.
- [ ] T006 [P] [tier:balanced] `selectCorpus({cliCorpus, envCorpus})` in `src/corpus/select.ts`: `--corpus` → `COLONY_CORPUS` → **throw**; unknown → throw; tests (INV-1/3).
- [ ] T007 [P] [tier:balanced] Narrow policy derivation in `src/corpus/policies.ts` (`deriveScopeContext`/`deriveSourceIdPolicy`/`deriveArchiveLayoutPolicy`/`deriveBrowserProfile`) returning **immutable** collections; unit tests. No omnibus object exported. `deriveArchiveLayoutPolicy` **precomputes** `derived: ReadonlyMap<SourceId, SourceLayout>` from the corpus's loaded Sources alongside `overrides` — required because `sourceLayout(sourceId)` is sourceId-only + synchronous while `deriveSourceLayout` needs a full `Source` (FR-017).
- [ ] T008 [tier:balanced] Author `corpora/port-breton.yml` (+ `requiredCapabilities`; `archiveLayoutOverrides: null` pending T013) and `corpora/port-breton.browser.yml`, from the current constants — instance #1. **Two `sourceIds` policies** (FR-002b): `PB-P`/pad 3 `allocatable: true` (92 primary sources) and `PB-S`/pad 3 `allocatable: false` (`PB-S001`, `PB-S002` secondary works). Must pass `validateCorpora` against the REAL `bibliography/sources` — that run is the acceptance check.
- [ ] T022 [tier:balanced] (added mid-execution; runs with Phase 2) Fold FR-002b into the shipped seam: `sourceIds` becomes a non-empty list of `{prefix, padWidth, allocatable}` in `src/corpus/manifest.ts`; `src/corpus/validate.ts` checks exactly-one-allocatable, conformance against **any** policy, and disjointness across **all** policies of all corpora. Update existing tests + fixtures; add INV-15 cases.

## Phase 3: User Story 1 — Explicit corpus selection (P1)

- [ ] T009 [US1] [tier:powerful] Wire `selectCorpus` at the CLI composition root; add `--corpus`; **resolve `corporaRoot` once here** (production `<repoRoot>/corpora`) and inject it into loader/validator (FR-016); derive + inject narrow policies; exception commands bypass selection (T002 table).
- [ ] T010 [US1] [tier:balanced] Integration test: no/unknown corpus fail loud (non-zero, never partial, SC-002); `--corpus` overrides env; an exception command runs with no selection (US1.5).

## Phase 4: User Story 2 — Port Breton behavior-preserving (P1)

- [ ] T011 [US2] [tier:balanced] `bibliography/scope.ts`: `PORT_BRETON_CASE_ID` → injected `validCaseIds`.
- [ ] T012 [US2] [tier:balanced] `sourcegroup/id-alloc.ts`: module constants → injected `SourceIdPolicy`.
- [ ] T013 [US2] [tier:powerful] `archive/location.ts`: retire **only** the static `SOURCE_LAYOUTS` map behind the characterization gate (T001). Implement the FR-017 total resolution order — manifest `archiveLayoutOverrides` → **runtime overlay** → **precomputed** generic derivation → **throw**. **Retain unchanged**: `registerSourceLayout` (incl. fail-loud conflict detection), `isSourceLayoutRegistered`, `deriveSourceLayout` — `member-layout.ts` (`ensureMemberLayoutRegistered`) and the acquire pipeline depend on them. Add a **validated per-`Source` override (with reason)** ONLY where a path is not byte-reproducible; characterization test passes; a mid-run member still resolves exactly as before (SC-001, INV-4/10/14).
- [ ] T023 [US2] [tier:powerful] (added mid-execution; runs with Phase 4, before T017) **Fifth seam (FR-018)**: `bibliography/load.ts` — retire `SOURCE_FILE_PATTERN`; `loadAllSources` takes a **required** injected `SourceFilenamePolicy` (no default — a default is the silent fallback that hides a second corpus). Add `deriveSourceFilenamePolicy` to `src/corpus/policies.ts`; thread the policy through every call site from the composition root. Tests: a `SYN-001.yml` under a synthetic policy IS enumerated; Port Breton enumeration is unchanged (94 records) (INV-16, SC-004).
- [ ] T014 [US2] [tier:balanced] `browser/config.ts`: default list → injected `BrowserProfile` (`CORPUS_SOURCES` override preserved; absence OK for non-browser commands). **Also owns the browser/site-build composition root** (`site:build`) — selecting the corpus and deriving `BrowserDefaultsPolicy` there, since no CLI command consumes browser defaults (FR-014 table) and T009 scoped only the CLI entrypoints. Flagged by T009 as otherwise falling between the two tasks. **Also revisit `bibliography/coverage/load-coverage-report.ts`**: T011 gave it `validCaseIds` as the union across ALL committed manifests (no per-corpus binding, since that loader has no `--corpus` concept). That is behavior-identical while one manifest exists, but it is a union-of-all-corpora reading that a second corpus makes wrong — bind it to the selected corpus here.
- [ ] T024 [US2] [tier:balanced] (added mid-execution; REGRESSION FIX found by T015) `deriveArchiveLayoutPolicy` fills `derived` from every Source in the corpus's cases with no `kind` filter, so the three `source-group` CONTAINERS (`PB-P004`, `PB-P006`, `PB-P060`) now resolve to a phantom monograph layout instead of throwing. Pre-feature they threw; FR-017 step 4 is **throw, no default**. Filter source-groups out of `derived`, and EXTEND the T001 characterization gate to cover the three group ids so it cannot regress again (the gate missed this because none of its 9 sources is a container).
- [ ] T015 [US2] [tier:powerful] Full regression under `--corpus port-breton`: suite green; `bib validate` clean; **structured coverage-snapshot comparison** (counts/statuses/leads/extents/holdings/ordering/ids/links) identical; no data migration (SC-001).

## Phase 5: User Story 3 — Second corpus as fixtures, zero core edits (P2) — load-bearing proof

- [ ] T016 [US3] [tier:balanced] Add the **synthetic second corpus as FIXTURES**, under the **same convention as production** (manifest + profile beside it, one root): `tests/fixtures/corpora/synthetic.yml` + `tests/fixtures/corpora/synthetic.browser.yml` + `tests/fixtures/cases/<second-case>/…` (different id, case id, source prefix, browser policy; no real content). NOT under `corpora/` — FR-015 would bind it into the production disjointness namespace.
- [ ] T017 [US3] [tier:powerful] Integration test: run the **same composition path** with `corporaRoot` injected at `tests/fixtures/corpora` (FR-016); scope/id/layout/browser all use its policies; a synthetic ID allocates with its (disjoint) prefix/pad and is globally unique; **enforced via the fixture layout, not git-diff** — adding the corpus touched only fixtures (SC-003, INV-5/13).

## Phase 6: User Story 4 — Config validation gate (P2)

- [ ] T018 [US4] [tier:powerful] `bib validate-config` verb (full, all manifests + profiles + overrides) + **startup validation** for the selected corpus (selected-manifest + global-identity index + capability subset); tests for every FR-008/FR-002a/FR-007 condition (SC-005, INV-2/7/9/10/11/12).

## Phase 7: Polish & guards

- [ ] T019 [P] [tier:fast] Guard test: none of the **five** corpus-specific constants remain as literals in core modules (incl. `SOURCE_FILE_PATTERN`, FR-018), **and no core module hardcodes the corpora root** (SC-004, INV-6/13/16).
- [ ] T020 [P] [tier:fast] Guard test: no spec-2 field (`discoveryMechanism`/`dateNormalizer`) in spec-1 types (INV-8, FR-012). **Also mechanize FR-007's last clause** — an `archiveLayoutOverride` is present ONLY where the generic derivation differs from the characterized legacy output. T013 upheld this by hand (7 of 9 reproduce generically; only PB-P002/PB-P003 needed overrides); it is checkable against the T001 fixture and is currently enforced nowhere.
- [ ] T021 [P] [tier:balanced] Docs: `corpora/README.md` (manifest + browser profile + overrides + selection + validation + the strict policy). Commit + push per unit.

## Dependencies & order

- **T001/T002 first**; foundational (T003–T008) → user-story phases.
- **P1 = MVP**: US1 + US2 (seam exists, Port Breton byte-identical). US3 proves it; US4 hardens integrity.
- US3 (T017) depends on US1/US2 + T016; US4 (T018) depends on the validator (T005).

## Parallel opportunities

- T003/T004/T005/T006/T007 (independent `corpus/` units) [P]; the four hotspot edits (T011–T014) once policies (T007) exist; guards T019/T020 [P].

## MVP scope

**US1 + US2** (P1): the composition-time selection seam (fail loud, no default) + Port Breton byte-identical. US3 proves the seam with a fixture-only synthetic corpus; US4 hardens config integrity (disjoint namespaces, capability + override + profile validation).
