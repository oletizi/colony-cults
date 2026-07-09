---
id: TASK-6
title: archive-pdf-history-purge
status: To Do
assignee: []
created_date: '2026-07-08 20:18'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - colony-cults-archive
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The archive git history still contains the ~28 committed issue.pdf blobs (~0.5-1 GB) even though they are removed from the working tree (commit da3c0dc code change + archive e5308ea removal). Reclaim that space with a one-time history rewrite (git filter-repo / BFG to strip all archive/**/issue.pdf) + force-push to colony-cults-archive. Do this AFTER the bulk mirror run completes (avoid rewriting history while actively committing). Private repo, single author, so a force-push is safe. Also consider Git LFS or object storage before mirroring the remaining Port Breton sources (PB-P002..P006), which will add several more GB each.
<!-- SECTION:DESCRIPTION:END -->
