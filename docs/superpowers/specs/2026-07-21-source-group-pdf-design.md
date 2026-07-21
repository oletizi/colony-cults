# Design — source-group PDF (Papers Past NZ press facsimile editions)

Roadmap item: `impl:feature/source-group-pdf`
Date: 2026-07-21
Status: design (awaiting operator `design-approved:` marker)

## Problem Domain

The archive-direct PDF build (spec 014) plus the English-source reading-recto
path (spec 015) can render a French periodical (PB-P001), an English monograph
(PB-P056), and English press leaves (PB-P057–P059). It **cannot** render the
newly-acquired Papers Past NZ press coverage of the Marquis de Rays / Port
Breton affair: source-group `PB-P060` and its ~32 member articles
(`PB-P061`–`PB-P092`), acquired via the shipped papers-past-acquisition feature.

Two independent gaps block the build (both traced end-to-end via a trial build):

- **Gap A — member layouts are never registered in the build.** `buildSource`
  and `buildAll` resolve a source's archive layout via `sourceLayout(sourceId)`,
  which reads the static `SOURCE_LAYOUTS` registry + a runtime overlay. Members
  created by `bib inventory` are never in the static registry; the overlay is
  populated only by the acquire/ocr/translate commands via
  `ensureMemberLayoutRegistered` (`src/archive/member-layout.ts`), which the PDF
  build never calls. Result: `buildSource('PB-P061')` throws
  `no archive layout registered`, and `buildAll` silently skips members
  (`hasArchiveDir` → `isSourceLayoutRegistered` is false).

- **Gap B — the Papers Past archive shape is incompatible with the reader.** A
  member's archive dir is `archive/cases/port-breton/newspapers/<slug>/` holding
  only flat page-image folios (`f001.yml`, `f002.yml`, `f003.yml`, each
  `type: page-image`, `ocr_status: none`) — **no `issue.txt`** and **no
  `<date>_<ark>` issue subdirectory**. The article's English OCR lives in a
  **separate `ocr-text` asset** (role `ocr-text`, `sourceRepresentation:
  papers-past-text-tab`) stored in B2, not in the folio sidecars. But the
  archive-direct reader sources the English reading recto from `issue.txt` (as
  in the working PB-P057 monograph) or from `<date>_<ark>` periodical issue
  dirs. Neither exists for these members, so there is no reading text for the
  recto and no issue structure to enumerate.

Contrast that makes the gap concrete:

| | PB-P057 (builds) | PB-P061 (blocked) |
|---|---|---|
| kind / archive type | `monograph` / `books/` | `periodical` / `newspapers/` |
| reading OCR | `issue.txt` in the dir | none — a detached `ocr-text` asset in B2 |
| folio images | 1 page-image | 3 page-image segments (column strips of one clipping) |
| layout registered? | static registry | neither (member) |

Additional domain facts (captured, not yet scoped out):

- Each member has **N page-image segments** (the Papers Past image server splits
  the clipping into `area=1,2,3…` region strips) plus **one** `ocr-text` asset.
- All PB-P060 members are **English** (NZ newspapers) → the shipped english-only
  recto variant (`--no-french`, spec 015) applies with no template change.
- Members carry `partOf: PB-P060` and `case: port-breton`; the group `PB-P060`
  is `kind: source-group` (no archival object of its own — never fetchable).
- Cross-masthead **syndication** exists in the 695-hit vein (the same cable
  reprinted across papers). A deduplicated discrete-item census is an explicit
  larger follow-on (PB-P060 notes / SRCH-0018) — **out of scope** here; this
  feature renders the acquired members as-is.
- The local archive holds only provenance sidecars; **image + ocr-text bytes are
  fetched from B2** at build time (existing archive-direct behavior).

Success criteria: from a resolvable archive + B2, the build produces (1) one
facsimile PDF per member article and (2) one combined `PB-P060` group-edition
PDF, each with the article scan (stacked segments) on the verso, the English
OCR reading text on the recto, an honest OCR-transcription colophon, and a
pinned-archive reference — failing loud (never fabricating) on any missing
required input.

## Solution Space

### Chosen — Extend the archive-direct build minimally

Preserve spec 014's single uniform archive-direct path. Four components:

1. **Member-layout wiring (fixes Gap A).** `buildSource` calls
   `ensureMemberLayoutRegistered(sourceId, sourcesDir)` before
   `resolveArchiveSource`; `discoverBuildableSourceIds` registers member layouts
   for every bibliography source before the `hasArchiveDir` discoverability
   filter, so members resolve and are `--all`-discoverable. This is exactly what
   the ocr/translate/restore-images commands already do — no new mechanism.

2. **`issue.txt` materialization (fixes Gap B, reading text).** A prep step
   resolves each member's `ocr-text` asset from its
   `repositoryRecords[].assets[role: ocr-text]`, fetches the text from B2, and
   writes `issue.txt` + `issue.txt.yml` (provenance: source asset key + sha256 +
   `sourceRepresentation`) into the member's archive dir. The archive becomes
   self-contained and byte-shaped identically to PB-P057; the reader path is
   unchanged. (This is approach C's one good idea, applied build-side instead of
   at acquire time.)

3. **Member facsimile rendering (fixes Gap B, structure + images).** Each member
   builds as a single item whose verso stacks its N page-image segments
   vertically (Typst `stack`/`grid` of the fetched segment images — no external
   image-processing dependency), and whose recto is the english-only OCR reading
   text (reuse the shipped `--no-french` variant + FR-013 OCR-transcription
   colophon). The flat-folio member is treated as a monograph-shaped one-item
   build (one composed spread), so no `<date>_<ark>` issue enumeration is needed.

4. **Group-edition assembler.** A new build path accepts a `source-group`
   selector (`PB-P060`), enumerates its members in **chronological order by
   article date**, renders each as a section (heading + composed verso/recto
   spread), and emits one PDF with a single edition-level colophon + pinned
   archive reference. The per-member build (components 1–3) is the reusable unit
   the assembler iterates.

Trade-off: touches the build + adds a materialization step and a group-assembler
path, but reuses the reader, edition model, Typst template, and english-only
variant intact.

### Rejected — Separate Papers-Past build pipeline

A dedicated reader + renderer just for Papers Past members. Rejected: it
duplicates the archive-direct reader and Typst template and re-introduces the
per-source-archive special-casing that spec 014 was written to dissolve. Every
future archive shape would spawn another pipeline.

### Rejected — Restructure the archive at acquisition time

Reclassify members `periodical → monograph`, relocate folios to `books/<slug>/`,
and emit `issue.txt` during `bib acquire` so the existing build "just works"
with only Gap A fixed. Rejected as the primary path: it is a data-model +
provenance change to the **shipped** papers-past-acquisition feature (member
`kind` is authoritative metadata with downstream consumers), and rewrites
acquisition output for a rendering concern. Heavier and riskier than a
build-side fix. Its one good idea — materializing `issue.txt` from the ocr-text
asset — is adopted in the chosen approach (component 2), build-side.

## Decisions

- **Output = both** per-member PDFs **and** a combined `PB-P060` group edition
  (operator decision). The per-member build is the unit the group assembler
  iterates.
- **Reading text = materialize `issue.txt`** into the archive from the ocr-text
  asset, committed (operator decision) — consistent with PB-P057; reader path
  unchanged.
- **Images = stack segments vertically** into one reconstructed verso facing the
  full OCR recto (operator decision); stacking done in Typst, no image-processing
  dependency.
- **Member-layout registration** reuses `ensureMemberLayoutRegistered`; no new
  layout mechanism, no static-registry hand-additions for members (derived slug
  must match the acquired archive slug — proven in the trial build:
  `conviction-of-marquis-de-rays` resolved correctly).
- **Group-edition ordering = chronological by article date** (default); ties
  broken by member id.
- **English-only recto** via the shipped `--no-french` variant; no Typst
  template change expected beyond segment-stacking layout.
- **Fail loud, no fabrication**: a missing ocr-text asset, missing segment
  image, or unresolvable B2 object aborts that item with an attributable error
  (G-4 record-and-continue for batches); nothing is invented.
- **Syndication dedup is out of scope** — render acquired members as-is.

## Open Questions

- **Group-edition selector surface.** Does `pdf:build PB-P060` (a source-group
  id) trigger the group assembler, or is there an explicit `--group` flag? Lean:
  detect `kind: source-group` and assemble; fail loud if a group has no members.
- **Segment ordering + provenance within a member.** Order by asset `sequence`
  (1,2,3). Confirm the `sequence: 0` ocr-text asset is excluded from the image
  stack.
- **Colophon scope for the group edition.** One edition-level colophon vs. a
  per-article mini-colophon. Lean: one edition-level colophon + per-section
  source attribution line.
- **`issue.txt` materialization home.** A `pdf:`-side prep step vs. a reusable
  `bib`-side verb (so a future re-acquire also emits it). Lean: a reusable
  materializer callable from both; decided at plan time.
- **Segment image format.** Segments are `image/gif`; confirm Typst 0.15 embeds
  GIF acceptably at print resolution, else convert on fetch.
- **Per-member PDF necessity vs. cost.** ~32 tiny PDFs; confirm they are wanted
  as durable artifacts or only as the group-edition building block.
- **Does the group edition belong in the public site export**, or is it an
  internal/print artifact only (G-3 internal-first)?

## Provenance

- Roadmap item `impl:feature/source-group-pdf` (added 2026-07-21), depends-on the
  shipped `papers-past-acquisition` + `english-source-pdf`.
- Design driven via `/stack-control:design` → `superpowers:brainstorming`
  in-session; house-rules block `stack-control-design-v1` injected
  (capture-over-YAGNI, ≥2 solution alternatives, required sections, operator
  approval, handoff to `/stack-control:define`).
- Gap traced empirically: trial `buildSource('PB-P061')` (layout-not-registered),
  then a manual `ensureMemberLayoutRegistered` trial (surfaced the
  no-`issue.txt` / flat-folio structural gap). Archive evidence:
  `archive/cases/port-breton/newspapers/conviction-of-marquis-de-rays/{f001,f002,f003}.yml`
  (`ocr_status: none`) vs. PB-P057's `.../books/<slug>/issue.txt`.
- Source records: `bibliography/sources/PB-P060.yml` (group),
  `bibliography/sources/PB-P061.yml` (first validated member, `ocr-text` asset
  `papers-past-text-tab`).
- Operator decisions recorded 2026-07-21: output=both; reading text=materialize
  issue.txt; images=stack segments vertically.
- Prior art reused: spec 014 (archive-direct reader/edition/Typst),
  spec 015 (english-only recto, FR-013 OCR-transcription colophon,
  `blank_recto`), `src/archive/member-layout.ts`, `src/pdf/render/batch.ts`.
