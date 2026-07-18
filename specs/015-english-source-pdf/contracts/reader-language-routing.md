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

**Fail-loud**: an English page with neither a corrected `pNNN.fr.txt` nor a
positional `issue.txt` segment (empty/absent OCR) → throw naming the page. (The
blank-recto tolerance from spec 014 is gated on the `untranslatable` marker,
which does not apply here.)

## ENGLISH PATH — edition + colophon

- `machineAssist` label absent (null) for the edition.
- Colophon carries an **OCR-transcription** line (recto is a machine OCR
  transcription of the English original; OCR engine/status + low-fidelity caveat
  when present) and **no** machine-assisted-translation line.
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
| C6 | English colophon: OCR-transcription line present, machine-assisted-translation line absent, `machineAssist` null. |
| C7 | `ocrCondition` (low-fidelity caveat) surfaces on English pages that record one. |
| C8 | Folio enumeration, positional mapping, object-store fetch/verify, reproducibility, and Typst templates unchanged. |
