---
id: TASK-16
title: pdf-untranslated-items
status: To Do
assignee: []
created_date: '2026-07-11 23:20'
updated_date: '2026-07-11 23:20'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The facing-page edition requires per-page English translation (FR-011). These v1-scoped items have NO English translation and therefore cannot be built (they fail loud, correctly): all Port Breton monographs PB-P002, PB-P003, PB-P007, PB-P008, PB-P009, PB-P010, PB-P011 (page p001 english empty), and one PB-P001 issue 1885-10-15_bpt6k56069168 (page p010 english empty). Generated: 72/73 PB-P001 issues. To include the monographs (and the last issue) in the printed corpus, run the source-translation pipeline over them first, then pdf:build.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- **Node:** impl:feature/corpus-print-pdf
<!-- SECTION:NOTES:END -->
