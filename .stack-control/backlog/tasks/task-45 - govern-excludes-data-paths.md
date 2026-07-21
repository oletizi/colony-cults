---
id: TASK-45
title: govern-excludes-data-paths
status: To Do
assignee: []
created_date: '2026-07-19 06:46'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - specs/015-papers-past-acquisition/audit-log.md
ordinal: 45000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
stackctl govern (audit-barrage payload assembly) FATALs when the whole-feature diff includes a committed data file larger than the 24KB per-file fleet envelope — e.g. a ~49KB source-page capture under bibliography/repository-responses/ (every Papers Past acquire produces one; captures are committed by convention, 111 tracked). Govern's code-only scoping excludes .md docs but not large .html/.json data captures. Fix: govern should exclude the corpus data paths (bibliography/repository-responses/ and archive companions) from the CODE audit payload, the same way it excludes documentation. Workaround used for 015: operator-authorized --override (short-circuits the barrage).
<!-- SECTION:DESCRIPTION:END -->
