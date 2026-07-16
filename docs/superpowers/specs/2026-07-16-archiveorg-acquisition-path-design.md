# Design — Internet Archive (archive.org) acquisition adapter

**Roadmap item:** `impl:feature/archiveorg-acquisition-path`
**Date:** 2026-07-16
**Backlog:** TASK-32
**Handoff target:** `/stack-control:define`

## Problem domain

The corpus-gap-closure program (spec 009) can only *acquire* sources from
repositories with a shipped adapter: today that is **Gallica** (the shipped
fetcher / `ark` copies) and the **New Italy Museum** (spec 011, `accession`
copies). Anything held elsewhere is measurable-but-unreachable.

SRCH-0013 (2026-07-16) proved this is now a live gap, not a hypothetical one:
the **de Groote 1880 promotional book** — *"Nouvelle-France : Colonie libre de
Port-Breton, Océanie"*, ~368 pp, a central Port-Breton affair imprint and a
long-standing Phase-2 `ROADMAP.md` goal — is **verified real, digitised, and
public-domain on the Internet Archive** (item `nouvellefrancec00groogoog`, a
Google Books scan), but **absent from Gallica**. The shipped pipeline cannot
mirror an Internet Archive item into the corpus + B2. The operator expects the
Internet Archive to hold substantially more affair material (press, imprints,
maps, secondary works), so the repository warrants a **reusable first-class
adapter**, not a one-off manual mirror.

Constraints inherited from the program:
- Must fit the injected **`RepositoryAdapter`** contract
  (`specs/009-corpus-gap-closure/contracts/repository-adapter.md`:
  `search` / `resolveIdentifier` / `determineRights` / `acquire`) and reuse the
  shipped `bib inventory | verify-member | promote | acquire | reconcile` verbs.
- **Fail loud, no fabrication** (FR-008); **rights fail-closed** (FR-007);
  never `bib migrate` (FR-012); per-session archive clone; B2 the only shared
  asset store.
- The corpus stores **per-page image masters** with per-page provenance
  (Gallica model, e.g. PB-P001); the archive shape must stay uniform across
  repositories so the corpus-browser reading view and coverage audit work
  unchanged.

## Solution space

The load-bearing fork is **how an Internet Archive item becomes corpus content**
— its end-state shape and the acquisition mechanism that produces it.

### Chosen — PDF-first acquisition, per-page-image archive shape

Reach the document the **frugal** way (one cheap PDF download) and quality-gate
it *before* anything touches B2; on approval, **explode** the approved page
range into per-page images and archive **those**, so the stored master matches
the Gallica per-page shape. Full reading-view/coverage parity, reached via the
cheap PDF route rather than pulling per-page assets from archive.org.

`acquire(id)` steps:
1. **Fetch** the item PDF → local **staging** (one download; nothing shared yet).
2. **Examine (fail-closed gate)** — operator judgment: `pdfinfo` page count vs.
   the catalogue's expected extent, sampled-page resolution/legibility, and the
   **legitimate page range** (which leaves are the original work vs. inserted
   third-party matter). Only `sound` proceeds; a poor scan is refused and the
   source stays cataloged, not mirrored.
3. **Explode** the approved range → per-page images (`pdfimages -all`, lossless
   extraction of the embedded page scans; `pdftoppm` rasterisation as the
   fallback when a page is not a single embedded image). **Strip** third-party
   front/end matter (Google notice page, archive.org covers, scanning targets /
   color cards); **record the stripped leaves + reason in provenance** — a
   documented editorial decision, never silent data loss.
4. **Upload** the per-page images to B2 as page-image masters + per-page
   provenance (sha256 + object key), identical to the Gallica archive shape.
5. Return `AcquireResult` → `bib reconcile` advances the RepositoryRecord to
   `archived`.

### Rejected — single-PDF master (no explode)

Store the item PDF itself as the master. Simplest, but breaks the uniform
per-page archive shape: the corpus-browser reading view, deep-zoom, per-page
OCR/translation, and the coverage audit all assume per-page image masters. A
lone PDF asset would be a second, special-cased archive shape. Rejected.

### Rejected — pull per-page JP2/TIFF directly from archive.org

Fetch archive.org's own per-page image set (`_jp2.zip` / BookReader image API)
instead of the PDF. Yields the per-page shape without a local explode, but is
**heavier** (download the whole image set before judging quality), **less
frugal** (no cheap single-file probe), and the archive.org JP2s for Google
scans are typically the same underlying images at no higher fidelity than
`pdfimages` extracts from the PDF. Rejected as the v1 mechanism; retained as a
possible future path for items whose PDF is poor but whose JP2 set is better.

### Captured (scope decided at define) — automated `advancedsearch`

`search(campaign)` can be a thin wrapper over archive.org `advancedsearch`
(`mediatype:texts` + query) returning `DiscoveryCandidate[]`. Recommendation:
**manual-backed v1** (we already hold the de Groote item id; SRCH-0013 proved a
hand-run search works; research-first says pull the mechanism only when
hand-searching proves repetitive). Captured here so the need is named; the
build-now-or-later call is a define-time scoping pass.

## Decisions

- **Fit the shipped seam.** New `src/repository/internet-archive/adapter.ts`
  implementing `RepositoryAdapter`, registered in the `RepositoryAdapterRegistry`;
  new RepositoryRecord copy type **`ia-item`** (identifier = archive.org item id,
  e.g. `nouvellefrancec00groogoog`); `bib acquire` dispatches by copy type, as it
  already does for museum `accession` / Gallica `ark`. Model on the shipped
  museum adapter (spec 011).
- **`resolveIdentifier`** — the archive.org item id **is** the `StableId`,
  verified via the item metadata API (exists, `mediatype:texts`, exposes a PDF).
  Fail loud on an unverifiable candidate (INV-2); never invent an id.
- **`determineRights`** — read `possible-copyright-status`: `NOT_IN_COPYRIGHT` →
  `public-domain`; anything else (in-copyright / undetermined / absent) →
  `uncertain`, fail-closed (INV-3). **No special-casing of Google-digitised
  items:** a faithful reproduction of a public-domain work is not
  re-copyrightable (the *Bridgeman v. Corel* principle), so Google's
  "non-commercial use" front-matter notice carries no copyright force and is
  disregarded; archive.org's PD status governs.
- **PDF-first, per-page-out** acquire flow with a **fail-closed quality gate**
  before B2 (chosen solution above). Reuse the project's existing PDF machinery
  (`src/pdf/`) and poppler (`pdfimages`/`pdftoppm`/`pdfinfo`), which are present.
- **Discard third-party front/end matter**, recording the stripped leaves +
  reason in provenance. Conceptually the same "keep only pages X–Y" selection as
  the shipped **spec-012 page-range acquisition** — reuse that prior art for the
  range model.
- **Search manual-backed in v1**, automated `advancedsearch` captured for later.
- **Reuse, don't reinvent, the loop:** `inventory → verify-member → promote →
  acquire → reconcile` and `bib coverage` are unchanged; this adds one adapter
  + one copy type, honoring INV-1..6 plus a new fail-closed quality gate.

## Open questions

- **Third-party-insert detection.** Is identifying the legitimate page range a
  purely manual step in the examine gate, or can archive.org's `scandata.xml`
  (per-leaf `pageType`: Cover / Title / Color Card / Normal) seed a proposed
  range the operator confirms? Prefer to seed-then-confirm if `scandata.xml` is
  reliably present; decide at define.
- **`pdfimages` vs `pdftoppm` default.** Lossless embedded-image extraction is
  preferred, but some PDFs interleave multiple images or vector overlays per
  page. Define the detection + fallback rule and the target fidelity.
- **Staging location + lifecycle.** Where the throwaway PDF + exploded images
  stage (per-session scratch under the archive clone?), and when they are
  cleaned up after a successful B2 upload or a rejected quality gate.
- **Search-automation scope** (build the `advancedsearch` wrapper in this spec,
  or a later one) — a define-time scoping decision.

## Provenance

- **Motivating evidence:** SRCH-0013 in `bibliography/search-log.yml`; raw
  archive.org captures under `bibliography/repository-responses/PB-P002/`
  (`archiveorg-metadata-nouvellefrancec00groogoog-2026-07-16.json` et al.).
- **Contract:** `specs/009-corpus-gap-closure/contracts/repository-adapter.md`
  (RepositoryAdapter + INV-1..6).
- **Prior art:** shipped museum adapter — `src/repository/new-italy-museum/`,
  `src/cli/bib-acquire-museum.ts`, spec 011; page-range acquisition — spec 012.
- **Architecture seam:** `src/repository/adapter.ts` (RepositoryAdapter +
  registry); existing PDF machinery `src/pdf/`.
- **Backlog:** TASK-32 (archiveorg-acquisition-path); kin to TASK-15 (Trove),
  TASK-31 (gallica-sru-resolver).
- **Design conversation:** in-session brainstorming, 2026-07-16; operator
  decisions recorded above (PDF-first + stage/examine/commit + explode-to-per-page;
  disregard Google notice; discard third-party matter; search manual-backed v1).
