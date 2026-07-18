# Quickstart: English-Source Facsimile PDF

Validation scenarios proving the English-source path works end to end. See
[spec.md](./spec.md) for requirements, [contracts/reader-language-routing.md](./contracts/reader-language-routing.md)
for the routing contract, [data-model.md](./data-model.md) for entity semantics.

## Prerequisites

- A pinned archive clone resolvable via `COLONY_ARCHIVE_ROOT` (or `--archive-root`).
- The English documents present in the archive: PB-P056 (first target),
  PB-P057–P059.
- `vitest` for the unit/integration suite; Typst available for the live build.

## Unit / integration (fixture-driven)

Extend `tests/unit/pdf/archive-fixture.ts` to emit an **English source**:
`language: English` in every folio sidecar, `issue.txt` OCR present, and **no**
`translation/` directory.

Expected:

1. **English source builds, no translation required** (C1, SC-001)
   - Resolve + assemble an English fixture source → an `Edition` with pages whose
     recto reading text is the English OCR; no `translation/pNNN.en.txt` read.
2. **Recto = OCR at correct position** (C2, SC-002)
   - Each page's recto text equals its positional OCR segment (extract mapping
     honored).
3. **Empty English OCR fails loud** (C5, FR-007)
   - An English fixture page with an empty OCR segment and no corrected
     `pNNN.fr.txt` → `loadArchivePage` throws naming the page.
4. **Unsupported language fails loud** (C4, FR-006)
   - A fixture source with `language: Spanish` → resolution/build throws naming
     the value.
5. **French regression** (C3, US2)
   - A French fixture (unchanged) builds identically; a French fixture with a
     missing `pNNN.en.txt` still throws the FR-008 translation-gap error.
6. **English colophon honesty** (C6, SC-005)
   - The assembled edition has `machineAssist = null`; the colophon has an
     OCR-transcription line and no machine-assisted-translation line.
7. **Low-fidelity caveat surfaces** (C7, FR-009)
   - An English fixture folio whose provenance records a sub-high OCR condition →
     that caveat appears on the page (`ocrCondition`).

Run:

```bash
npx vitest run tests/unit/pdf
```

Expected: all pdf tests pass (existing 132 + the new English-path tests).

## Live acceptance (real build)

Build the first English target end to end:

```bash
COLONY_ARCHIVE_ROOT=<pinned-archive-clone> npx tsx scripts/build-pdf.ts PB-P056
```

Expected:

- A complete facsimile-edition PDF for PB-P056 (~52 pp): every page shows the
  verso facsimile beside the English OCR as the reading recto.
- The colophon discloses the recto as a machine OCR transcription (no
  machine-assisted-translation line) and carries the pinned-archive reference.
- No "missing translation" failure.

Then confirm PB-P057–P059 (press leaves) build, with the recorded low-fidelity
OCR caveat surfaced (SC-006).

## Success signal

- `npx vitest run tests/unit/pdf` green (existing + new English-path tests).
- PB-P056 (and PB-P057–P059) produce PDFs with the English OCR as the reading
  recto and an honest OCR-transcription colophon.
- `npx tsc --noEmit` clean; touched reader files within 300–500 lines.
