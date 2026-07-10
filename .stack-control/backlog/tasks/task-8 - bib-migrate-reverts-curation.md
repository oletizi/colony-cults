---
id: TASK-8
title: bib-migrate-reverts-curation
status: To Do
assignee: []
created_date: '2026-07-10 00:26'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
references:
  - >-
    https://github.com/oletizi/colony-cults/blob/feature/source-groups/src/bibliography/migrate.ts
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
bib migrate (migrate() in src/bibliography/migrate.ts) rebuilds non-group SSOT records from the frozen bibliography/legacy/*.csv on every run, silently reverting post-fold hand-curation: PB-P001's SLQ repository-record restore (004) and PB-P002's repository records are lost on a re-run. Feature 005 added source-group preservation (kind:source-group records survive), but non-group divergence remains. Surfaced by the 005 quickstart Scenario 5 walkthrough. Fix options: (a) migrate() reads+preserves existing SSOT beyond source-groups, (b) refuse/warn when SSOT has diverged from the legacy fold, or (c) deprecate re-running the one-time fold. Out of 005 scope.
<!-- SECTION:DESCRIPTION:END -->
