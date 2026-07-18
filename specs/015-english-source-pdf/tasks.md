# Tasks: English-Source Facsimile PDF

**Feature**: `specs/015-english-source-pdf` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Additive language-keyed branch inside the shipped archive-direct reader (spec
014). Tier tags (`[tier:fast]`→haiku, `[tier:balanced]`→sonnet,
`[tier:powerful]`→opus) size each task's dispatch model. No task needs `powerful`
— this is a small, well-scoped change over an existing pattern; reader-logic
tasks are `balanced`, tests/investigation `fast`.

Files touched: `src/pdf/load/archive-source.ts`, `archive-page.ts`,
`archive-edition.ts`; `tests/unit/pdf/archive-fixture.ts` + tests. Downstream
(Typst templates, build/batch, object-store fetch) unchanged.

## Phase 1: Setup / Investigation

- [ ] T001 [tier:fast] Verify open question V1: inspect the real folio sidecars for PB-P056 (and PB-P057–P059) in the pinned archive clone and confirm the `language` field's concrete value — full word `English` vs. a code (`eng`/`en`). Record the finding inline in `specs/015-english-source-pdf/research.md` (§ V1). This fixes the case-insensitive match target before wiring.

## Phase 2: Foundational (blocking — shared by all stories)

- [ ] T002 [tier:balanced] Add reading-language resolution to `src/pdf/load/archive-source.ts`: a typed `ReadingLanguage = 'french' | 'english'` derived from each folio's provenance `language` (case-insensitive per T001), surfaced on the source resolution. Fail loud, naming the source + offending value, on (a) an unrecognized non-FR/EN language (FR-006) and (b) a source whose folios disagree on language (mixed) (FR-006a). Keep the file ≤500 lines.
- [ ] T003 [tier:balanced] Extend `tests/unit/pdf/archive-fixture.ts` to emit an English-source fixture: `language: English` in every folio sidecar, `issue.txt` OCR present, and **no** `translation/` directory. Add an option to set a per-folio OCR-condition (sub-high quality tier) for the low-fidelity-caveat test, and an option for a non-FR/EN language value.

## Phase 3: User Story 1 — English source builds, OCR as reading recto (Priority: P1)

**Goal**: An English-language source (OCR, no translation) builds a facsimile PDF with the English OCR as the reading recto.

**Independent test**: Assemble the English fixture → an `Edition` whose recto reading text is the English OCR at the correct position, with no translation artifact read.

- [ ] T004 [tier:balanced] [US1] In `src/pdf/load/archive-page.ts`, branch `loadArchivePage` on the source's reading language. English path: read the OCR (corrected `pNNN.fr.txt` if present, else the positional `issue.txt` segment) as the recto reading text, **do not call `resolveTranslation`**, and place the English OCR in the **`english`** field with **`ocrFrench = ""`** — the english-only Typst variant (`showFrench = false`) renders `english` as the single reading column and drops `ocrFrench` (verified in `@/pdf/render/typst-input`; per `contracts/reader-language-routing.md`). Set `machineAssist = null`, `untranslatable = false`; carry `ocrCondition` through unchanged. The empty-OCR fail-loud (T007/FR-007) checks the resolved English OCR before it is placed in `english`. French path unchanged.
- [ ] T005 [tier:balanced] [US1] In `src/pdf/load/archive-edition.ts`, thread the reading language from the source resolution (T002) into per-page assembly and route English sources to the english-only edition variant. Keep `archiveRef`/reproducibility and folio/image machinery unchanged. Extract a helper if the file nears 500 lines.
- [ ] T006 [tier:fast] [US1] Unit test in `tests/unit/pdf/archive-page.test.ts`: the English fixture assembles; recto reading text equals each page's positional OCR (C1, C2); no `translation/pNNN.en.txt` is read; `machineAssist` is null and `untranslatable` false on English pages.
- [ ] T007 [tier:fast] [US1] Unit test: an English fixture page with an empty OCR segment and no corrected `pNNN.fr.txt` makes `loadArchivePage` **throw naming the page** (C5, FR-007) — the blank-recto tolerance does not apply on the English path.

## Phase 4: User Story 2 — French path + safety net unchanged (Priority: P1)

**Goal**: French sources behave exactly as before; the translation-gap fail-loud is intact.

**Independent test**: French fixture builds identically; French fixture with a missing translation still throws FR-008.

- [ ] T008 [tier:fast] [US2] Regression test in `tests/unit/pdf/archive-page.test.ts`: an unchanged French fixture assembles identically (FR-OCR + EN-translation); a French fixture with a genuinely missing `pNNN.en.txt` still throws the FR-008 translation-gap error naming the page (C3).
- [ ] T009 [tier:fast] [US2] Test in `tests/unit/pdf/archive-source.test.ts` (or the resolution test): a source whose `language` is neither French nor English **fails loud** naming the value (C4, FR-006); a mixed-language source fails loud naming the source (FR-006a).

## Phase 5: User Story 3 — Honest OCR-transcription colophon (Priority: P2)

**Goal**: The English colophon discloses the recto as a machine OCR transcription, never a translation.

**Independent test**: Assemble an English edition and inspect its colophon: OCR-transcription line present, no machine-assisted-translation line, `machineAssist` null; low-fidelity caveat surfaces where recorded.

- [ ] T010 [tier:balanced] [US3] In `src/pdf/load/archive-edition.ts` colophon assembly, for English sources emit an **OCR-transcription** line (recto is a machine OCR transcription of the English original; OCR engine/status + low-fidelity caveat when present) and **omit** the machine-assisted-translation line; ensure the edition's `machineAssist` label is null (FR-008). Keep the file ≤500 lines (extract a colophon helper if needed).
- [ ] T011 [tier:fast] [US3] Unit test in `tests/unit/pdf/archive-edition.test.ts`: the English edition's colophon contains the OCR-transcription line and NO machine-assisted-translation line, `machineAssist` is null (C6); a folio with a sub-high OCR condition surfaces its caveat on the page (C7, FR-009).

## Phase 6: Polish & Cross-Cutting

- [ ] T012 [tier:fast] Run `npx vitest run tests/unit/pdf` (existing 132 + new English-path tests all green), `npx tsc --noEmit` clean, and confirm every touched source file is within the 300–500 line guidance (C8: downstream unchanged).
- [~] T013 [tier:balanced] Operator acceptance: build the real English targets end to end — `COLONY_ARCHIVE_ROOT=<pin> npx tsx scripts/build-pdf.ts PB-P056` (first target, ~52pp), then PB-P057–P059 (press leaves). Confirm each PDF shows the English OCR as the reading recto, an honest OCR-transcription colophon (no MT line), the pinned-archive reference, and — for the press leaves — the surfaced low-fidelity caveat (SC-006). Operator-verified; excluded from the tasks-complete gate.

## Dependencies & order

- T001 → T002 (verify vocabulary before wiring the match).
- T002, T003 (Foundational) block all user-story phases.
- US1 (T004–T007) is the MVP: independently delivers buildable English PDFs.
- US2 (T008–T009) and US3 (T010–T011) are independent of each other; both depend
  only on Foundational + the routing from US1's T004/T005.
- T012 after all implementation; T013 (operator) last.

## Parallel opportunities

- T006, T007, T008, T009, T011 are all test files exercising disjoint cases —
  parallelizable once their target code (T004/T005/T010) exists.
- T003 (fixture) is parallel with T002 (resolution) — different files.

## MVP scope

**User Story 1** (T001–T007): an English-language source builds a facsimile PDF
with the English OCR as the reading recto. US2 (regression safety) and US3
(colophon honesty) harden and complete it.
