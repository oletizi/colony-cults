---
id: TASK-50
title: pdf-buildall-test-timeout-flake
status: To Do
assignee: []
created_date: '2026-07-22 02:43'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
buildAll integration tests (tests/integration/pdf/batch.test.ts, member-discovery.test.ts) intermittently exceed the 5000ms default vitest timeout under parallel worker-pool CPU contention; pass reliably serial (--no-file-parallelism) or with --testTimeout>=20000. Confirmed pre-existing (present on the pre-spec-017 baseline via git stash), not introduced by the source-group PDF work. Fix: raise the default testTimeout for the pdf integration suite (vitest config) or reduce per-test staging work.
<!-- SECTION:DESCRIPTION:END -->
