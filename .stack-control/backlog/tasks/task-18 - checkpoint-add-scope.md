---
id: TASK-18
title: checkpoint-add-scope
status: To Do
assignee: []
created_date: '2026-07-13 04:37'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
archive-checkpoint (bib acquire --checkpoint / source-group-acquisition) uses an add-all (git add -A / add .), which sweeps UNRELATED uncommitted files in the shared archive clone into the acquisition commit. Observed 2026-07-12: acquiring PB-P007 with 0 new masters produced commit 568c51c that swept another session's uncommitted p101-p103 translation drafts + MANIFEST.sha256 into an archive(PB-P007) commit, then a non-fast-forward push and add/add rebase conflicts on the shared clone. Fix: scope the checkpoint git add to the acquired unit's paths (the source's archive dir + its manifest), never add-all, so concurrent sessions' working-tree files are not captured. See src/cli/archive-checkpoint.ts.
<!-- SECTION:DESCRIPTION:END -->
