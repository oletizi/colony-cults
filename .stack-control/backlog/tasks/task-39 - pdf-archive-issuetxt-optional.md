---
id: TASK-39
title: pdf-archive-issuetxt-optional
status: To Do
assignee: []
created_date: '2026-07-17 19:36'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
ordinal: 39000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Archive-direct PDF (spec 014): src/pdf/load/archive-edition.ts hard-requires issue.txt (readFile fails loud if absent), but loadArchivePage prefers per-page translation/pNNN.fr.txt else the issue.txt segment. A source with only per-page corrected OCR and no issue.txt fails before loadArchivePage runs. Latent (all current targets P054/P055/P002 have issue.txt). Fix: tolerate a missing issue.txt (empty segments); loadArchivePage already fails-loud per-page when neither source yields OCR. Surfaced in execute controller review.
<!-- SECTION:DESCRIPTION:END -->
