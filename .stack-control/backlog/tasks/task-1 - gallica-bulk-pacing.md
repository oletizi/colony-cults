---
id: TASK-1
title: gallica-bulk-pacing
status: To Do
assignee: []
created_date: '2026-07-08 10:07'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - specs/001-gallica-fetcher
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Gallica returns HTTP 429 after ~5 large IIIF image downloads; the default politeness (~1 req/s, backoff 1-8s x4 attempts) is too aggressive for bulk image mirroring. Tool behaves correctly (fail-loud + resumable, no data loss) but a full 78-issue run would need many manual re-runs. Refinement: honor the Retry-After header on 429, add a longer inter-request delay and/or per-issue cooldown for IIIF image fetches, consider concurrency=1 for images. Found during US2 live verification (issue bpt6k5603637g, mirrored 10/12 pages before throttle).
<!-- SECTION:DESCRIPTION:END -->
