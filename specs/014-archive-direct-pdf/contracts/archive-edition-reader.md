# Contract: Archive-Direct Edition Reader

**Feature**: `specs/014-archive-direct-pdf`

The new `src/pdf/load/` component that assembles an `Edition` (`@/pdf/model`) directly from the
archive, replacing the snapshot `CorpusSnapshotReader` for the PDF build. It is the only new
load surface; everything downstream (`assembleColophon`, source-meta, pin, image fetch, Typst
render, batch) is reused unchanged.

## Surface (illustrative — final signatures at implementation)

An injectable reader mirroring the existing `EditionBuilder` seam:

- `interface ArchiveEditionReader { build(sourceId: string, itemId: string): Promise<Edition> }`
- `makeArchiveEditionReader(deps): ArchiveEditionReader` — deps: an archive-root resolver, the
  `SourceMetaReader` (reused), the `ArchivePinReader` (reused), and the image-master provenance
  reader (`@/archive` `readProvenance`). Pure of ambient globals (Constitution VI); the archive
  root + pin come in through deps so the reader is unit-testable against a fixture dir.

`pdf:build` (`buildItem`/`buildSource`/`buildAll`) wires this reader in place of
`makeCorpusSnapshotReader`; the image-fetch stage, colophon, source-meta, pin, and Typst render
are unchanged.

## Guarantees

- **G-1 (archive-only)**: the `Edition` is assembled entirely from the archive (folio
  provenance, `object_store`, OCR + translation text, pin) — it reads NO committed corpus
  snapshot (`site/data/*.json.gz`) (FR-001).
- **G-2 (source-archive independent)**: no `catalog_url`/ark is parsed or required to render;
  pages carry `ark: null`; the outcome is identical regardless of the origin archive (FR-002).
- **G-3 (folio-ordered)**: pages are enumerated from the source's folio sidecars (`fNNN.yml`)
  and produced in folio-ascending order (FR-003).
- **G-4 (positional translation mapping)**: each folio is paired with its translation by
  position in the source's own folio sequence (1st folio → `p001`, …), NOT by the folio's
  absolute number — page-range extracts (folios `f048–f050` ↔ translations `p001–p003`) align
  correctly (FR-006, SC-002).
- **G-5 (object_store images, verified)**: each page's image handle is the folio sidecar's
  `object_store.key` + image-master `sha256`; the staged master's bytes are verified against
  that sha256; a missing master or checksum mismatch fails loud with no IIIF fallback
  (FR-004/FR-005, SC-003).
- **G-6 (untranslatable marker)**: a page whose translation artifact is labeled
  `untranslatable` renders `english = ""` (blank column) and does not fail the build; a page
  with NO translation artifact fails loud naming the page; a present/label inconsistency fails
  loud (FR-007/FR-008, SC-004).
- **G-7 (reproducibility)**: the colophon `archiveRef` is the pin (`site/data/archive-source.json`
  `.ref`), recorded unchanged; optionally the archive clone's HEAD is asserted to match the pin
  (FR-009, SC-005).
- **G-8 (variants + machine-assist)**: both `parallel` and `english-only` variants and the
  machine-assist label flow through unchanged (FR-010/FR-011).
- **G-9 (fail-loud, no partial)**: any missing/inconsistent input (unresolved source dir,
  missing master, checksum mismatch, unmarked missing translation, missing pin, uncovered
  folio) fails loud with a descriptive, page-/source-named error; no partial or placeholder
  content (FR-012).
- **G-10 (same Edition shape)**: the produced `Edition` is byte-for-byte the shape the existing
  renderer consumes; no downstream change is required (FR-013).

## `pdf:build` surface changes

- Reads the archive root (`COLONY_ARCHIVE_ROOT` / an `--archive-root` flag), fail-loud if unset;
  no longer reads `site/data/*.json.gz` (the pin sidecar `site/data/archive-source.json` is
  still read for `archiveRef`).
- `--all` enumerates buildable sources from the archive / bibliography (sources with archived
  masters), not by scanning snapshot files.
- Existing flags (`--variant`/`--no-french`, `--out`, selector) unchanged.
