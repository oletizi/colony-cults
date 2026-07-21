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
