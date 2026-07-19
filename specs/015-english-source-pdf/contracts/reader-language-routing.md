# Contract: Reader Language Routing (English-Source Path)

The archive-direct reader's routing contract. Additive to spec 014's
`contracts/archive-edition-reader.md` — that contract's guarantees hold
unchanged for French sources; this adds the English-source path.

## Routing (per source)

```
resolve reading language from folio provenance `language` (case-insensitive):
  "french"  -> FRENCH PATH   (existing: FR-OCR | required EN-translation)
  "english" -> ENGLISH PATH  (this feature)
  otherwise -> throw  (unsupported reading language; only FR + EN in scope)

reading language MUST be consistent across a source's folios;
  a mixed-language source throws.
```

## ENGLISH PATH — per-page assembly

**Given** an `ArchivePageSource` (folio at a known position) + the source's
`issue.txt` OCR segments:

- **Reads** the page's OCR text: corrected `translation/pNNN.fr.txt` if present,
  else the positional `issue.txt` segment (position = folio's sorted index).
- **Does NOT read** any `translation/pNNN.en.txt` / `.yml` — `resolveTranslation`
  is **not called** on this path.
- **Produces** an `ArchivePageContent` with:
  - `english` = the resolved English OCR text. **This is the load-bearing
    placement**: the english-only Typst variant (`showFrench = false` in
    `@/pdf/render/typst-input`) renders the `english` field as the single reading
    column and drops the FR label, so the English OCR MUST be carried in `english`
    (not `ocrFrench`) for it to render as the reading recto. Verified against
    `typst-input.ts` (`TypstRecto.english` is the reading column in english-only
    mode; `ocrFrench` is "carried … harmless when unused").
  - `ocrFrench = ""` — there is no French OCR on this path; the english-only
    variant does not render it. (Non-empty would be dead data, never displayed.)
  - `machineAssist = null`
  - `untranslatable = false`
  - `ocrCondition` = the folio's OCR apparatus note (carried through unchanged).

  The empty-OCR fail-loud check below is performed on the resolved English OCR
  **before** it is placed in `english` (the French path's empty-check reads
  `ocrFrench`; the English path checks the value it puts in `english`).

**Fail-loud**: an **unmarked** English page with neither a corrected `pNNN.fr.txt`
nor a positional `issue.txt` segment (empty/absent OCR) → throw naming the page.

**Blank / plate marker (FR-014)**: an English folio whose provenance carries
`blank_recto: true` is an intentionally-blank recto (plate / cover / blank leaf).
On this folio the English path TOLERATES empty OCR and produces the blank-recto
content — it sets `untranslatable = true`, `english = ''` (the SAME flag the French
`untranslatable` page sets), so spec 014's existing blank-recto rendering draws the
verso facsimile with an empty reading column (no template change). The marker is the
ONLY opt-out from the empty-OCR fail-loud above, so a genuine gap on an unmarked page
is never silenced. A `blank_recto` folio with NON-empty OCR → throw (a page is a
plate XOR a text page).

## ENGLISH PATH — edition + colophon (FR-013)

- `machineAssist` label absent (null) for the edition. `ColophonMeta.translation`
  is nullable and is `null` here.
- `assembleColophon` MUST NOT throw on the legitimate absence of a machine-assist
  label for an English source (spec-014 threw unconditionally when no page carried
  one). It keys the requirement on the reading language: **French still requires a
  label** (throws if absent — the spec-014 safety net); **English requires an
  OCR-transcription disclosure** instead.
- Colophon carries an **OCR-transcription** disclosure (recto is a machine OCR
  transcription of the English original; OCR engine/status + low-fidelity caveat
  when present) and **no** machine-assisted-translation line.
- The colophon template (`frontmatter.typ`) branches on reading language: English
  → OCR-transcription line; French → machine-assist line; never both. This is the
  one FR-010 template exception; it is designed through
  `/frontend-design:frontend-design` (Constitution XI).

  **Design direction (frontend-design, 2026-07-18) — the OCR-transcription row.**
  The English row is an honest sibling of the existing `machine assist` row in the
  same evidentiary data block; no new color/face/grid (all inherited apparatus):
  - **Label:** `transcription` (faint lowercase, sibling to `machine assist`).
  - **Value:** leads with `machine OCR` (unmistakably not a translation, not human),
    then engine/status, dot-separated exactly like the French `engine · model ·
    retrieved` — e.g. `machine OCR · tesseract 5 (searchable)`.
  - **Low-fidelity caveat:** when the edition records a sub-high OCR condition,
    append it as a final dot-separated token rendered in **oxblood** (the colophon's
    existing accent) — e.g. `machine OCR · tesseract 5 · quality: low`. Absent for
    clean OCR (no accent shown).
  - The French `machine assist` row is byte-for-byte unchanged. This colophon line
    is independent of the per-page recto column header (deferred V2, `spread.typ`
    untouched).
- `archiveRef` (pinned-archive commit) unchanged.
- Both edition variants remain available; the English-source path targets the
  english-only reading recto. The parallel FR │ EN variant is unaffected.

## FRENCH PATH — unchanged (regression guarantees)

- `resolveTranslation` still called; a genuinely missing `pNNN.en.txt` still
  throws the FR-008 translation-gap error naming the page.
- `untranslatable`-marked blank pages still render a blank recto.
- Output byte-for-byte equivalent to pre-feature behavior.

## Invariants (must hold after the feature)

| # | Invariant |
|---|-----------|
| C1 | An English source (language=English, OCR present, no `translation/`) builds a complete PDF; 0 translation artifacts read. |
| C2 | The English recto reading text equals the page's OCR at the correct position. |
| C3 | A French source's translation-gap fail-loud is intact. |
| C4 | A non-FR/EN reading language fails loud naming the value. |
| C5 | An English page with empty/absent OCR fails loud naming the page. |
| C6 | English colophon: OCR-transcription line present, machine-assisted-translation line absent, `machineAssist`/`translation` null. |
| C7 | `ocrCondition` (low-fidelity caveat) surfaces on English pages that record one. |
| C8 | Folio enumeration, positional mapping, object-store fetch/verify, reproducibility, and the facing-page/spread Typst templates unchanged. **Exception (C9).** |
| C9 | The colophon template (`frontmatter.typ`) renders the OCR-transcription line for English and the machine-assist line for French, never both; a French source with no machine-assist label still fails loud (spec-014 safety net intact). This is the sole FR-010 template exception, designed via `/frontend-design`. |
| C10 | An English folio marked `blank_recto: true` with empty OCR builds a blank reading recto over its verso facsimile (no fail-loud); an UNMARKED empty English folio still fails loud (FR-007); a `blank_recto` folio with non-empty OCR fails loud. (FR-014) |
