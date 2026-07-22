# Implementation Plan: Archive-Direct PDF Rendering

**Branch**: `feature/edition-publishing` (long-lived PDF-generation branch) | **Date**: 2026-07-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/014-archive-direct-pdf/spec.md`

## Summary

Make `pdf:build` assemble its `Edition` view-model **directly from our normalized archive**
instead of the Gallica-coupled committed snapshot. A new PDF-domain archive→`Edition` reader
(`src/pdf/load/`) enumerates a source's folios, sources page images from `object_store` (B2,
sha256-verified), reads OCR + translation from the archive text + provenance, maps folios to
translations **by position** (fixing page-range extracts), honors the translation-artifact
`untranslatable` label (blank EN; absent → fail loud), and records the pin in the colophon.
Everything downstream of edition assembly is already provider-agnostic and reused unchanged.
Unblocks PB-P055 (archive.org), PB-P054 (Gallica extract), PB-P002, and any future source from
any archive. Detail in [research.md](research.md); shapes in [data-model.md](data-model.md);
interface in [contracts/](contracts/).

## Technical Context

**Language/Version**: TypeScript 5.3, ESM, executed with `tsx`. `@/*` path imports.

**Primary Dependencies**: `@/archive` (`readProvenance`, `location` resolvers, `checksum`,
`ObjectStore`/`S3ObjectStore`, `resolveObjectStoreConfig`), `@/pdf` (`Edition` model, colophon,
source-meta, pin, image-fetch, Typst render — reused), `@/bibliography` (source catalog meta).
No new runtime dependency. The generic OCR splitter (`splitIssueOcr`) is reused; the
Gallica-coupled `@/browser/load/books.ts` is NOT used.

**Storage**: reads the **archive clone** (`COLONY_ARCHIVE_ROOT`) — folio sidecars (`fNNN.yml`),
`translation/pNNN.{en,fr}.txt` + provenance, `issue.txt`; page-image masters from **B2**
(`object_store.key`, via the CDN `b2` provider or `S3ObjectStore`). The committed snapshot
(`site/data/*.json.gz`) is no longer read; the pin sidecar `site/data/archive-source.json` is.

**Testing**: `vitest`. Unit: the reader against fixture archive dirs + `FakeObjectStore` /
`makeFakeFetch`; integration: a real fixture source built to a Typst input document with a fake
`TypstRunner` (no network). New tests under `tests/unit/pdf/` + `tests/integration/pdf/`.

**Target Platform**: Node CLI (internal PDF generation; requires the archive clone).

**Project Type**: Single TypeScript CLI project; one new `src/pdf/load/` reader + build/batch
wiring; no new top-level surface.

**Performance Goals**: not latency-bound; per-page provenance reads + one image fetch per page
(sha256-verified). No snapshot (de)serialization on the PDF path.

**Constraints**: fail-loud, no fallbacks/mock outside tests (Constitution V); no `any`/`as`/
`@ts-ignore` (VII); files 300–500 lines (VII); composition + injected collaborators — archive
root, provenance reader, source-meta, pin, image source — over ambient globals (VI); `@/`
imports. PDF-scoped: no change to `@/browser` or the browser snapshot path.

**Scale/Scope**: v1 targets the buildable archived sources (PB-P055, PB-P054, PB-P002, and the
existing Gallica set), both edition variants.

## Constitution Check

*GATE: evaluated against `.specify/memory/constitution.md` v1.0.0. Re-check post-Phase-1.*

| Principle | Compliance |
|-----------|------------|
| I. Evidence Before Narrative | The edition is assembled from the recorded provenance (masters + checksums + OCR + translation) and pinned to an archive commit — every rendered page is traceable. |
| III. Provenance Is Mandatory | Colophon records the pin (`archiveRef`) + per-image object key + sha256 (reused, unchanged); images sha256-verified before render. |
| IV. Respect Copyright | Machine-assist translation labelling carries through unchanged; the untranslatable marker distinguishes deliberate blanks from gaps (no fabricated text). |
| V. Fail Loud, No Fallbacks | Missing master / checksum mismatch / unmarked missing translation / unresolved source / missing pin all fail loud; the retired IIIF path is NOT a fallback — a missing object_store master is an archive gap, not a silent alternative. |
| VI. Composition Over Inheritance | The reader composes over injected collaborators (archive root, provenance reader, source-meta, pin, image source); no inheritance. |
| VII. Type Safety | No `any`/`as`/`@ts-ignore`; `@/` imports; reader split into small modules (resolve / folio-enumerate / ocr+translation+marker / image-handle / assemble) each ≤ 300–500 lines. |
| VIII. Faithful Tool Adoption | Authored via the stack-control front door (design → define → this extend → execute → ship); reuses the shipped `@/pdf` renderer + `@/archive` layer rather than reimplementing. |
| IX. Durable Work | Committed/pushed at each boundary. |
| X. No Git Hooks | None added. |
| XI. Design Through the Design Skill | No user-facing UI (a CLI/reader change; edition content shape unchanged); the shipped edition template is reused. |

**Gate result**: PASS. No violations → Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/014-archive-direct-pdf/
├── plan.md              # This file
├── research.md          # Phase 0 — 7 technical decisions
├── data-model.md        # Phase 1 — archive-read model + Edition mapping + untranslatable
├── quickstart.md        # Phase 1 — 5 runnable validation scenarios
├── contracts/
│   └── archive-edition-reader.md   # the reader's surface + guarantees G-1..G-10
├── checklists/
│   └── requirements.md  # spec quality checklist (passed)
└── tasks.md             # Phase 2 — created by /speckit-tasks
```

### Source Code (repository root)

```text
src/pdf/load/
├── archive-edition.ts        # NEW — makeArchiveEditionReader: archive -> Edition (orchestrator, injectable)
├── archive-source.ts         # NEW — resolve source dir + folio enumeration (via @/archive/location + readProvenance)
├── archive-page.ts           # NEW — per-page: OCR (issue.txt/pNNN.fr.txt) + translation + untranslatable marker + positional pNNN mapping
├── edition.ts                # EXISTING — snapshot reader/builder left in place (unused by the archive-direct build; not deleted here)
├── colophon.ts               # EXISTING — reused unchanged (assembleColophon)
└── source-meta.ts            # EXISTING — reused unchanged (title-page catalog)

src/pdf/render/
├── build.ts                  # EDIT — buildItem wires makeArchiveEditionReader (archive root) instead of makeCorpusSnapshotReader; image fetch reused
└── batch.ts                  # EDIT — buildSource/buildAll enumerate from the archive/bibliography (retire listSnapshotSourceIds for this build)

scripts/build-pdf.ts          # EDIT — read/require the archive root (COLONY_ARCHIVE_ROOT / --archive-root); no snapshot dependency

src/archive/location.ts       # EDIT (if needed) — register/derive source layouts for the target sources (PB-P054/P055/P002)

tests/unit/pdf/               # NEW — archive-source, archive-page (positional map + untranslatable + absent-gap), image sha256 verify
tests/integration/pdf/        # NEW — fixture-archive source built end-to-end (fake TypstRunner + fake image fetch)
```

**Structure Decision**: A new archive→`Edition` reader in `src/pdf/load/`, split into small
injectable modules (source-resolve, folio-enumerate, per-page OCR/translation/marker, and the
orchestrating assembler), which `buildItem`/`buildSource` wire in place of the snapshot reader.
Colophon, source-meta, pin, image-fetch, Typst render, and variant handling are reused unchanged
(they are already provider-agnostic). No `@/browser` module or the browser snapshot path is
modified — the mandate is PDF rendering only. `makeCorpusSnapshotReader`/the snapshot
`EditionBuilder` are left in place (unused by the archive-direct build), not deleted in this
feature.

## Complexity Tracking

No Constitution Check violations — this section is intentionally empty.
