---
id: TASK-14
title: pdf-b2-primary-live-validation
status: Done
assignee: []
created_date: '2026-07-11 22:03'
updated_date: '2026-07-11 22:44'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
corpus-print-pdf: the B2 primary image provider (public-HTTP master fetch, sha256-verified) is implemented and unit-tested with fakes but has NOT been live-validated end-to-end, because the public B2 CDN base URL (CORPUS_CDN_BASE) was not available in the build session. Real renders were validated via the IIIF alternate (public Gallica). To exercise the primary path + real sha256 integrity check, set CORPUS_CDN_BASE to the public bucket base and run pdf:build --provider b2 against a real issue, confirming byte-integrity against the snapshot master hashes.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- **Node:** impl:feature/corpus-print-pdf

Closed: B2 primary provider live-validated end-to-end; surfaced+fixed the image-vs-text sha256 conflation (now RawPage.imageSha256). Real --provider b2 build verifies 12/12 masters.
<!-- SECTION:NOTES:END -->
