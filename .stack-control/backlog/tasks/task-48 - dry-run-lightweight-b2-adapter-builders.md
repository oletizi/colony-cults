---
id: TASK-48
title: dry-run-lightweight-b2-adapter-builders
status: To Do
assignee: []
created_date: '2026-07-20 00:36'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
ordinal: 48000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
buildMuseumAdapterForMember / buildInternetArchiveAdapterForMember / buildPapersPastAdapterForMember (specs 011/013/015) resolve B2/private-archive config while CONSTRUCTING the adapter, regardless of --dry-run. So 'bib acquire <B2-direct id> --dry-run' fails in a fresh/metadata-only env even though dry-run mirrors nothing (AUDIT-20260720-04). Thread dry-run into the builder decision (or provide dry-run-lightweight adapters that defer config until a real mirror). Pre-existing cross-adapter concern surfaced during spec 016 govern; out of that feature's scope.
<!-- SECTION:DESCRIPTION:END -->
