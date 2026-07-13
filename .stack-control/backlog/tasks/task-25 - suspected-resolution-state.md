---
id: TASK-25
title: suspected-resolution-state
status: To Do
assignee: []
created_date: '2026-07-13 18:52'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
spec 009 US4: suspected[] items need a first-class 'resolution' state (unexamined|identified|inventoried|excluded|unavailable) that bib coverage RENDERS, so resolved leads stop showing as open suspected. Shipped model rejects it: load-coverage-fields assertKnownKeys allows only description/basis/evidenceClass/notes on a suspected entry (fails loud on 'resolution'). Proven needed by the PB-P006 US4 pass (leads identified but the resolution is only recordable in free-text notes, invisible to the audit). This is the data-model.md SuspectedLead resolution field / a Phase-4 tool-on-demand. Also: validateKnownMemberCount only accepts number|'unknown', so the three-state extent (unexamined/irreducible, T029) is likewise unbuilt.
<!-- SECTION:DESCRIPTION:END -->
