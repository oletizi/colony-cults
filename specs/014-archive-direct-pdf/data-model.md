# Phase 1 Data Model: Archive-Direct PDF Rendering

**Feature**: `specs/014-archive-direct-pdf` | **Date**: 2026-07-17

This feature changes **where the edition's inputs come from**, not the output shape. The target
`Edition` view-model (`@/pdf/model`) is unchanged and reused verbatim; the new data here is the
archive-read intermediate the reader assembles it from.

## Target (unchanged, reused) — `Edition` (`@/pdf/model`)

The reader MUST produce this exact shape; nothing downstream changes.

- `Edition { itemId, kind: 'issue'|'monograph', titlePage: TitlePageMeta, pages: EditionPage[], colophon: ColophonMeta }`
- `EditionPage { pageId, folioId, image: ImageAsset, ocrFrench: string (required), english: string (required), ocrCondition: string|null }`
- `ImageAsset { objectStoreKey (non-empty), sha256 (image-master hash), bytesPath (filled at fetch), provider: 'b2-cdn'|'source-iiif', width, height }`
- `ColophonMeta { archiveRef (non-empty), snapshotSourceId, images: ColophonImage[], translation: MachineAssistLabel, framing }`
- `MachineAssistLabel { engine, model: string|null, retrieved }`

**Untranslatable handling within the target**: an untranslatable page is represented as an
`EditionPage` with `english = ""` (blank column) — the ONLY place an empty `english` is
permitted, and only when the page's translation artifact is labeled `untranslatable`. Every
other empty/absent English is a fail-loud condition (FR-008). (The current snapshot builder
forbids empty `english` outright; the archive-direct reader is the component that distinguishes
the marked-blank case.)

## New — the archive-read model (internal to the reader)

### ArchivePageSource (per folio)

Assembled from the source's archive directory; the ordered basis for `EditionPage`.

| Field | Source | Notes |
|-------|--------|-------|
| `folioId` | folio sidecar filename `fNNN.yml` | matched `^f(\d+)\.yml$`, sorted ascending |
| `position` | index in the sorted folio list (1-based) | the extract-safe key: position → `pNNN` |
| `objectStoreKey` | `fNNN.yml` `object_store.key` (via `readProvenance`) | non-empty; the B2 master key |
| `imageSha256` | `fNNN.yml` top-level `sha256` (via `readProvenance`) | the image-master hash (NOT text) |
| `ocrFrench` | corrected `translation/pNNN.fr.txt` if present, else the `position`-th segment of `issue.txt` (`splitIssueOcr`) | required non-empty |
| `translation` | `translation/pNNN.en.txt` + its provenance label | see TranslationOutcome |
| `machineAssist` | `pNNN.en.txt.yml` `engine`/`model`/`retrieved` | → `MachineAssistLabel` (honest-absence) |
| `ocrCondition` | `fNNN.yml` / OCR provenance `ocr_status`/quality, if present | → `EditionPage.ocrCondition` |

`pNNN` is derived from `position` (`p` + zero-padded position), **not** from the folio number —
this is the fix for page-range extracts.

### TranslationOutcome (per page)

The decision that drives FR-007/FR-008, from the `translation` provenance label
(`@/archive/provenance` `ProvenanceFields.translation`, values `machine-assisted` |
`untranslatable`):

- **present + `machine-assisted`** → `{ english: <text> }` (non-empty). Normal page.
- **present + `untranslatable`** (empty by the *empty ⟺ untranslatable* invariant) →
  `{ english: "" }` → renders a blank EN column (FR-007).
- **absent** (no `pNNN.en.txt` / no provenance artifact) → **fail loud**, naming the page
  (FR-008) — a genuine translation gap, never a blank render.
- **inconsistent** (e.g. present translation labeled `untranslatable` but non-empty, or vice
  versa) → surfaced as a fail-loud error (records disagreement rather than guessing;
  corroborated by the `bib validate` `translation-label-inconsistent` gate upstream).

### ArchiveSourceResolution

| Field | Source | Notes |
|-------|--------|-------|
| `sourceId` | input | |
| `kind` | `sourceLayout(sourceId).kind` | `'periodical'` → issue(s); `'monograph'` → single unit |
| `dir(s)` | `monographDir` / `enumerateIssueDirs`+`issueDir` under `resolveArchiveRoot` | the source's archive directory(ies) |
| `archiveRef` | `resolveArchiveRef({ pinFile })` from `site/data/archive-source.json` `.ref` | the reproducibility pin, recorded in the colophon (unchanged) |

## Validation rules (fail-loud)

- Every folio's `object_store.key` and image `sha256` MUST be present; absent → fail loud.
- Every fetched master's bytes MUST hash to the recorded `sha256` (`assertMasterSha256Match`);
  mismatch → fail loud.
- Every page MUST have OCR (`ocrFrench` non-empty) and a translation OUTCOME (text, or a
  present untranslatable-marked blank, or a fail-loud absence).
- `archiveRef` MUST be non-empty.
- The source MUST resolve to an archive directory (`sourceLayout` registered/derivable);
  unresolved → fail loud naming the source.
- Positional folio↔translation mapping MUST cover every folio exactly once (count/gap check).

## Reuse map (unchanged components the reader feeds)

- `assembleColophon` (`@/pdf/load/colophon`) — from `ColophonPageInput[]` + `archiveRef`.
- `makeSourceMetaReader` (`@/pdf/load/source-meta`) — title-page creator/ark/catalogUrl from the
  bibliography SSOT (provider-agnostic; reused as-is).
- `makeArchivePinReader` / `resolveArchiveRef` (`@/pdf/config`) — the pin.
- The image-fetch stage + `assertMasterSha256Match` (`@/pdf/images`) — reused; pages carry
  `objectStoreKey` + `ark: null`, so the `b2` provider path applies.
- The Typst input serialization + renderer + variant handling (`@/pdf/render`) — unchanged.
