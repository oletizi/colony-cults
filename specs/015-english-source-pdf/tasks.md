# Tasks: English-Source Facsimile PDF

**Feature**: `specs/015-english-source-pdf` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Additive language-keyed branch inside the shipped archive-direct reader (spec
014). Tier tags (`[tier:fast]`→haiku, `[tier:balanced]`→sonnet,
`[tier:powerful]`→opus) size each task's dispatch model. No task needs `powerful`
— this is a small, well-scoped change over an existing pattern; reader-logic
tasks are `balanced`, tests/investigation `fast`.

Files touched: `src/pdf/load/archive-source.ts`, `archive-page.ts`,
`archive-edition.ts`, `colophon.ts`; `src/pdf/model.ts`; and — the sole template
exception (FR-013, via `/frontend-design`) — `pdf/template/frontmatter.typ`
(colophon line only); `tests/unit/pdf/archive-fixture.ts` + tests. Downstream
(facing-page/spread templates, build/batch, object-store fetch) unchanged.

## Phase 1: Setup / Investigation

- [x] T001 [tier:fast] Verify open question V1: inspect the real folio sidecars for PB-P056 (and PB-P057–P059) in the pinned archive clone and confirm the `language` field's concrete value — full word `English` vs. a code (`eng`/`en`). Record the finding inline in `specs/015-english-source-pdf/research.md` (§ V1). This fixes the case-insensitive match target before wiring.

## Phase 2: Foundational (blocking — shared by all stories)

- [x] T002 [tier:balanced] Add reading-language resolution to `src/pdf/load/archive-source.ts`: a typed `ReadingLanguage = 'french' | 'english'` derived from each folio's provenance `language` (case-insensitive per T001), surfaced on the source resolution. Fail loud, naming the source + offending value, on (a) an unrecognized non-FR/EN language (FR-006) and (b) a source whose folios disagree on language (mixed) (FR-006a). Keep the file ≤500 lines.
- [x] T003 [tier:balanced] Extend `tests/unit/pdf/archive-fixture.ts` to emit an English-source fixture: `language: English` in every folio sidecar, `issue.txt` OCR present, and **no** `translation/` directory. Add an option to set a per-folio OCR-condition (sub-high quality tier) for the low-fidelity-caveat test, and an option for a non-FR/EN language value.

## Phase 3: User Story 1 — English source builds, OCR as reading recto (Priority: P1)

**Goal**: An English-language source (OCR, no translation) builds a facsimile PDF with the English OCR as the reading recto.

**Independent test**: Assemble the English fixture → an `Edition` whose recto reading text is the English OCR at the correct position, with no translation artifact read.

- [x] T004 [tier:balanced] [US1] In `src/pdf/load/archive-page.ts`, branch `loadArchivePage` on the source's reading language. English path: read the OCR (corrected `pNNN.fr.txt` if present, else the positional `issue.txt` segment) as the recto reading text, **do not call `resolveTranslation`**, and place the English OCR in the **`english`** field with **`ocrFrench = ""`** — the english-only Typst variant (`showFrench = false`) renders `english` as the single reading column and drops `ocrFrench` (verified in `@/pdf/render/typst-input`; per `contracts/reader-language-routing.md`). Set `machineAssist = null`, `untranslatable = false`; carry `ocrCondition` through unchanged. The empty-OCR fail-loud (T007/FR-007) checks the resolved English OCR before it is placed in `english`. French path unchanged.
- [x] T005 [tier:balanced] [US1] In `src/pdf/load/archive-edition.ts`, thread the reading language from the source resolution (T002) into per-page assembly and route English sources to the english-only edition variant. Keep `archiveRef`/reproducibility and folio/image machinery unchanged. Extract a helper if the file nears 500 lines.
- [x] T006 [tier:fast] [US1] Unit test in `tests/unit/pdf/archive-page.test.ts`: the English fixture assembles; recto reading text equals each page's positional OCR (C1, C2); no `translation/pNNN.en.txt` is read; `machineAssist` is null and `untranslatable` false on English pages.
- [x] T007 [tier:fast] [US1] Unit test: an English fixture page with an empty OCR segment and no corrected `pNNN.fr.txt` makes `loadArchivePage` **throw naming the page** (C5, FR-007) — the blank-recto tolerance does not apply to an UNMARKED page.
- [ ] T015 [tier:balanced] [US1] Blank/plate marker (FR-014, C10): add an OPTIONAL `blank_recto?: boolean` folio-provenance field to `src/archive/provenance.ts` (parser + serializer + closed-key allowlist + KEY_ORDER, additive like `translation?`). In `src/pdf/load/archive-page.ts` `loadEnglishPage`, read the folio's `blank_recto`; when true, TOLERATE empty OCR (allowEmpty) and produce the blank-recto content — set `untranslatable = true`, `english = ''` (reuse the French blank-recto flag so spec-014 rendering is unchanged); when a `blank_recto` folio has NON-empty OCR, fail loud. Extend `tests/unit/pdf/archive-fixture.ts` with a per-folio `blankRecto` option. Test-first (C10): a `blank_recto` folio with empty OCR builds a blank recto (no throw); an unmarked empty folio still throws (FR-007); a `blank_recto` folio with text throws. Keep files ≤500 lines.

## Phase 4: User Story 2 — French path + safety net unchanged (Priority: P1)

**Goal**: French sources behave exactly as before; the translation-gap fail-loud is intact.

**Independent test**: French fixture builds identically; French fixture with a missing translation still throws FR-008.

- [x] T008 [tier:fast] [US2] Regression test in `tests/unit/pdf/archive-page.test.ts`: an unchanged French fixture assembles identically (FR-OCR + EN-translation); a French fixture with a genuinely missing `pNNN.en.txt` still throws the FR-008 translation-gap error naming the page (C3).
- [x] T009 [tier:fast] [US2] Test in `tests/unit/pdf/archive-source.test.ts` (or the resolution test): a source whose `language` is neither French nor English **fails loud** naming the value (C4, FR-006); a mixed-language source fails loud naming the source (FR-006a).

## Phase 5: User Story 3 — Honest OCR-transcription colophon (Priority: P2)

**Goal**: The English colophon discloses the recto as a machine OCR transcription, never a translation.

**Independent test**: Assemble an English edition and inspect its colophon: OCR-transcription line present, no machine-assisted-translation line, `translation`/`machineAssist` null; low-fidelity caveat surfaces where recorded.

> **Scope note (FR-013, added 2026-07-18):** discovered during execution — the shared `assembleColophon` MANDATES a machine-assist label (throws when none) and the colophon template `frontmatter.typ` renders `col.translation.engine` unconditionally, so an English source cannot be assembled/rendered without change. This phase therefore touches `colophon.ts`, `model.ts`, and (via `/frontend-design`) `pdf/template/frontmatter.typ` — the sole FR-010 template exception.

**Prerequisite for T010 (controller step, Constitution XI — MANDATORY before any `.typ` edit):** design the colophon template change through `/frontend-design:frontend-design`. The `colophon-page` in `pdf/template/frontmatter.typ` must branch — English → an OCR-transcription line (recto is a machine OCR transcription of the English original; OCR engine/status + low-fidelity caveat when present); French → the existing machine-assist line; never both. This is a controller-run design step (not a tier-dispatched subagent task); its output (layout/typography/label copy direction) feeds T010's `frontmatter.typ` edit.

- [x] T010 [tier:balanced] [US3] Implement FR-013 across the data + render layers (the `frontmatter.typ` edit follows the frontend-design prerequisite above):
  - `src/pdf/model.ts`: `ColophonMeta.translation` → `MachineAssistLabel | null`; add an OCR-transcription disclosure field (engine/status + caveat, null for French).
  - `src/pdf/load/colophon.ts`: make `assembleColophon` reading-language-aware — French still fails loud when no page carries a machine-assist label (spec-014 safety net); English requires the OCR-transcription disclosure instead and sets `translation = null`.
  - `src/pdf/load/archive-edition.ts`: thread the reading language + OCR provenance into `assembleColophon`; English editions get `translation`/`machineAssist` null.
  - `pdf/template/frontmatter.typ`: implement the branch per T010a (English OCR-transcription line vs French machine-assist line; never both). Keep every touched file ≤500 lines (extract a helper if needed).
- [x] T011 [tier:fast] [US3] Unit test in `tests/unit/pdf/archive-edition.test.ts` (and/or a colophon unit test): the English edition's colophon contains the OCR-transcription disclosure and NO machine-assisted-translation label, `translation`/`machineAssist` null (C6); a French source with NO machine-assist label STILL throws (spec-014 safety net, C3-adjacent); a folio with a sub-high OCR condition surfaces its caveat on the page (C7, FR-009).

## Phase 6: Polish & Cross-Cutting

- [x] T014 [tier:balanced] English end-to-end integration test: build a full `Edition` from an English fixture via the archive-edition reader (`makeArchiveEditionReader(...).build(...)`) — proving `assembleColophon` no longer throws for a no-translation English source (C1) — and serialize it via `toTypstInput` to confirm the colophon carries the OCR-transcription disclosure and the english-only recto renders the English OCR (C6). This is the end-to-end proof US1 + US3 need; the T004/T005/T010 unit tests do not exercise the full `build()` colophon path.
- [x] T012 [tier:fast] Run `npx vitest run tests/unit/pdf` (existing pdf suite + all new English-path tests green), `npx tsc --noEmit` clean, and confirm every touched source file is within the 300–500 line guidance. Confirm C8 (facing-page/spread templates, enumeration, fetch/verify, reproducibility unchanged) AND that the ONLY template change is the colophon `frontmatter.typ` machine-assist/OCR-transcription branch (C9, the sanctioned FR-010 exception).
- [~] T013 [tier:balanced] Operator acceptance: build the real English targets end to end — `COLONY_ARCHIVE_ROOT=<pin> npx tsx scripts/build-pdf.ts PB-P056` (first target, ~52pp), then PB-P057–P059 (press leaves). Confirm each PDF shows the English OCR as the reading recto, an honest OCR-transcription colophon (no MT line), the pinned-archive reference, and — for the press leaves — the surfaced low-fidelity caveat (SC-006). Operator-verified; excluded from the tasks-complete gate.

## Dependencies & order

- T001 → T002 (verify vocabulary before wiring the match).
- T002, T003 (Foundational) block all user-story phases.
- US1 (T004–T007) is the MVP: independently delivers buildable English PDFs.
- US2 (T008–T009) and US3 (T010→T011) are independent of each other; both
  depend only on Foundational + the routing from US1's T004/T005.
- US3: **the `/frontend-design` prerequisite MUST precede T010's `frontmatter.typ`
  edit** (Constitution XI). T010 (colophon.ts/model.ts/archive-edition.ts/frontmatter.typ)
  → T011 (test).
- T014 (English end-to-end integration) after T010 (needs the reading-language-aware
  colophon so `build()` no longer throws).
- T012 after all implementation; T013 (operator) last.

## Parallel opportunities

- T006, T007, T008, T009, T011 are all test files exercising disjoint cases —
  parallelizable once their target code (T004/T005/T010) exists.
- T003 (fixture) is parallel with T002 (resolution) — different files.

## MVP scope

**User Story 1** (T001–T007): an English-language source builds a facsimile PDF
with the English OCR as the reading recto. US2 (regression safety) and US3
(colophon honesty) harden and complete it.
