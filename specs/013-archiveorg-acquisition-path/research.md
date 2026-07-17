# Phase 0 Research: Internet Archive acquisition adapter

**Feature**: `specs/013-archiveorg-acquisition-path` | **Date**: 2026-07-16

This resolves the plan's open unknowns against the **shipped code** and the **real
de Groote item** (`nouvellefrancec00groogoog`, the SC-001 first consumer). The five
design-time scoping questions were already answered in `/speckit-clarify` (spec.md
§ Clarifications); this file fixes the remaining *implementation* unknowns and records
where the shipped reality differs from the spec's stated assumptions.

## Decision log

### D-1 — Fit the shipped `RepositoryAdapter` seam; add a third `RepositoryName`

**Decision**: Implement `RepositoryAdapter` in `src/repository/internet-archive/`, register it
in `RepositoryAdapterRegistry`, and extend the closed dispatch vocabulary in three places.

**Rationale / grounding** (verified in the tree, not assumed):
- `src/repository/adapter.ts` — `RepositoryName = 'gallica' | 'new-italy-museum'`; the interface
  is `repository` / `resolve(locator, ctx)` / `collectRightsEvidence(item)` / `acquire(record, ctx)`
  returning `ResolvedRepositoryItem` / `RightsEvidence` / `AcquisitionResult`. **No `search` method.**
- `src/repository/registry.ts` — `RepositoryAdapterRegistry` dispatches **by copy-identifier type**
  via an explicit table (`ark`→gallica, `accession`→new-italy-museum; "other identifier types carry
  no dispatch weight"). Fails loud on unknown/ambiguous/unregistered (INV-D).
- `src/model/identifiers.ts` — `CopyLevelIdentifierType` is the closed copy-identifier vocabulary.

**Three edits to the closed vocabularies** (each a deliberate, operator-visible widening):
1. `RepositoryName` gains `'internet-archive'`.
2. `CopyLevelIdentifierType` gains `'ia-item'`.
3. The registry dispatch table gains `ia-item → internet-archive`.

**Alternatives rejected**: locator-shape sniffing (violates INV-D "no locator-shape sniffing");
a one-off manual mirror script (violates the reusable-adapter mandate + Principle VIII).

### D-2 — `AcquiredAsset.role` / `.sequence` **already exist**; this feature fixes their vocabulary

**Decision**: Do **not** add new fields. `src/model/acquired-asset.ts` already declares
`role?: string` (doc example `front` / `reverse` / `page`) and `sequence?: number`. This feature
establishes the canonical role values **`repository-source`** (the preserved PDF) and
**`page-master`** (each per-page image) and narrows the field to a typed union
`role?: 'front' | 'reverse' | 'page' | 'repository-source' | 'page-master'` (or a shared
`AcquiredAssetRole` union) so the distinction is type-checked, not stringly-typed.

**Note for the operator**: spec FR-012 / clarification Q5 say "add an explicit `role` (+ `sequence`)
field". The fields are already present — so the work is *vocabulary + typing*, smaller than the
wording implies. Captured, not silently reinterpreted (Constitution XIV).

### D-3 — The degraded-PDF fallback source is `_jp2.zip` **OR `_tif.zip`** (real-item finding)

**Decision**: The evidence-triggered high-fidelity fallback (FR-009) fetches the archive's
full-resolution **page-image set**, which is `<id>_jp2.zip` for most items **but `<id>_tif.zip`
for Google-scanned items** — and the de Groote book is a Google scan. `resolve` selects whichever
full-resolution image-set archive the item actually exposes (fail loud if neither exists when the
fidelity rule demands it).

**Grounding**: `bibliography/repository-responses/PB-P002/archiveorg-metadata-nouvellefrancec00groogoog-2026-07-16.json`
lists `nouvellefrancec00groogoog_tif.zip` ("Single Page Processed TIFF ZIP", 58 MB, `filecount: 421`)
and **no** `_jp2.zip`; the PDF is `nouvellefrancec00groogoog.pdf` ("Image Container PDF", 11.8 MB);
`scanner: google`; `_scandata.xml` is present.

**⚠ Operator flag**: FR-009 names `_jp2.zip` specifically. The de Groote item exposes `_tif.zip`
instead. Generalizing the fallback to "the full-resolution image set (`_jp2.zip` or `_tif.zip`)" is
capturing knowably-implied scope (the intent is "fetch the high-res image set"), not a scope change —
but it touches an FR wording, so it is surfaced here for the operator rather than silently absorbed.

### D-4 — Dimension-ratio fidelity threshold (FR-009), fixed and testable

**Decision**: For a sample of approved pages, let `pdfEdge` = longest-edge pixels of the page's
extracted image (from `pdfimages -list`), `scanEdge` = the recorded longest-edge for the same leaf
from `scandata.xml`. Ratio `r = pdfEdge / scanEdge`. Treat the PDF as **materially degraded** when the
**median `r` across the sample < 0.90** → fetch and use the full-resolution image set (D-3). When
median `r ≥ 0.90` → explode the PDF. Sample = min(10, N) pages spread across the range (Google PDFs
downsample uniformly, so a spread sample is robust and cheap).

**Rationale**: a 10% linear shortfall ≈ ~19% pixel-area loss — a visible legibility/deep-zoom/OCR
drop; at or above 0.90 the derived PDF is effectively the scan and exploding it is the frugal choice.
The rule is falsifiable and is **confirmed or adjusted on the de Groote acquisition itself** (SC-001) —
the first real run measures `r` for `nouvellefrancec00groogoog` and records it in the
`qualityAssessment`.

**Frugality (Principle XII)**: the probe needs the PDF (already fetched to staging in acquire step 1)
plus `scandata.xml` (a cheap bounded metadata file) — **no extra image download**. The 58 MB `_tif.zip`
is pulled *only if* the rule fails. No live 70 MB download is performed at plan time (that would waste
the request the real acquisition must make anyway).

### D-5 — Per-page extraction test (FR-010): one raster object → lossless, else rasterise

**Decision**: For each approved logical page, run `pdfimages -list <pdf>` and read that page's rows.
Extract **losslessly with `pdfimages`** iff the page has **exactly one raster image object whose
dimensions cover the page and no vector/text overlay** (single image row for the page, image
dimensions ≈ page dimensions). Otherwise **rasterise with `pdftoppm`** at the scan's native DPI (from
`scandata.xml`; fall back to **400 DPI** when absent). Record per-page provenance:
`{ leaf, logicalPage, method: 'pdfimages-lossless' | 'pdftoppm-rasterised', sourcePdfObject | resolutionDpi }`.
Verify the produced count **equals** the approved leaf range or fail loud (FR-010 / SC-005).

**Grounding**: the de Groote PDF is an "Image Container PDF" (one image per page) — so most pages take
the lossless path; the test still guards the mixed/overlay page.

### D-6 — Poppler extraction is **new** work; reuse the injected exec runner, not `src/pdf/`

**Decision**: Build a small injected poppler wrapper (`pdfimages` / `pdftoppm` / `pdfinfo`) composed
over the shipped `execCommand(command, args, stdin?)` in `src/ocr/exec.ts` (the sanctioned, testable
shell-out; tests inject a fake runner — Principle VI). `src/ocr/preflight.ts` already declares the
poppler brew dependency; extend the preflight check to the extraction verbs.

**Note for the operator**: spec Assumptions say "the project PDF machinery (`src/pdf/`) + poppler …
all present." Verified: `src/pdf/` is a PDF **builder** (typst/render/publish) — it does **not** explode
PDFs into page images, and poppler is referenced only by `src/ocr/preflight.ts`. So the per-page
*extraction* machinery is largely **new** (composed on the existing exec runner), not pre-existing.
Captured and surfaced (Constitution XIV) — this is a real build cost the spec under-stated, not a
scope cut.

### D-7 — HTTP access via the shipped polite client (Principle XII)

**Decision**: All archive.org calls (metadata JSON, `scandata.xml`, PDF bytes, `_tif.zip`/`_jp2.zip`
bytes) go through the shipped rate-limited `HttpClient` (`src/gallica/http-client.ts`:
`getText(url)` / `getBytes(url)`, polite User-Agent, backoff, `Retry-After`, injected `RateLimiter`
from `src/gallica/rate-limiter.ts`). The adapter depends on a **minimal injected fetch interface**
(as the museum adapter depends on `MusarchHttpClient`, structurally satisfied by `HttpClient`), so tests
inject a fake. **No ad-hoc `curl`** (Principle XII).

Endpoints: metadata `https://archive.org/metadata/<id>`; downloads `https://archive.org/download/<id>/<file>`;
details page `https://archive.org/details/<id>` (→ `originalUrl`).

### D-8 — Staging + fixity + snapshot reuse

**Decision**: Stage the PDF (and exploded images / any fetched image-set) under the per-session archive
clone `COLONY_ARCHIVE_ROOT` in a scratch subdir; **delete on successful B2 upload, retain on a rejected
quality gate** (FR-007). Record fixity (byte length, sha256) using the shipped checksum util
(`src/archive/checksum.ts`). Record `metadataSnapshots` (retrievedAt, endpoint, checksum) via the shipped
snapshot store `src/sourcegroup/snapshot.ts` (`writeSnapshot` / `readSnapshot`,
`MetadataSnapshotInput` → `MetadataSnapshotRef` on the record). Idempotency (INV-E): detect an already-
stored asset by canonical object-store key + verified checksum before re-fetch; a remote-bytes change vs a
recorded checksum → throw, write nothing for that asset.

### D-9 — Rights: evidence proposed, judgment authored, acquire fail-closed

**Decision**: `collectRightsEvidence` returns the IA `possible-copyright-status` as `RightsEvidence.rightsRaw`
plus grounded `date` / `creator` — **no verdict**. The operator authors `rightsAssessment` on the
`RepositoryRecord` (existing field; `src/model/rights.ts` `RightsAssessment.rightsStatus ∈
{public-domain, restricted, uncertain}`) via the shipped `bib rights-assess` verb. `acquire` throws before
any image fetch unless `rightsAssessment.rightsStatus === 'public-domain'` (INV-B / FR-005). For de Groote:
PD by 1880 publication; IA `NOT_IN_COPYRIGHT` corroborates; the Google "non-commercial use" notice is
preserved verbatim as evidence and never declared void (FR-006).

### D-10 — New durable record fields: `qualityAssessment`, `excludedLeaves`

**Decision**: Add two durable provenance fields to `RepositoryRecord` (verified absent today):
- `qualityAssessment?`: `{ status: 'sound' | 'unsound', assessedBy, assessedAt, sourceFileChecksum,
  expectedPageCount, observedPageCount, approvedLeafRange, notes }` (FR-008).
- `excludedLeaves?`: `Array<{ leaf, classification, reason }>` (FR-011).

These are canonical provenance on the record, not session state; `acquire` re-verifies the staged PDF's
checksum matches `qualityAssessment.sourceFileChecksum` before acting (FR-008, edge case).

### D-11 — `dryRun` semantics = the frugal verify-before-upload gate (Principle XII); full wiring set

**Decision**: `AcquisitionContext` already carries `dryRun?: boolean`. For IA, `dryRun: true` means
**fetch → quality-gate → extract to staging, but do NOT upload to B2 and do NOT delete staging** —
i.e. the Principle-XII "download once, keep locally, verify, upload only if good" flow, with the upload
withheld and the staged masters retained for inspection. It MUST NOT re-fetch on the subsequent real run
(the verified local master is re-read from staging, zero re-download). This deliberately avoids the
museum adapter's `dryRun` defect (TASK-29: museum acquire ignores `--dry-run` and would write to B2) —
the IA adapter's `acquire` asserts the no-B2-write invariant under `dryRun` with a test.

**Full wiring set** (verified call sites — all in addition to the new `src/repository/internet-archive/`):
1. `src/repository/adapter.ts` — `RepositoryName += 'internet-archive'`.
2. `src/model/identifiers.ts` — `CopyLevelIdentifierType += 'ia-item'`.
3. `src/repository/registry.ts` — `IDENTIFIER_TYPE_REPOSITORY.ia-item = 'internet-archive'`.
4. `src/sourcegroup/acquire.ts` — `buildRegistry(...)` registers the IA adapter alongside Gallica/museum.
5. `src/cli/bib-inventory.ts` — the `asRepositoryName` allowlist accepts `internet-archive`, routing to IA inventory.
6. `src/cli/` — a new `bib-acquire-internet-archive.ts` `buildInternetArchiveAdapterForMember(...)` peek-builder
   (mirrors `buildMuseumAdapterForMember`), wired into `runAcquireCli` so an IA adapter is built only when the
   selected copy is an `ia-item` record (an `ark`/`accession` acquire never pays the IA fetch cost).

## Unknowns resolved

| Unknown (from spec/design) | Resolution |
|---|---|
| Fidelity threshold "materially smaller" (FR-009) | D-4: median `r < 0.90` over a spread sample; confirmed at first acquire |
| Fallback image-set format | D-3: `_jp2.zip` **or `_tif.zip`** (de Groote is `_tif.zip`) |
| Per-page lossless-vs-rasterise test + DPI (FR-010) | D-5: exactly-one-page-covering-raster-object → `pdfimages`; else `pdftoppm` at native/400 DPI |
| Staging location + lifecycle | D-8: scratch under `COLONY_ARCHIVE_ROOT`; clean on success, retain on rejection |
| `role`/`sequence` field | D-2: already exist; establish `repository-source`/`page-master` vocabulary + type |
| Extraction machinery availability | D-6: **new**, composed on `src/ocr/exec.ts` `execCommand` |
| Polite HTTP client | D-7: reuse `src/gallica/http-client.ts` `HttpClient` |
| Discovery automation | Out of scope for v1 (operator supplies item id); `advancedsearch` `DiscoveryMechanism` captured for a later spec (spec FR-014) |

## Operator-surfaced items (Constitution XIV — nothing cut, three things flagged)

1. **D-3**: FR-009 says `_jp2.zip`; the de Groote item exposes `_tif.zip`. Fallback generalized to both.
2. **D-2**: FR-012/Q5 say "add `role`/`sequence`"; they already exist — work is vocabulary + typing.
3. **D-6**: Assumptions say extraction machinery is "all present"; it is largely new (built on the exec runner).
