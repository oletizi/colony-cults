---
id: TASK-24
title: search-log-keyed-by-group-only
status: To Do
assignee: []
created_date: '2026-07-13 18:36'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
bib search-log.yml keys each entry by campaign = source-group sourceId, but only 2 source-groups exist (PB-P004, PB-P006). The 6 standalone sources (PB-P001, PB-P002, PB-P003, PB-P005, PB-S001, PB-S002) belong to no group, so their real search provenance (e.g. PB-P001's SLQ + Gallica searches) has nowhere to be logged. Blocks full SC-001 (every in-scope repository x campaign logged). Fix: either add a port-breton core source-group for the ungrouped imprints, or let search-log accept a case-level/ungrouped campaign key. Surfaced during 009 US1 first search-and-log.
<!-- SECTION:DESCRIPTION:END -->
