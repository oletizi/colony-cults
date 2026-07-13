---
id: TASK-17
title: acquire-pb-p004-corpus
status: Done
assignee: []
created_date: '2026-07-13 03:20'
updated_date: '2026-07-13 05:43'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Operational acquisition campaign (no new code): acquire the 5 approved-for-acquisition PB-P004 members PB-P007..PB-P011 (Gallica monographs) via the shipped source-group-acquisition acquire path (resolve ark -> fetcher --object-store to B2 + provenance), then advance each RepositoryRecord to-collect -> archived. Class A writes, unaffected by the B2 download cap. Closes the known-but-missing acquisition gaps surfaced by bib coverage.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed: acquired upstream; PB-P004 lifecycle reconciled via bib reconcile (TASK-21), PR #35 merged
<!-- SECTION:NOTES:END -->
