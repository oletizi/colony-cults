# Phase 0 Research: Archive-Direct PDF Rendering

**Feature**: `specs/014-archive-direct-pdf` | **Date**: 2026-07-17

The design decisions are settled in the design record; this file records the **technical**
resolutions the plan builds on, grounded in the current code (`src/pdf`, `src/browser/load`,
`src/archive`). The untranslatable-marker representation — the only prior open item — was
resolved by the translation team (merged 2026-07-17) and is recorded in the spec.

## Decision 1 — A PDF-domain archive→Edition reader; downstream is already provider-agnostic

**Decision**: Add a new reader in `src/pdf/load/` that assembles the `Edition` view-model
directly from the archive, and switch `pdf:build` to it. Everything downstream of edition
assembly — `assembleColophon` (`@/pdf/load/colophon`), `SourceMetaReader`
(`@/pdf/load/source-meta`), the pin reader, the Typst input serialization, the image-fetch
stage, and batch record-and-continue — is **already provider-agnostic and is reused unchanged**.

**Rationale**: The only load-path coupling is the single `CorpusSnapshotReader` implementation
`makeCorpusSnapshotReader` (`readSnapshotCorpus` from `@/browser/load/snapshot`) in
`edition.ts:29`, plus batch's `listSnapshotSourceIds` (`*.json.gz` scan). The `Edition` model
(`@/pdf/model`) is self-contained (deliberately does not import `@/browser/model`).

**Why not reuse `readRawCorpus`** (the existing archive→`CorpusSnapshot` reader): it is the
Gallica-coupled path — for monographs it goes through `@/browser/load/books.ts`
`resolveMonographUnit` → `parseArkFromCatalogUrl`, which fails loud on any non-Gallica
`catalog_url`, and its per-page translation mapping is `fNNN → pNNN` by folio number (the
extract bug). Reusing it re-imports the exact coupling this feature removes. The new reader
reuses only the **provider-agnostic low-level readers** (`@/archive` provenance/checksum,
`@/archive/location` directory resolvers, and where truly generic the OCR splitter) and owns
the parts that must change (folio ordering, positional translation mapping, object_store
image handles, untranslatable handling).

**Why produce `Edition` directly rather than a new `CorpusSnapshotReader`**: the untranslatable
page (blank EN) cannot pass through the current snapshot→Edition builder — `toEditionPage`
fails loud on empty `english` (G-2), and `@/browser/model`'s `RawPage` has no untranslatable
state. Threading an untranslatable flag through the browser `CorpusSnapshot`/`RawPage` model
would touch `@/browser` (out of the PDF-only mandate). Assembling the `Edition` in the PDF
domain keeps the marker handling, extract mapping, and object_store sourcing entirely in
`src/pdf`, changing no browser model. (`makeEditionBuilder`/the snapshot reader are left in
place, unused by the build, for any legacy path; not deleted in this feature.)

## Decision 2 — Source → archive-directory resolution via `@/archive/location`

**Decision**: Resolve a source's archive directory with the existing `@/archive/location`
helpers: `sourceLayout(sourceId)` → `{ case, type, slug, kind }`, then `monographDir` /
`issueDir` / `enumerateIssueDirs` under `resolveArchiveRoot(repoRoot, override?, env)`
(reads `COLONY_ARCHIVE_ROOT`, fail-loud with no default).

**Rationale**: This is the sanctioned reverse-lookup already used by the fetcher/acquisition
writers, archive-neutral by construction. **Consequence**: `sourceLayout` uses a static
`SOURCE_LAYOUTS` registry plus a runtime overlay; a source not yet registered fails loud —
so the plan MUST ensure the target sources (PB-P054, PB-P055, PB-P002, and the general set)
resolve, via `registerSourceLayout`/`deriveSourceLayout` or a registry addition. This is a
real task, not an afterthought.

## Decision 3 — Page enumeration + ordering from the folios; positional translation mapping

**Decision**: Enumerate a source's pages from its folio sidecars (`fNNN.yml`, matched
`^f(\d+)\.yml$`), sorted ascending by folio number — that IS the page sequence. Map each
folio to its translation **by position in the source's own folio sequence** (the 1st folio →
`p001`, the 2nd → `p002`, …), NOT by the folio's absolute number.

**Rationale**: This dissolves the page-range-extract mismatch (PB-P054: folios `f048–f050`,
translations `p001–p003`). The current `@/browser/load/translation` maps `fNNN → p<folioNum>`,
which is exactly the bug. Positional mapping is correct for both full sources (folios `f001…`
↔ `p001…`, trivially aligned) and extracts. The merged IA leaf-numbering normalization
(0-based → 1-based) means folio numbering is already consistent before this mapping.

## Decision 4 — OCR + translation + the untranslatable marker

**Decision**: Per page —
- **FR OCR**: from the corrected `translation/pNNN.fr.txt` when present, else the page's
  segment of the form-feed-delimited `issue.txt` (reuse the generic `splitIssueOcr` splitter).
- **EN translation + marker**: read `translation/pNNN.en.txt` and its provenance sidecar
  (`pNNN.en.txt.yml`) via `@/archive` `readProvenance`, which already parses the `translation`
  label (`ProvenanceFields.translation`). Then:
  - label `machine-assisted` (non-empty) → the translation text, as today;
  - label `untranslatable` (empty by the *empty ⟺ untranslatable* invariant) → a **blank EN
    column** (FR-007);
  - **no translation artifact at all** (absent `.en.txt`/sidecar) → **fail loud**, naming the
    page (FR-008).
- **Machine-assist label**: from the `pNNN.en.txt.yml` `engine`/`model`/`retrieved` →
  `MachineAssistLabel`, carried into the colophon unchanged (reuse the existing derivation).

**Rationale**: The marker is the translation-artifact provenance label the team just merged
(`TranslationLabel = 'machine-assisted' | 'untranslatable'`, `src/translate/artifacts.ts`;
enforced by `bib validate`), and `@/archive/provenance` already reads it — no new archive
format. The present-empty-untranslatable vs absent-gap distinction is exactly FR-007 vs FR-008.

## Decision 5 — Images from `object_store`, sha256-verified; iiif retired for this path

**Decision**: Each page's image handle is the folio sidecar's `object_store.key` + top-level
image-master `sha256`. The build stages the master by fetching it and verifying its sha256
against the recorded value (reuse `assertMasterSha256Match`). The `source-iiif`/ark image path
is not used by the archive-direct reader — pages carry `ark: null`.

**Rationale**: Images-from-`object_store` is the whole point (dissolves the ark/IIIF coupling).
Two viable fetch mechanisms both verify against the same folio-sidecar sha256: (a) the existing
`makeB2ImageSource` public-CDN GET (`${CORPUS_CDN_BASE}/<key>`) — reused as-is, and (b)
`S3ObjectStore.get(key)` (credentialed) + `sha256OfBytes`. **Default to the existing CDN b2
provider** (already wired, already sha256-verifies, no new credentials on the read path); the
`S3ObjectStore.get` path is an available alternative when the CDN base is not configured. A
page whose master is absent (fetch 404 / not in the store) fails loud — no IIIF fallback.

## Decision 6 — Reproducibility pin preserved from the committed pin sidecar

**Decision**: `archiveRef` continues to come from `site/data/archive-source.json` `.ref` (via
the existing `resolveArchiveRef`/`makeArchivePinReader`), recorded in the colophon unchanged.
The archive-direct reader reads the archive clone that the operator has checked out at that
pin; it MAY assert the clone's `HEAD` matches the pin and fail loud on a mismatch (a
reproducibility guard) — a small, valuable integrity check.

**Rationale**: The pin sidecar is a tiny ref file, independent of the (now-unused) committed
snapshot; keeping it as the recorded `archiveRef` preserves the exact colophon provenance
guarantee (G-5 of corpus-print-pdf) with zero behavior change to reproducibility. Reading the
archive clone AT that ref is the operator's responsibility, optionally asserted.

## Decision 7 — `pdf:build` requires the archive; snapshot dependency dropped

**Decision**: `pdf:build` reads the archive (`COLONY_ARCHIVE_ROOT` / `--archive-root`) and no
longer `site/data/*.json.gz`. `--all` source discovery enumerates from the archive / the
registered source set / the bibliography (sources with archived masters), not by scanning
snapshot files (`listSnapshotSourceIds` is retired for the archive-direct build). The pin
sidecar `site/data/archive-source.json` is still read (Decision 6). A missing archive root
fails loud (no snapshot fallback for PDF rendering).

**Rationale**: The committed snapshot was the browser's offline-build data source (Netlify);
PDF generation is an internal operation that already needs the archive for image masters. The
browser snapshot path stays for the browser (out of scope).

## Testing approach

- Reuse the pdf test doubles: the in-memory fixture builders in `tests/unit/pdf/edition.test.ts`
  (adapted to the new reader's inputs), `FakeObjectStore` (`tests/unit/archive/fake-object-store.ts`)
  and/or the `makeFakeFetch` pattern (`tests/unit/pdf/image-fetch.test.ts`) for image bytes,
  and `fakeTypstRunner` for the render boundary — all no-network.
- The archive-direct reader is unit-tested against a **fixture archive dir** (a temp
  `archive/cases/.../<slug>/` with `fNNN.yml` + `translation/pNNN.{en,fr}.txt` + sidecars +
  an `issue.txt`), covering: full source, page-range extract (folios `f048–f050` ↔ `p001–p003`),
  an `untranslatable`-labeled page → blank EN, an absent translation → fail loud, and a missing
  master → fail loud. An integration test builds a real fixture source end-to-end to a Typst
  input document with a fake TypstRunner + fake image fetch.

## Consolidated open items (all plan-time, non-blocking)

| Item | Resolution |
|------|------------|
| Untranslatable marker representation | RESOLVED (merged): the `translation` provenance label; `untranslatable` → blank EN, absent → fail loud (Decision 4) |
| Source-layout registration for target sources | Register/derive layouts for PB-P054/P055/P002 (+ the general set) so `sourceLayout` resolves (Decision 2) — a task |
| Image fetch mechanism | Default the existing CDN `b2` provider (sha256-verified); `S3ObjectStore.get` available (Decision 5) |
| `--all` source discovery | Enumerate from the archive / bibliography, not snapshot files (Decision 7) |
| Archive-clone-at-pin assertion | Optional reproducibility guard (Decision 6) |
