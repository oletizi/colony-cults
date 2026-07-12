---
id: TASK-15
title: pdf-b2-cache-incomplete
status: To Do
assignee: []
created_date: '2026-07-11 23:20'
updated_date: '2026-07-11 23:20'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The public B2 object store (bucket colony-cults) is missing masters for ~24 later PB-P001 issues (1883-10-01 through 1885-09-15): GET returns 403 and the objects are absent from the metadata archive clone. The earlier ~48 issues' masters are present and sha256-verify correctly. The full corpus build used IIIF (public Gallica) as the alternate for the 24, so their edition colophons record provider source-iiif rather than a sha256-verified B2 master. To make the whole PB-P001 run B2-verified, upload the missing masters to the bucket (the complete image blocks live in the colony-cults-archive-object-store clone), then rebuild those 24 with --provider b2.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- **Node:** impl:feature/corpus-print-pdf
<!-- SECTION:NOTES:END -->
