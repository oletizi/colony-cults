# Quickstart: validate the Internet Archive acquisition adapter

**Feature**: `specs/013-archiveorg-acquisition-path` | **Date**: 2026-07-16

The end-to-end proof is **SC-001**: acquire the de Groote 1880 book
(`nouvellefrancec00groogoog`) into the corpus + B2, reconciled to `archived` and shown as held by
`bib coverage`. This guide is a validation/run guide — implementation lives in `tasks.md`.

## Prerequisites

- Node.js + `tsx`; repo deps installed.
- **poppler** on PATH (`pdfimages`, `pdftoppm`, `pdfinfo`) — `brew install ... poppler`
  (`src/ocr/preflight.ts` declares it). Verify: `pdfimages -v`.
- `COLONY_ARCHIVE_ROOT` pointing at the per-session archive clone; B2 credentials resolvable via
  `resolveObjectStoreConfig()` (needed only for the real upload step, not for tests).
- The captured metadata fixture already in-repo:
  `bibliography/repository-responses/PB-P002/archiveorg-metadata-nouvellefrancec00groogoog-2026-07-16.json`.

## Fast validation — the test suite (no network, no B2)

```bash
npm run typecheck          # tsc --noEmit — the vocab widenings + new fields must compile clean
npm test                   # vitest run — all adapter/model/poppler unit tests
npx vitest run src/repository/internet-archive src/pdf/poppler   # just this feature's tests
```

Expected: green. Unit tests inject fakes for the HTTP client, the poppler runner, and the object store,
and use the captured de Groote metadata/scandata as fixtures — they exercise every invariant
(IA-INV-A..G) without touching archive.org or B2.

## Contract scenarios the tests must cover (map to spec acceptance)

| Scenario | Spec | Expected |
|---|---|---|
| Resolve a real `texts` item | US1 / FR-002 | identifiers `[{ia-item, id}]`, title non-empty, details `sourceUrl` |
| Resolve ambiguous PDFs | US5 / FR-003 / SC-006 | **throws** (no guessing) |
| Rights evidence only | US3 / FR-004 | `rightsRaw` = possible-copyright-status; no `rightsStatus` |
| Acquire without public-domain | US3 / FR-005 / SC-004 | **throws before any fetch** |
| Quality gate `unsound` | US2 / FR-008 / SC-002 | zero B2 bytes; status not advanced; staging retained |
| Staged-checksum mismatch | US2 / FR-008 | **throws**; nothing written |
| Fidelity: PDF equivalent | US5 / FR-009 | PDF exploded; **no** image-set fetch |
| Fidelity: PDF degraded | US5 / FR-009 | image-set (`_jp2.zip`/`_tif.zip`) fetched + used |
| Page-to-leaf, single image | US4 / FR-010 | `method: pdfimages-lossless` |
| Page-to-leaf, overlay page | US4 / FR-010 | `method: pdftoppm-rasterised` at recorded DPI |
| Count != approved range | US4 / FR-010 / SC-005 | **throws** |
| Excluded leaves | US4 / FR-011 / SC-003 | absent from page-masters; present in source PDF; recorded |
| Idempotent re-acquire | US1 / INV-E | already-stored assets skipped by key+checksum; no duplicate |
| `--dry-run` | XII / D-11 | no B2 write; staging retained; no re-fetch next run |
| Dispatch by copy type | INV-D / IA-INV-G | `ia-item` → this adapter only; ark/accession never build it |

## End-to-end acquisition (the real SC-001 run — frugal, one download)

> Principle XII: this is a real archive.org fetch. Do it **once**, keep locally, verify, upload only if
> good. Do not run an estimate-only pre-flight first.

```bash
# 1. Inventory the item as an ia-item RepositoryRecord (operator supplies the id)
tsx src/index.ts bib inventory --repository internet-archive --item nouvellefrancec00groogoog

# 2. Author the rights judgment (PD by 1880 publication; IA NOT_IN_COPYRIGHT corroborates)
tsx src/index.ts bib rights-assess <sourceId> --status public-domain --basis "Published 1880; author d. >70y; faithful reproduction not re-copyrightable"

# 3. Promote, then acquire (fetches the PDF to staging, runs the quality gate, explodes, uploads)
tsx src/index.ts bib promote <sourceId>
tsx src/index.ts bib acquire <sourceId>          # add --dry-run first to stage+gate+extract without B2 upload

# 4. Reconcile → archived, then confirm coverage shows it held
tsx src/index.ts bib reconcile <sourceId>
tsx src/index.ts bib coverage
```

**Expected outcome (SC-001)**: per-page image masters + the preserved source PDF land in B2 under
`archive/internet-archive/nouvellefrancec00groogoog/…`; the `RepositoryRecord` is `archived` with a
durable `qualityAssessment`, per-page method provenance, an `excludedLeaves` record, and a
`repository-source` PDF asset; `bib coverage` counts the de Groote book as a held work — in the **same
shape** as a Gallica source (SC-007). The first real run measures and records the fidelity ratio for this
item (confirming/adjusting the 0.90 threshold, research D-4).

## Do NOT

- Do **not** run `bib migrate` (INV-F — it rebuilds the SSOT from stale inputs).
- Do **not** fetch via `curl` or any client outside the shipped polite `HttpClient` (Principle XII).
- Do **not** upload before the quality gate says `sound` (SC-002).
