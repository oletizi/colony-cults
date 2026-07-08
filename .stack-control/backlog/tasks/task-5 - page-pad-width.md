---
id: TASK-5
title: page-pad-width
status: To Do
assignee: []
created_date: '2026-07-08 14:28'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Page filenames pad to 3 digits (f001); a monograph/document >999 pages breaks name-sort ordering (though the ordinal is stored). Fix: derive pad width from pageCount (String(pageCount).length) or pad to 4. (govern LOW)
<!-- SECTION:DESCRIPTION:END -->
