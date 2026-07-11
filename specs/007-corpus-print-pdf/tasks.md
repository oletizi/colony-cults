---
description: "Task list for Corpus Print PDF (spec 007)"
---

# Tasks: Corpus Print PDF

**Input**: Design documents from `specs/007-corpus-print-pdf/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (all present)

**Tests**: INCLUDED — the contracts define numbered testable guarantees with fixtures, and the repo's
data layers are test-covered (the `browser:test` split). Test tasks are written to FAIL first (TDD).

**Organization**: grouped by user story (US1 = single-item edition, P1 MVP; US2 = batch build, P2).
The deferred public-domain export (former US3) is out of scope (spec Clarification 2026-07-11).

## Format: `[ID] [P?] [Story] [tier:<label>] Description with file path`

- **[P]**: parallelizable (different files, no incomplete-task dependency)
- **[Story]**: US1 / US2 (user-story phases only; setup/foundational/polish carry none)
- **[tier:<label>]**: model tier — `fast`→haiku, `balanced`→sonnet, `powerful`→opus (per
  `stack-control-model-tier-v1`); resolved by `tier_map` at `resolve-tiers` time.

## Path Conventions

Single project, repo root: `src/pdf/`, `scripts/`, `pdf/template/`, `tests/unit/pdf/`,
`tests/integration/pdf/`. Reuses `@/browser`, `@/archive`, `@/bibliography`, `@/model`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: project wiring so the new domain layer and its build/test verbs exist.

- [ ] T001 [tier:fast] Add `"pdf:build": "tsx scripts/build-pdf.ts"` and `"pdf:test": "vitest run tests/unit/pdf tests/integration/pdf"` scripts to `package.json`
- [ ] T002 [P] [tier:fast] Create the directory skeleton: `src/pdf/{load,images,render}/`, `pdf/template/fonts/`, `tests/unit/pdf/`, `tests/integration/pdf/` (with `.gitkeep` where empty)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: shared types, config, and the snapshot extension every story depends on.

**⚠️ CRITICAL**: no user-story work begins until this phase is complete.

- [ ] T003 [tier:powerful] Define pure view-model types in `src/pdf/model.ts` (`Edition`, `EditionPage`, `ImageAsset`, `TitlePageMeta`, `ColophonMeta`, `ColophonImage`, `MachineAssistLabel`) exactly per `data-model.md` — no runtime, `@/` imports, no `any`/`as`
- [ ] T004 [P] [tier:balanced] Implement env-only config in `src/pdf/config.ts` (output dir, image-provider selection `b2|iiif`, pin resolution from `site/data/archive-source.json`) mirroring `src/browser/config.ts`
- [ ] T005 [tier:powerful] Extend the snapshot to carry the machine-assist translation label additively: add optional `engine`/`model`/`retrieved` to `ProvenanceRecord` in `src/browser/model.ts`, populate it in `src/browser/load/translation.ts` + `src/browser/load/pages.ts` from the `translation/pNNN.en.txt.yml` sidecars, and update the guard in `src/browser/load/snapshot-guards.ts` (additive — must not break existing `browser:test`)
- [ ] T006 [tier:balanced] Regenerate committed snapshots carrying the new label via `npm run snapshot` (requires `CORPUS_ARCHIVE_PATH` at the pinned ref) and verify no unintended drift with `npm run snapshot:check`

**Checkpoint**: types, config, and a label-carrying snapshot exist — story work can begin.

---

## Phase 3: User Story 1 - Single-item facsimile edition (Priority: P1) 🎯 MVP

**Goal**: build one print-ready facing-page PDF for a single item (issue or monograph) — verso
facsimile, recto per-page FR OCR │ EN translation, with a provenance title page and colophon.

**Independent Test**: `npm run pdf:build -- PB-P001/1879-08-15_bpt6k56068358` yields a PDF that opens
with a title page, a facing spread per source page, and a colophon (quickstart.md).

### Tests for User Story 1 (write FIRST, ensure they FAIL) ⚠️

- [ ] T007 [P] [US1] [tier:balanced] Unit test `tests/unit/pdf/edition.test.ts` asserting edition-builder Guarantees G-1..G-7 (happy path + a blanked-`english` copy asserting the G-2 fail-loud throw) against an in-memory snapshot fixture — `contracts/edition-builder.md`
- [ ] T008 [P] [US1] [tier:fast] Unit test `tests/unit/pdf/image-fetch.test.ts` (G-1 match + mismatch-throw, G-2 B2 key miss, G-3 IIIF full-size) with an in-memory `ObjectStore` + stub `FetchFn` — `contracts/image-fetch.md`
- [ ] T009 [P] [US1] [tier:fast] Unit test `tests/unit/pdf/typst-input.test.ts` (G-1 facing structure, G-3 provenance carried, G-4 stable sorted-key serialization) — `contracts/typst-template.md`
- [ ] T010 [P] [US1] [tier:balanced] Integration test `tests/integration/pdf/edition.test.ts` building a real PB-P001 issue fixture to a Typst input document (JSON) with an in-memory `ObjectStore` + fake `TypstRunner` (no network, no Typst binary)

### Implementation for User Story 1

- [ ] T011 [P] [US1] [tier:balanced] Implement `src/pdf/load/source-meta.ts` — title-page metadata (creator, catalogUrl, source ark) from the bibliography SSOT via `@/bibliography` (`loadSourceFile`/`sourceDescriptor`) — edition-builder G-4
- [ ] T012 [P] [US1] [tier:balanced] Implement `src/pdf/load/colophon.ts` — assemble `ColophonMeta` (pin ref, per-image key+sha256, machine-assist label from the extended snapshot, fixed framing statement) — edition-builder G-5
- [ ] T013 [US1] [tier:powerful] Implement `src/pdf/load/edition.ts` `EditionBuilder` (`makeEditionBuilder`) orchestrating snapshot + SSOT + pin → `Edition`, enforcing every data-model fail-loud rule — G-1..G-7 (depends on T003, T011, T012)
- [ ] T014 [P] [US1] [tier:balanced] Implement `src/pdf/images/b2-source.ts` — `makeB2ImageSource` fetching masters via `@/archive` `S3ObjectStore.get(objectStoreKey)` (`resolveObjectStoreConfig`) — image-fetch G-2
- [ ] T015 [P] [US1] [tier:balanced] Implement `src/pdf/images/iiif-source.ts` — `makeIiifImageSource` requesting IIIF Image API `full/max` full-size rasters — image-fetch G-3
- [ ] T016 [US1] [tier:balanced] Implement `src/pdf/images/fetch.ts` — `ImageByteSource` interface + sha256 verification against `provenance.sha256`, fail-loud on mismatch — image-fetch G-1/G-4 (depends on T014, T015)
- [ ] T017 [US1] [tier:balanced] Implement `src/pdf/render/typst-input.ts` — `toTypstInput` + `serializeTypstInput` (stable sorted-key JSON) — typst-template G-1/G-3/G-4 (depends on T003)
- [ ] T018 [US1] [tier:balanced] Implement `src/pdf/render/typst-runner.ts` — `TypstRunner` interface + real `typst compile` exec impl behind an injected `ExecRunner`, surfacing stderr verbatim and failing loud on a missing binary — typst-template G-5
- [ ] T019 [US1] [tier:powerful] **DESIGN GATE (Constitution XI / FR-013)**: design the facing-page template typography + layout via `/frontend-design:frontend-design` (verso facsimile, recto FR│EN columns, running heads, title page, colophon), reusing the Prospectus/Dossier tokens — produces the design spec BEFORE any `.typ` markup; select embed-permissive (OFL) Didone + grotesque faces
- [ ] T020 [US1] [tier:powerful] Author `pdf/template/edition.typ` (the facing-page template) per the T019 design and vendor the chosen embed-licensed fonts under `pdf/template/fonts/` — FR-002/003/014, typst-template G-6 (depends on T019)
- [ ] T021 [US1] [tier:powerful] Implement `src/pdf/render/build.ts` — compose single-item build: resolve `Edition` → fetch + verify images → serialize input → invoke `TypstRunner` → write `build/pdf/<sourceId>/<itemId>.pdf` (depends on T013, T016, T017, T018, T020)
- [ ] T022 [US1] [tier:balanced] Implement `scripts/build-pdf.ts` `main()` for the single-item selector `<sourceId>/<issueId>`, writing under `--out` (default `build/pdf/`) — cli.md G-2/G-3/G-6 (depends on T021)
- [ ] T023 [US1] [tier:balanced] Run the quickstart single-issue validation (PB-P001 issue) end-to-end; confirm title page, facing spreads, machine-derived labels, and colophon (US1 acceptance scenarios)

**Checkpoint**: US1 fully functional — a single item builds to a correct PDF.

---

## Phase 4: User Story 2 - Reproducible batch build (Priority: P2)

**Goal**: build the whole v1 corpus (per-source and `--all`) reproducibly from the pinned snapshot.

**Independent Test**: `npm run pdf:build -- PB-P001` yields 78 issue PDFs; a rebuild from the same
pin is content-identical (quickstart.md).

### Tests for User Story 2 (write FIRST, ensure they FAIL) ⚠️

- [ ] T024 [P] [US2] [tier:balanced] Integration test `tests/integration/pdf/batch.test.ts` — G-1 one-PDF-per-item over a multi-issue fixture and G-4 fail-loud-attributable on a corrupted item, with fakes — cli.md

### Implementation for User Story 2

- [ ] T025 [US2] [tier:balanced] Extend `scripts/build-pdf.ts` for the `<sourceId>` (all issues of a source) and `--all` (all committed snapshot sources) selectors — cli.md G-1/G-4 (depends on T022)
- [ ] T026 [US2] [tier:balanced] Guarantee reproducible output in `src/pdf/render/build.ts` — deterministic input ordering + pinned Typst/font versions so a rebuild from the same pin is content-identical — SC-004 (depends on T021)
- [ ] T027 [US2] [tier:balanced] Run the quickstart batch validation (`npm run pdf:build -- PB-P001`) → one PDF per issue; spot-check a rebuild for content-identity

**Checkpoint**: US1 and US2 both work; the corpus builds reproducibly.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [ ] T028 [P] [tier:fast] Document the Typst build dependency + `pdf:build`/`pdf:test` usage in `README` and cross-link `specs/007-corpus-print-pdf/quickstart.md`
- [ ] T029 [P] [tier:fast] Add unit tests for `src/pdf/config.ts` and colophon edge cases in `tests/unit/pdf/`
- [ ] T030 [tier:balanced] Run `npm run typecheck` + `npm run pdf:test` green; confirm no `any`/`as`/`@ts-ignore` and every new file ≤ 300–500 lines (refactor if over)
- [ ] T031 [P] [tier:fast] Note the B2 Class-B read cost per build in docs and link `TASK-12` (CDN read-caching) as the deferred mitigation

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: after Setup — BLOCKS all stories (T003 types + T005 snapshot label are shared).
- **US1 (Phase 3)**: after Foundational — the MVP.
- **US2 (Phase 4)**: after US1's build/script (T021, T022) exist — extends the same build path.
- **Polish (Phase 5)**: after the desired stories complete.

### Critical-path notes

- The **design gate T019 precedes template T020**, which precedes `build.ts` T021 — the only path to
  an actual PDF. The data layer (T011–T018) and all tests (T007–T010) proceed in parallel and do NOT
  wait on the template.
- T005 (snapshot extension) is the highest-blast-radius task (touches the closed corpus-browser
  model) — additive only; keep `browser:test` green.

### Within a story

Tests FAIL first → models/types → loaders/images → orchestrators → CLI → validation.

---

## Parallel Opportunities

- Setup: T002 ∥ T001.
- Foundational: T004 ∥ (T003 before T005/T006 which touch the snapshot).
- US1 tests: T007 ∥ T008 ∥ T009 ∥ T010.
- US1 impl: T011 ∥ T012 ∥ T014 ∥ T015 (different files); then T013 (needs T011/T012), T016 (needs
  T014/T015); T017/T018 ∥; T019→T020 on their own track.
- Polish: T028 ∥ T029 ∥ T031.

---

## Implementation Strategy

### MVP first (US1)

1. Phase 1 Setup → 2. Phase 2 Foundational (types + snapshot label) → 3. Phase 3 US1 → **STOP &
   VALIDATE**: build a single PB-P001 issue and inspect the PDF (title page, facing spreads, colophon).

### Incremental delivery

US1 (single item, MVP) → US2 (batch + reproducibility). Each increment is independently testable and
adds value without breaking the previous one.

---

## Notes

- Every task carries exactly one `[tier:<label>]` (`stack-control-model-tier-v1`): mechanical/doc →
  `fast`; standard implementation/tests → `balanced`; cross-cutting/architectural/high-blast-radius
  (types, snapshot extension, orchestrators, template authoring, design gate) → `powerful`. Resolved
  by `tier_map` at `resolve-tiers` time; an operator may override per task at execute.
- `[P]` = different files, no incomplete-task dependency. Commit after each task or logical group
  (Constitution IX). Verify tests fail before implementing (Constitution: TDD).
- No fallbacks / mock data outside tests (Constitution V); `@/` imports, no `any`/`as`/`@ts-ignore`
  (VII); UI/typography only via `/frontend-design` (XI).
