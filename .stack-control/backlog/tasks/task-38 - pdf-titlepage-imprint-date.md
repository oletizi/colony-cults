---
id: TASK-38
title: pdf-titlepage-imprint-date
status: To Do
assignee: []
created_date: '2026-07-17 19:35'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
ordinal: 38000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Archive-direct PDF (spec 014): the monograph title-page date falls back to the folio object's 'retrieved' (acquisition) timestamp, since the archive-direct path has no structured imprint date. For a scholarly facsimile the imprint/publication year (e.g. 1884) should show, not the acquisition date. Needs a date source decision: a structured date/year field on the Source model, or parsing the bibliography 'Years:' note. src/pdf/load/archive-edition.ts titlePage.date. Surfaced in execute controller review.
<!-- SECTION:DESCRIPTION:END -->
