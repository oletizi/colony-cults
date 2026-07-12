---
id: TASK-13
title: pdf-rail-continuation-leaf
status: To Do
assignee: []
created_date: '2026-07-11 22:03'
updated_date: '2026-07-11 22:03'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
corpus-print-pdf: the oxblood provenance rail + running head do not repeat on overflow-continuation leaves of long transcriptions. When a recto's FR/EN text is longer than one leaf it flows onto following pages that lack the rail and head, so the signature 'every recto tethered to its evidence' design intent (pdf/template/DESIGN.md) is only met on the first leaf of each source page. Refinement: make the running head + provenance rail repeat on continuation leaves via Typst page-scoped header/foreground reading a per-recto state (pdf/template/spread.typ / edition.typ). All provenance is also in the colophon, so this is a design-completeness refinement, not a data-integrity gap.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- **Node:** impl:feature/corpus-print-pdf
<!-- SECTION:NOTES:END -->
