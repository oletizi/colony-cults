---
description: "Task list for Archive-Direct PDF Rendering (spec 014)"
---

# Tasks: Archive-Direct PDF Rendering

**Input**: Design documents from `specs/014-archive-direct-pdf/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Included — this project develops test-first (spec 007 precedent); the reader's
behaviors (positional mapping, untranslatable marker, sha256 verification) demand unit proof.

**Organization**: by user story. Each task carries a `[tier:…]` tag for `/stack-control:execute`
model-sized dispatch (`fast`=haiku, `balanced`=sonnet, `powerful`=opus).

## Format: `[ID] [P?] [Story] [tier:…] Description`

- **[P]**: parallelizable (different files, no incomplete-task dependency)
- Single TS project: `src/`, `scripts/`, `tests/`; `@/*` → `src/*`.

---

## Phase 1: Setup

- [x] T001 [P] [tier:fast] Add a shared fixture-archive test helper `tests/unit/pdf/archive-fixture.ts` that builds a temp `archive/cases/<case>/<type>/<slug>/` dir with N folios (`fNNN.yml` carrying `object_store.key` + image `sha256`), an `issue.txt` (form-feed segments), and `translation/pNNN.{fr,en}.txt` + provenance sidecars (with a settable `translation` label) — the basis for the reader unit + integration tests.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: source resolution + per-page assembly primitives every user story depends on.

**⚠️ CRITICAL**: no user-story work begins until this phase is complete.

- [x] T002 [tier:balanced] Register/derive source layouts for the archive-direct targets (PB-P054, PB-P055, PB-P002) in `src/archive/location.ts` (extend `SOURCE_LAYOUTS` or wire `deriveSourceLayout`), so `sourceLayout(sourceId)` resolves them (monograph slugs under `books/`); unit test in `tests/unit/archive/location*.test.ts`. Fail loud on an unregistered/underivable source.
- [x] T003 [tier:balanced] Implement `src/pdf/load/archive-source.ts`: resolve a source's archive directory (`resolveArchiveRoot` + `sourceLayout` + `monographDir`/`enumerateIssueDirs`) and enumerate its folios (`fNNN.yml`, matched `^f(\d+)\.yml$`, sorted ascending) via `@/archive/readProvenance` → an ordered list of `{ folioId, position, objectStoreKey, imageSha256 }`; fail loud on a folio missing `object_store.key`/`sha256`. Unit test (fixture archive) for a full source + an extract (folios `f048–f050`).
- [x] T004 [tier:powerful] Implement `src/pdf/load/archive-page.ts`: per-page assembly keyed by folio POSITION — `ocrFrench` from `translation/pNNN.fr.txt` (corrected) else the position-th `issue.txt` segment (`splitIssueOcr`); read `translation/pNNN.en.txt` + its provenance `translation` label via `readProvenance` and resolve the TranslationOutcome (`machine-assisted`→text; `untranslatable`→`english:""`; absent artifact→fail loud; label/emptiness inconsistency→fail loud); `machineAssist` from the sidecar. `pNNN` derived from `position`, NOT the folio number. Unit test for the happy path (full source).

**Checkpoint**: source resolution + folio enumeration + per-page assembly ready.

---

## Phase 3: User Story 1 — Render a source's edition from the archive (Priority: P1) 🎯 MVP

**Goal**: `pdf:build <sourceId>` assembles the `Edition` directly from the archive and renders a
correct facing-page PDF, for a source from any archive.

**Independent Test**: build an archive-normalized source; confirm a correct facing-page PDF
(verso facsimile, recto FR OCR + EN translation), images sha256-verified, no snapshot read, no
catalog-URL/ark parsed.

### Tests for User Story 1 ⚠️ (write first, ensure they FAIL)

- [x] T005 [P] [US1] [tier:balanced] Unit test `tests/unit/pdf/archive-edition.test.ts`: `makeArchiveEditionReader.build(sourceId, itemId)` over a fixture archive produces a well-formed `Edition` (ordered pages, `ImageAsset.objectStoreKey`+`sha256`, `ocrFrench`+`english`, colophon `archiveRef` + machine-assist) — asserting the exact `@/pdf/model` shape and `ark: null`.
- [x] T006 [P] [US1] [tier:balanced] Integration test `tests/integration/pdf/archive-edition.test.ts`: build a fixture-archive source end-to-end to a Typst input document with a fake `TypstRunner` + fake image fetch (`makeFakeFetch`/`FakeObjectStore`) — asserting no committed snapshot is read and the produced edition matches the fixture (SC-001). Cover **both variants** — a `parallel` (FR OCR │ EN) build and an `english-only` (`showFrench:false`) build — so FR-010's variant carry-through is exercised, not just assumed by reuse.

### Implementation for User Story 1

- [x] T007 [US1] [tier:powerful] Implement `src/pdf/load/archive-edition.ts`: `makeArchiveEditionReader(deps)` orchestrating T003 (folios) + T004 (per-page) → `EditionPage[]`, plus `makeSourceMetaReader` (title page) + `makeArchivePinReader` (`archiveRef`) + `assembleColophon` (all reused) → a complete `Edition`; injectable deps (archive root, provenance reader, source-meta, pin); no `@/browser` import.
- [x] T008 [US1] [tier:balanced] Wire `src/pdf/render/build.ts` `buildItem` to source the `Edition` from `makeArchiveEditionReader` (archive root resolved from `COLONY_ARCHIVE_ROOT`/`--archive-root`) instead of `makeCorpusSnapshotReader` → `makeEditionBuilder`; the image-fetch stage (`stageImages`, `assertMasterSha256Match`), colophon, source-meta, pin, and Typst render are reused unchanged (pages carry `objectStoreKey` + `ark:null` → the `b2` provider path).
- [x] T009 [US1] [tier:balanced] Wire `src/pdf/render/batch.ts` `buildSource`/`buildAll` to the archive-direct reader and enumerate a source's items from its archive folios/issue dirs (not the snapshot); `--all` discovers buildable sources from the archive/bibliography (retire `listSnapshotSourceIds` for this build), preserving the record-and-continue "built N, failed M" summary.
- [x] T010 [US1] [tier:balanced] Edit `scripts/build-pdf.ts`: resolve/require the archive root (`COLONY_ARCHIVE_ROOT` or `--archive-root`, fail loud if unset); drop the committed-snapshot dependency (keep reading the pin sidecar `site/data/archive-source.json`); update the banner/usage; existing flags (`--no-french`, `--out`, selector) unchanged.

**Checkpoint**: a source's edition renders end-to-end from the archive (MVP).

---

## Phase 4: User Story 2 — Page-range extracts align correctly (Priority: P2)

**Goal**: an extract's absolute folios pair with its extract-relative translations correctly.

**Independent Test**: build an extract (folios `f048–f050`, translations `p001–p003`); each
image pairs with its translation, in order, no missing-page error.

### Tests for User Story 2 ⚠️

- [x] T011 [P] [US2] [tier:balanced] Unit test `tests/unit/pdf/archive-extract.test.ts`: a fixture extract (folios `f048–f050` ↔ translations `p001–p003`) resolves `f048→p001`, `f049→p002`, `f050→p003` by position (SC-002); and a folio/translation count mismatch fails loud (uncovered-folio check).

### Implementation for User Story 2

- [x] T012 [US2] [tier:balanced] Confirm/harden the positional mapping in `archive-source.ts`/`archive-page.ts` (T003/T004 already map by position): assert every folio maps to exactly one translation by position and every position is covered; a gap or over-count fails loud naming the source. (No new module; a guard + its test if not already covered by T011.)

**Checkpoint**: extracts render with correct alignment.

---

## Phase 5: User Story 3 — Untranslatable pages render blank; gaps fail loud (Priority: P2)

**Goal**: a page marked `untranslatable` renders blank-EN; an unmarked missing translation fails
loud.

**Independent Test**: build a source with an `untranslatable`-labeled page (blank EN, build ok)
and — separately — a source with an absent translation (fail loud, page named).

### Tests for User Story 3 ⚠️

- [x] T013 [P] [US3] [tier:balanced] Unit test `tests/unit/pdf/archive-untranslatable.test.ts` over `archive-page.ts`: `translation: untranslatable` (empty) → `EditionPage.english === ""` and the build proceeds (SC-004, FR-007); an absent `pNNN.en.txt`/sidecar → fail loud naming the page (FR-008); a present-but-inconsistent label (`untranslatable` yet non-empty, or `machine-assisted` yet empty) → fail loud.

### Implementation for User Story 3

- [x] T014 [US3] [tier:balanced] Confirm/harden the TranslationOutcome logic in `archive-page.ts` (T004 implements it): the empty⟺untranslatable distinction is authoritative for blank-EN; the downstream renderer/colophon accept a blank `english` for a marked page only (verify the edition assembler does not fail-loud on the intentional blank). Adjust the edition assembler (`archive-edition.ts`) if it inherits an empty-`english` guard.

**Checkpoint**: untranslatable handling correct; genuine gaps still fail loud.

---

## Phase 6: User Story 4 — Reproducible editions pinned to an archive commit (Priority: P3)

**Goal**: the colophon records the archive commit the build read.

**Independent Test**: build an edition; the colophon `archiveRef` equals the pin's `.ref`.

### Tests for User Story 4 ⚠️

- [x] T015 [P] [US4] [tier:balanced] Unit test `tests/unit/pdf/archive-reproducibility.test.ts`: the assembled `Edition`'s colophon `archiveRef` equals the injected pin ref (SC-005); and (if implemented) an archive clone whose HEAD ≠ the pin fails loud.

### Implementation for User Story 4

- [x] T016 [US4] [tier:balanced] Confirm `archive-edition.ts` records `archiveRef` from `makeArchivePinReader` (`site/data/archive-source.json` `.ref`) unchanged; OPTIONAL reproducibility guard: assert the archive clone's `HEAD` matches the pin and fail loud on mismatch (a small integrity check; keep it behind a clear, documented check).

**Checkpoint**: reproducibility preserved.

---

## Phase 7: Polish & Cross-Cutting

- [x] T017 [P] [US1] [tier:balanced] Unit test `tests/unit/pdf/archive-image-verify.test.ts`: a page whose `object_store` master is absent (fetch 404 / `FakeObjectStore` miss) fails loud with no IIIF fallback; a master whose bytes mismatch the recorded `sha256` fails loud (`assertMasterSha256Match`) (SC-003).
- [x] T018 [P] [tier:fast] Update `README.md` `pdf:build` section: reads the archive (`COLONY_ARCHIVE_ROOT`/`--archive-root`), object_store images, no snapshot dependency; note the archive-clone-at-pin expectation.
- [x] T019 [tier:balanced] Run `npm run typecheck` and `npm run pdf:test` (+ full `npm test`) green; fix any fallout. Confirm all new `src/pdf/load/*` modules are ≤ 500 lines (Constitution VII).
- [~] T020 [tier:powerful] [operator live acceptance] Execute `quickstart.md` Scenarios 1–2 against the real archive clone: build PB-P055 (archive.org) and PB-P054 (Gallica extract) end-to-end to real PDFs, confirming both — the two sources unbuildable before this feature (SC-006). Marked `[~]` (excluded from the tasks-complete gate): needs the live archive clone + B2/CDN, an operator acceptance run after the cross-model govern audit.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)** → no deps.
- **Foundational (P2: T002–T004)** → after Setup; **blocks all user stories**.
- **US1 (T005–T010)** → after Foundational (the MVP: reader + build/batch/verb wiring).
- **US2 (T011–T012)** → after Foundational; the positional map lands in T003/T004, US2 proves + guards it.
- **US3 (T013–T014)** → after Foundational; the marker logic lands in T004, US3 proves + hardens it (incl. the edition assembler's blank-EN acceptance).
- **US4 (T015–T016)** → after US1's `archive-edition.ts` (T007).
- **Polish (P7)** → after the stories; T020 is `[~]` operator acceptance (post-govern).

### Within each story

- Tests first (write, ensure FAIL), then implementation.

### Parallel opportunities

- Foundational: T002 ∥ start; T003/T004 sequential-ish (T004 uses T003's folio order) but different files.
- US1 tests T005 ∥ T006; impl T007 → T008/T009/T010 (T008–T010 touch different files: build.ts / batch.ts / scripts).
- US2/US3/US4/Polish tests (T011, T013, T015, T017) are all `[P]` (distinct test files).

---

## Implementation Strategy

### MVP (Foundational + US1)

1. Setup → Foundational (source resolution + per-page assembly, incl. positional map + marker).
2. US1: the archive-edition reader + build/batch/verb wiring.
3. **STOP & VALIDATE**: build a fixture source (and, at T020, PB-P055) end-to-end; confirm the
   archive-only, source-agnostic render.

### Incremental delivery

- + US2 (extract alignment proof/guard) → + US3 (untranslatable) → + US4 (reproducibility) →
  Polish. Each is largely proving/hardening behavior the Foundational reader already implements,
  so the increments are small and low-risk.

---

## Notes

- `[P]` = different files, no incomplete-task dependency. `[tier:…]` drives execute dispatch.
- Fail-loud, no fallbacks/mock outside `tests/`; `@/` imports; no `any`/`as`/`@ts-ignore`;
  modules ≤ 300–500 lines; inject collaborators (archive root / provenance / source-meta / pin /
  image source). No `@/browser` change (PDF-only mandate).
- Commit after each task or logical group; verify tests fail before implementing.
