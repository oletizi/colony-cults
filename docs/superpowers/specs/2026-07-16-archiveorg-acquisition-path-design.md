# Design — Internet Archive (archive.org) acquisition adapter

**Roadmap item:** `impl:feature/archiveorg-acquisition-path`
**Date:** 2026-07-16 (revised after third-party design review)
**Backlog:** TASK-32
**Handoff target:** `/stack-control:define`

## Problem domain

The corpus-gap-closure program (spec 009) can only *acquire* sources from
repositories with a shipped adapter: today that is **Gallica** (the shipped
fetcher / `ark` copies) and the **New Italy Museum** (spec 011, `accession`
copies). Anything held elsewhere is measurable-but-unreachable.

SRCH-0013 (2026-07-16) proved this is a live gap: the **de Groote 1880
promotional book** — *"Nouvelle-France : Colonie libre de Port-Breton,
Océanie"*, ~368 pp, a central Port-Breton affair imprint and a long-standing
Phase-2 `ROADMAP.md` goal — is **verified real, digitised, and public-domain on
the Internet Archive** (item `nouvellefrancec00groogoog`, a Google Books scan),
but **absent from Gallica**. The shipped pipeline cannot mirror an Internet
Archive item into the corpus + B2. The operator expects the Internet Archive to
hold substantially more affair material, so the repository warrants a **reusable
first-class adapter**, not a one-off manual mirror.

Constraints inherited from the program:
- Must fit the **shipped** `RepositoryAdapter` interface
  (`src/repository/adapter.ts`; canonical typed refinement in
  `specs/011-museum-acquisition-path/contracts/repository-adapter.md`):
  `repository` / `resolve` / `collectRightsEvidence` / `acquire`. **There is no
  `search` adapter method** — discovery is a separate seam
  (`DiscoveryMechanism`, or a manual operator search). Reuse the shipped
  `bib inventory | verify-member | promote | acquire | reconcile` verbs.
- **Fail loud, no fabrication** (FR-008); **rights fail-closed at acquire**
  (FR-007 / 011 INV-B); never `bib migrate` (FR-012); per-session archive clone;
  B2 the only shared asset store.
- The corpus stores **per-page image masters** with per-page provenance
  (Gallica model, e.g. PB-P001); the archive shape must stay uniform so the
  corpus-browser reading view and coverage audit work unchanged.

## Solution space

The load-bearing fork is **how an Internet Archive item becomes corpus content**
— its end-state shape and the acquisition mechanism that produces it.

### Chosen — PDF-probe, evidence-selected master, per-page-image archive shape

Reach the document the **frugal** way (one cheap PDF download) and quality-gate
it *before* anything shared is written; select the master source from measured
evidence (not an assumption); produce the uniform **per-page image** archive
shape; and **preserve the repository-supplied PDF** as a source-package asset.

`acquire(record, ctx)` steps (the record already carries a
`rightsAssessment.rightsStatus === 'public-domain'`, or `acquire` fails closed):
1. **Fetch** the resolved item's chosen PDF → local **staging** (one download;
   nothing shared yet). Record its fixity (byte length, sha256) + IA file
   metadata.
2. **Examine (fail-closed gate)** — operator judgment, persisted as canonical
   provenance (`qualityAssessment`: status, assessedBy/At, source-file checksum,
   expected vs observed page count, approved leaf range, notes). `scandata.xml`
   `pageType` **seeds** a proposed legitimate range (Cover/Title/Color-Card/…),
   which the operator confirms — a non-`Normal` leaf can still be part of the
   historical object, so the seed never decides on its own. Only `sound`
   proceeds.
3. **Select the master source from evidence** (frugal-by-default): compare the
   PDF's extracted-image fidelity (`pdfimages -list`: pixel dimensions, DPI,
   compression) against `scandata.xml`'s recorded page dimensions (cheap, no
   image download). If the PDF is demonstrably equivalent → explode the PDF. If
   the PDF is materially degraded (downsampled/recompressed) → fetch the item's
   `_jp2.zip` and use those. The JP2 set is pulled **only when the evidence
   warrants it**.
4. **Produce per-page masters under a strict page-to-leaf invariant.** For each
   approved logical page: inspect it; if it contains exactly one suitable page
   image, extract losslessly (`pdfimages`); otherwise rasterise that page at a
   recorded DPI (`pdftoppm`). Verify the output count against the approved leaf
   range. Record **per-page method provenance** (`method`, `sourcePdfObject` or
   `resolutionDpi`, `leaf`, `logicalPage`).
5. **Excluded leaves** (third-party scanner notice, IA cover, color card) are
   *omitted from the page-master reading assets*, *retained in the repository
   source package*, and recorded in provenance (`excludedLeaves`:
   classification + reason). Never "discarded" — the source evidence is kept.
6. **Upload assets to B2** as typed `AcquiredAsset`s: the **page-master** images
   (mediaType `image/jpeg`, per-page provenance — identical to Gallica) **plus
   the repository-source PDF** (mediaType `application/pdf`). Downstream tools
   consume only the page-master assets.
7. `AcquisitionResult` (with `metadataSnapshot`) → `bib reconcile` advances the
   RepositoryRecord to `archived`.

### Rejected — single-PDF master (no per-page explosion)

Store the item PDF as the only master. Breaks the uniform per-page archive
shape: the corpus-browser reading view, deep-zoom, per-page OCR/translation, and
the coverage audit all assume per-page image masters. Rejected as the reading
master — but the PDF is still preserved as the repository-source asset (step 6).

### Rejected — always pull per-page JP2/TIFF from archive.org

Always fetch archive.org's `_jp2.zip` regardless of the PDF. Yields the per-page
shape but is heavier and un-frugal (download the whole image set before judging).
Rejected as the *default*; retained as the **evidence-triggered** path (step 3)
for items whose PDF is measurably degraded. (The earlier design's assumption that
"JP2s are no higher fidelity than the PDF" was unsupported — IA's documented scan
model stores cropped/deskewed JP2s while the PDF is a *derived* access format;
fidelity is now *measured*, not assumed.)

### Captured (scope decided at define) — automated discovery mechanism

Discovery is **not** an adapter method. archive.org search could later be a
`DiscoveryMechanism` over `advancedsearch` (`mediatype:texts` + query), stating
which surface it uses (metadata vs full-text vs BookReader). Recommendation:
**manual-backed v1** (we hold the de Groote item id; SRCH-0013 proved a hand-run
search works; research-first pulls the mechanism only when hand-searching proves
repetitive). Build-now-or-later is a define-time scoping pass.

## Decisions

- **Fit the shipped seam exactly.** New `src/repository/internet-archive/adapter.ts`
  implementing the real `RepositoryAdapter` (`repository`, `resolve`,
  `collectRightsEvidence`, `acquire`), registered in the
  `RepositoryAdapterRegistry`; new RepositoryRecord copy type **`ia-item`**
  (identifier = archive.org item id, e.g. `nouvellefrancec00groogoog`);
  `bib acquire` dispatches by copy type, as for museum `accession` / Gallica
  `ark`. Model on the shipped museum adapter (spec 011).
- **`resolve` selects files deterministically.** The IA item id is the stable
  copy identity, verified via the item metadata API (exists, `mediatype:texts`).
  When the item exposes multiple PDFs / scan packages, `resolve` picks
  deterministically — prefer the canonical/primary text PDF; reject
  encrypted/restricted files; reject an OCR-only PDF when a page-image PDF
  exists; **fail loud on ambiguous equally-eligible candidates** (FR-008); record
  the selected filename + a metadata snapshot. Same rule for `scandata.xml` and
  the `_jp2.zip`.
- **Rights = evidence proposed, judgment authored (matches shipped model).**
  `collectRightsEvidence` surfaces the IA `possible-copyright-status` as
  `RightsEvidence.rightsRaw`/`publicationStatus` plus grounded `date`/`creator`
  — **evidence only, never a verdict** (IA states this field is uploader-supplied
  and unwarranted). The operator authors the canonical `rightsAssessment`
  (`rightsStatus`, basis, jurisdiction, assessedBy/At) on the `RepositoryRecord`;
  `acquire` fail-closes on `rightsAssessment.rightsStatus === 'public-domain'`
  (011 INV-B). For the de Groote book: PD by 1880 publication age; IA's
  `NOT_IN_COPYRIGHT` corroborates.
- **Repository/scanner notices are preserved + assessed, not declared void.**
  Google's "for non-commercial use" notice (and any repository statement) is kept
  **verbatim as rights evidence** (`rightsRaw`). It does not override an
  independently-supported public-domain determination for the underlying work —
  a faithful reproduction of a PD work is not re-copyrightable under applicable
  U.S. originality doctrine (the *Bridgeman* principle, a U.S. district-court
  holding, not a universal rule) — but any *non-copyright* restriction is
  evaluated and recorded rather than silently dismissed. The operator still
  reaches public-domain for this 1880 book; the adapter never *declares* a notice
  legally meaningless.
- **PDF-probe, evidence-selected master, per-page archive shape** with a
  fail-closed quality gate before B2, a strict page-to-leaf extraction invariant,
  and per-page method provenance (chosen solution above). Reuse the project's PDF
  machinery (`src/pdf/`) + poppler (`pdfimages`/`pdftoppm`/`pdfinfo`), all present.
- **Preserve the repository-supplied PDF** as a `repository-source`
  `AcquiredAsset` alongside the `page-master` assets — the exact object examined,
  on which the range was selected and images extracted; makes extraction
  reproducible. Downstream consumes only page-masters.
- **Excluded third-party leaves** are omitted-from-reading / retained-in-source /
  recorded — never "discarded". `scandata.xml` seeds the range; operator confirms.
- **Durable operator judgment.** The `qualityAssessment` + approved leaf range +
  `excludedLeaves` are canonical provenance on the record, not session state;
  `acquire` re-verifies the staged PDF checksum matches the assessed file before
  acting.
- **`metadataSnapshots`** (retrievedAt, endpoint, checksum) recorded on the
  RepositoryRecord via the shipped snapshot store; `originalUrl` =
  `https://archive.org/details/<id>`.
- **Discovery separate; search manual-backed v1**, automated mechanism captured.

## Open questions

_(for define-time scoping)_

- **Fidelity-comparison thresholds.** The exact rule that decides "PDF
  demonstrably degraded → fetch JP2" (dimension/DPI/compression deltas). Needs a
  concrete, testable threshold — defined at spec time against real items.
- **`pdfimages` vs `pdftoppm` per-page detection.** The precise test for "exactly
  one suitable page image" and the rasterisation DPI when falling back.
- **Staging location + lifecycle.** Where the throwaway PDF + exploded images
  stage (per-session scratch under the archive clone), and cleanup after a
  successful upload or a rejected gate.
- **Discovery-mechanism scope** — build the `advancedsearch` `DiscoveryMechanism`
  in this spec or a later one, and which search surface it targets.
- **`AcquiredAsset` role field.** Whether distinguishing `repository-source` vs
  `page-master` needs a new `role`/`sequence` field on `AcquiredAsset` or is
  carried by `mediaType` — a small model decision for define.

## Provenance

- **Motivating evidence:** SRCH-0013 in `bibliography/search-log.yml`; raw
  archive.org captures under `bibliography/repository-responses/PB-P002/`
  (`archiveorg-metadata-nouvellefrancec00groogoog-2026-07-16.json` et al.).
- **Shipped interface (authoritative):** `src/repository/adapter.ts`
  (`RepositoryAdapter`, `RightsEvidence`, `ResolvedRepositoryItem`,
  `AcquisitionResult`); `src/model/repository-record.ts` (`rightsAssessment`);
  `src/model/acquired-asset.ts`. Canonical contract:
  `specs/011-museum-acquisition-path/contracts/repository-adapter.md`. The stale
  `specs/009-.../contracts/repository-adapter.md` was reconciled to match as part
  of this work.
- **Prior art:** shipped museum adapter — `src/repository/new-italy-museum/`,
  `src/cli/bib-acquire-museum.ts`, spec 011; page-range acquisition — spec 012
  (the "keep only pages X–Y" selection model); snapshot store —
  `src/sourcegroup/snapshot.ts`.
- **Backlog:** TASK-32; kin to TASK-15 (Trove), TASK-31 (gallica-sru-resolver).
- **Design conversation:** in-session brainstorming, 2026-07-16, then a
  third-party design review whose seven points are integrated above (rights as
  evidence not verdict; preserve+assess repository notices; measured PDF-vs-JP2
  master selection; preserve the source PDF; page-to-leaf invariant + per-page
  method provenance; durable quality/range assessment; deterministic file
  selection). Operator confirmed the two reconciliations touching earlier rulings
  (frugal-but-evidence-based master selection; preserve-and-assess the Google
  notice, still PD for this book).
