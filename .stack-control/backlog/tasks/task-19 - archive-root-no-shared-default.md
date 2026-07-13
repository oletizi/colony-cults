---
id: TASK-19
title: archive-root-no-shared-default
status: To Do
assignee: []
created_date: '2026-07-13 04:39'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per the 2026-07-12 policy (per-session archive clones, never a shared working tree), resolveArchiveRoot must STOP defaulting to a fixed shared sibling clone (~/work/colony-cults-archive / ../colony-cults-archive). That default silently funnels concurrent sessions into one working tree -> the corruption class seen on TASK-17 (non-ff push, add/add conflicts, --checkpoint sweeping other sessions' files). Change: require an explicit COLONY_ARCHIVE_ROOT/--archive-root (fail loud if unset), or derive a per-checkout default co-located with the code repo — never a single machine-global shared path. Pairs with TASK-18 (scope --checkpoint's add). See src/archive/location.ts / resolveArchiveRoot.
<!-- SECTION:DESCRIPTION:END -->
