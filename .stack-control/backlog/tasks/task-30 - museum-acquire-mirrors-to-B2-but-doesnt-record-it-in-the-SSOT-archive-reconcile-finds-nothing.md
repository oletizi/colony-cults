---
id: TASK-30
title: >-
  museum acquire mirrors to B2 but doesn't record it in the SSOT/archive;
  reconcile finds nothing
status: Done
assignee: []
created_date: '2026-07-15 01:24'
updated_date: '2026-07-15 01:39'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Live PB-P013 acquire CONFIRMED the master (122987 bytes, Pioneers Group Photo 1890) is in B2 at archive/museum/new-italy-museum/nimi-0844/<sha256>.jpg with correct checksum metadata -- the data plane (fetch+checksum+PUT) works. But the control plane is incomplete: (1) runAcquire (src/sourcegroup/acquire.ts:208) only adapts the AcquisitionResult into the observable {sourceId,accession,sourceArchive} result -- it does NOT persist result.assets (objectStoreKey/checksum/byteLength) back to the SSOT RepositoryRecord, so the record has no assets; (2) NewItalyMuseumAdapter.acquire PUTs to B2 but writes NO archive-side provenance files (the per-asset provenance the Gallica fetcher writes and that bib reconcile scans under COLONY_ARCHIVE_ROOT). Result: bib reconcile PB-P013 reports 'no page-image provenance ... nothing acquired to reconcile' and the status stays approved-for-acquisition/to-collect -- the acquired master is orphaned from the corpus record (SSOT<->archive drift). Fix: persist AcquisitionResult.assets to the SSOT record on acquire AND write archive-side provenance (or make reconcile museum-aware: verify by the record's recorded objectStoreKey+checksum via ObjectStore.head, which works -- confirmed the head returns the sha256). Surfaced by the live end-to-end acquire.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed: Fixed 422072b: acquire persists asset + reconcile via ObjectStore.head; live-validated (PB-P013 archived).
<!-- SECTION:NOTES:END -->
