---
id: TASK-29
title: museum acquire ignores --dry-run (would write to B2)
status: To Do
assignee: []
created_date: '2026-07-15 01:21'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
AcquisitionContext (src/repository/adapter.ts:50) is an empty placeholder; runAcquire builds a GallicaAcquisitionContext carrying dryRun/objectStore and passes it to adapter.acquire, but the museum NewItalyMuseumAdapter.acquire has NO dryRun handling (grep: none), so bib acquire --object-store --dry-run on an accession record actually downloads the master + PUTs it to B2 instead of previewing. Fix: hoist dryRun (and objectStore) onto the base AcquisitionContext and have the museum acquire honor dryRun (skip getBytes/put, return a would-acquire result). Surfaced preparing the live PB-P013 acquire.
<!-- SECTION:DESCRIPTION:END -->
