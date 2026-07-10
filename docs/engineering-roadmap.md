---
doc-grammar: roadmap
---

# Roadmap

The governed dependency graph of this project's features. Each item is a
heading-keyed unit identified by its `<phase>:<kind>/<slug>` id.

Mutate the graph with `stackctl roadmap` verbs (run `stackctl roadmap --help`
for the full surface): `add` a new item, `advance` its status, `decompose`,
`reclassify`, `defer`, and `cluster` / `group` to gather existing items under a
created-or-reused parent. Example — cluster items under a new epic with a
dependency chain:

    stackctl roadmap cluster multi:feature/epic --children design:feature/a,impl:feature/b --chain --apply

For an edit that has no verb yet (e.g. moving a `part-of` / `depends-on` edge):
edit this file directly, then run `stackctl roadmap order` to revalidate the
graph (it fails loud on a cycle / dangling ref / duplicate id).

## impl:feature/gallica-fetcher
- status: shipped
- analyze-clean: yes
- spec: specs/001-gallica-fetcher
- design-approved: yes
- design: docs/superpowers/specs/2026-07-08-gallica-fetcher-design.md
Reusable TypeScript/tsx tool to fetch Gallica public-domain sources via documented web-service and IIIF APIs (Issues census, Pagination, IIIF images, OCR text) with provenance and checksums into the private archive; first target La Nouvelle France PB-P001

## impl:feature/archive-object-store
- status: closed
- validated: yes
- analyze-clean: yes
- spec: specs/003-archive-object-store
- design-approved: yes
- design: docs/superpowers/specs/2026-07-08-archive-object-store-design.md
Move the archive's binary image masters from git to Backblaze B2 (S3-compatible; bucket colony-cults, endpoint https://s3.us-west-004.backblazeb2.com, region us-west-004). Fetcher archive-writer uploads image bytes to B2 and records the object key + sha256 in the git-tracked provenance; git keeps only census + provenance + OCR text + manifest. Includes a one-time migration (masters already uploaded + verified in B2; remaining: strip images from git history + force-push, coordinated with the translation session). Subsumes TASK-6.

## impl:feature/canonical-source-metadata
- status: closed
- validated: yes
- analyze-clean: yes
- spec: specs/004-canonical-source-metadata
- design-approved: yes
- depends-on: impl:feature/archive-object-store
- design: docs/superpowers/specs/2026-07-08-canonical-source-metadata-design.md
Two-level (really multi-level) canonical source metadata model: Source (intellectual work; stable internal ID PB-###; work-level identifiers ISBN/ISSN/OCLC; titles as data) separate from Repository Record (one source-archive's copy: Gallica/SLQ/IA/HathiTrust; copy-level identifiers ARK/IIIF-manifest/scan-DOI; provenance). Sits ABOVE the per-asset provenance the archive-object-store feature already emits; for serials adds Repository->Issue->Asset. Consolidates the 5 existing overlapping metadata representations into one SSOT. From a third-party design brief, with refinements. Depends-on archive-object-store (edge to add once that merges to main). Scope: sources only.

## impl:feature/source-groups
- status: shipped
- analyze-clean: yes
- spec: specs/005-source-groups
- design-approved: yes
- design: docs/superpowers/specs/2026-07-09-source-groups-design.md
- depends-on: impl:feature/canonical-source-metadata
Source Group kind for research-defined collections that are discovered before acquired (resolves PB-P004 mis-model + backlog TASK-3). Extend Source.kind to periodical|monograph|source-group; a source-group has members (part_of edges), NOT repositoryRecords, and is never fetchable; fetcher/acquisition fails loud+informatively on a source-group keyed on kind. Add discovered/approved-for-acquisition to the status vocab. Reclassify PB-P004 (French legal corpus) as the first source-group with member children. Discover->Inventory->Verify->Promote->Acquire pipeline. Does NOT add repository-record to the kind enum (already a separate entity). From a third-party design guidance doc, with refinements.