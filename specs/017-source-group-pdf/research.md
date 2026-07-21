# Phase 0 Research: Source-Group Facsimile PDF

All unknowns from Technical Context are resolved below (the design record
2026-07-21-source-group-pdf-design.md already settled the approach; this
consolidates the technical decisions).

## Decision: member-layout registration in the build

- **Decision**: call `ensureMemberLayoutRegistered(sourceId, sourcesDir)`
  (`@/archive/member-layout`) inside `buildSource` before `resolveArchiveSource`,
  and inside `discoverBuildableSourceIds` for every bibliography source before the
  `hasArchiveDir` filter.
- **Rationale**: the bridge already exists and is used by ocr/translate/
  restore-images for exactly this purpose (derive+register a member's layout so
  `sourceLayout` resolves). It derives the same slug `bib acquire` fetched into
  (proven in the trial build: `conviction-of-marquis-de-rays` resolved correctly),
  so no static-registry hand-additions and no slug-divergence risk.
- **Alternatives considered**: (a) hand-add PB-P061..P092 to the static
  `SOURCE_LAYOUTS` registry — rejected: ~32 brittle entries that can silently
  diverge from the acquired slug; (b) a new build-specific derivation — rejected:
  duplicates the bridge.

## Decision: sourcing the English reading text (materialize issue.txt)

- **Decision**: a reusable materializer resolves a member's `ocr-text` asset (role
  `ocr-text`, `sourceRepresentation: papers-past-text-tab`) from its
  `repositoryRecords[].assets`, fetches the text from B2, and writes `issue.txt` +
  `issue.txt.yml` (provenance: object-store key, sha256, sourceRepresentation) into
  the member's archive dir. The reader path is unchanged.
- **Rationale**: makes the member's archive dir byte-shaped like the working
  PB-P057 monograph, so the shipped reader consumes it with zero reader changes;
  keeps provenance mandatory (Principle III/XV); operator-chosen over reading the
  asset directly.
- **Alternatives considered**: (a) teach the reader to read the ocr-text asset when
  no issue.txt exists — rejected by operator (adds a reader code path + a build-time
  B2 read into the reader; less consistent with existing archive shape); (b)
  restructure the archive at acquire time — rejected as a change to the shipped
  acquisition feature (design record rejected alternative).

## Decision: segment composition (stacked verso via Typst)

- **Decision**: fetch the member's N page-image segments (ascending `sequence`) and
  place them vertically stacked in the verso cell using Typst's own layout
  (`stack`/`grid` of `image(...)`), reconstructing the clipping; face the english-
  only OCR recto.
- **Rationale**: no external image-processing dependency; Typst already embeds the
  images the facing-page template places. A single reconstructed verso per article
  reads like the original column.
- **Alternatives considered**: (a) one segment per folio (3 spreads, 2 blank rectos)
  — rejected by operator (reads poorly); (b) side-by-side segments — rejected
  (column strips read awkwardly); (c) external stitch to one image — rejected
  (adds an image lib for what Typst layout does natively).

## Decision: group-edition assembly + ordering

- **Decision**: a `group-edition` module accepts a source-group selector,
  enumerates members (via `partOf`), orders them by article date ascending (ties by
  member id), renders each as a section reusing the member render, and emits one PDF
  with an edition-level colophon + pinned-archive reference.
- **Rationale**: the per-member render is the reusable unit; the assembler adds only
  enumeration + ordering + section framing. Chronological order tells the affair's
  press story in sequence.
- **Alternatives considered**: order by member id (rejected: arbitrary vs. the
  historical narrative); by masthead (rejected: fragments the timeline).

## Decision: GIF embedding fidelity

- **Decision**: embed the `image/gif` segments directly in Typst at print
  resolution; verify fidelity during the member end-to-end integration test. Convert
  on fetch only if fidelity is inadequate (implementation detail, not scope).
- **Rationale**: Typst 0.15 supports GIF; avoids a conversion step unless proven
  necessary.
- **Alternatives considered**: pre-convert GIF→PNG on fetch (deferred unless the
  fidelity check fails).

## Resolved open questions (informed defaults, see spec Assumptions)

- Group selector = detect `kind: source-group` on the build selector (no `--group`
  flag).
- issue.txt materializer = a reusable module callable from the build (and available
  to a future re-acquire).
- Public/site export = out of scope (internal-first, G-3).
- Colophon (group) = one edition-level colophon + per-section source attribution.

## T001 findings (real member shape)

**Task**: Confirm the real member shape against the pinned archive clone + bibliography: a member's `ocr-text` asset (role/objectStoreKey/sha256/sourceRepresentation), its page-image segment `sequence` ordering, and the object-store reader used to fetch asset text. Verify the derived archive slug matches the on-disk dir for PB-P061.

### Bibliography source-of-truth locations
- PB-P060 (source-group): `/Users/orion/work/colony-cults-work/corpus-print-pdf/bibliography/sources/PB-P060.yml`
- PB-P061 (member): `/Users/orion/work/colony-cults-work/corpus-print-pdf/bibliography/sources/PB-P061.yml`
- Siblings (PB-P062, PB-P063, etc): `/Users/orion/work/colony-cults-work/corpus-print-pdf/bibliography/sources/PB-P062.yml`, etc.

### PB-P060 structure (source-group)
- `kind: source-group` ✓
- `case: port-breton`
- NO `repositoryRecords` field ✓
- Members reference via `partOf: PB-P060` (confirmed in PB-P061, PB-P062, PB-P063)

### PB-P061 member shape

**OCR-text asset** (from `repositoryRecords[0].assets`):
```yaml
role: ocr-text
sequence: 0
objectStoreKey: archive/papers-past/hns18840103.2.19.3/6d9400da4acfd67ade5b3ce9c6a1f5bdfe1ab7f4073110c83e4610304ca9bfa4.txt
checksum: 6d9400da4acfd67ade5b3ce9c6a1f5bdfe1ab7f4073110c83e4610304ca9bfa4
sourceRepresentation: papers-past-text-tab
mediaType: text/plain; charset=utf-8
byteLength: 422
```

**Page-image segments** (ascending sequence order):
1. Sequence 1: role=`page-master`, mediaType=`image/gif`, objectStoreKey=`archive/papers-past/hns18840103.2.19.3/6418101df384ebf00caab4d7fd50b780d53bcf67aefc75e3742907c2480c78b7.gif`, checksum=`6418101df384ebf00caab4d7fd50b780d53bcf67aefc75e3742907c2480c78b7`, byteLength=3005
2. Sequence 2: role=`page-master`, mediaType=`image/gif`, objectStoreKey=`archive/papers-past/hns18840103.2.19.3/bf16a475f0e59dbcd0eea2111ded0718d56cb8206b233758b6d8a8debe35d62d.gif`, checksum=`bf16a475f0e59dbcd0eea2111ded0718d56cb8206b233758b6d8a8debe35d62d`, byteLength=1365
3. Sequence 3: role=`page-master`, mediaType=`image/gif`, objectStoreKey=`archive/papers-past/hns18840103.2.19.3/28a283ecb00175bdbe0895b19626d91043603dc7bf86cab1a5eb6afe1de1a007.gif`, checksum=`28a283ecb00175bdbe0895b19626d91043603dc7bf86cab1a5eb6afe1de1a007`, byteLength=20657

### Object-store reader interface
- **Interface name**: `ObjectStore`
- **Module path**: `src/archive/object-store.ts`
- **Read method signature**: `get(key: string): Promise<Uint8Array>`
- **Usage context**: Injected S3-compatible abstraction for archive-writer; implementations (B2, S3, test doubles) swapped via dependency injection. Throws descriptive errors on transport/auth failures; no fallbacks or mock data.

### Archive slug verification for PB-P061
- **Derived slug logic** (`deriveSourceLayout` in `src/archive/location.ts`):
  - Case: member has no `case` field → falls back to owning group's case → `port-breton`
  - Type: member `kind: periodical` → type=`newspapers`
  - Slug: canonical title "CONVICTION OF MARQUIS DE RAYS" → slugified → `conviction-of-marquis-de-rays`
    - Slugify process: normalize NFD, strip diacritics, lowercase, collapse non-alphanumeric runs to `-`, trim leading/trailing hyphens, cap at 80 chars at word boundary.
  - Kind: periodical → `periodical` (though stored flat, without date+ark subdirs, like a monograph)

- **Derived slug result**: `conviction-of-marquis-de-rays`
- **On-disk directory** (from `COLONY_ARCHIVE_ROOT=/Users/orion/work/colony-cults-work/edition-publishing-archive`):
  - Full path: `/Users/orion/work/colony-cults-work/edition-publishing-archive/archive/cases/port-breton/newspapers/conviction-of-marquis-de-rays/`
  - Confirmed EXISTS with folio files: `f001.yml`, `f002.yml`, `f003.yml`
  - Folio `f001.yml` header confirms `id: "PB-P061"` and archive path

- **Slug match verification**: ✓ VERIFIED — derived slug `conviction-of-marquis-de-rays` matches on-disk directory exactly

### Sibling member slug verification
Verified the derivation applies consistently across source-group members:
- PB-P062 ("ARREST OF THE MARQUIS DE RAYS (New Zealand Herald, 21 October 1882)") → `arrest-of-the-marquis-de-rays-new-zealand-herald-21-october-1882` → on-disk dir EXISTS ✓
- PB-P063 ("THE MARQUIS DE RAYS IN GAOL") → `the-marquis-de-rays-in-gaol` → on-disk dir EXISTS ✓
