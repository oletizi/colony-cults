---
id: TASK-49
title: cases-layout-slug-collision-newspaper-members
status: To Do
assignee: []
created_date: '2026-07-21 05:35'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
ordinal: 49000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Newspaper source-group members sharing a canonical title (headline) derive the SAME cases-layout slug -- deriveSourceLayout (src/archive/location.ts) slugs by title -- so their page-master companions at archive/cases/<case>/<type>/<slug>/f<NNN>.yml COLLIDE and overwrite each other; only the last-acquired member's companions survive and bib validate flags the rest as undiscoverable-master. Surfaced acquiring the de Rays batch: 3 members titled 'ARREST OF THE MARQUIS DE RAYS' (PB-P062 NZH, PB-P065 MEX, PB-P067 THD) collided. Worked around by disambiguating the titles with masthead+date. Real fix: the cases-layout companion slug for periodical/newspaper members must be unique per source (incorporate the article code / sourceId), not the shared headline. Write-record-companions places page-masters by that slug.
<!-- SECTION:DESCRIPTION:END -->
