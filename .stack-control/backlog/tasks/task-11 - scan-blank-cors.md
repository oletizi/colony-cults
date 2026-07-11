---
id: TASK-11
title: scan-blank-cors
status: Done
assignee: []
created_date: '2026-07-10 04:55'
updated_date: '2026-07-10 04:55'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
references:
  - site/src/islands/viewer.ts
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Deep-zoom scan rendered blank even after the folio fix (TASK-10). Root cause: the reading view used OSD's tiled IIIF path (fetches Gallica info.json cross-origin, which requires CORS Gallica does not reliably send to a browser) AND set crossOriginPolicy:'Anonymous' (forces CORS on the image element itself). Fix: source-iiif now emits a full-image descriptor pointing at Gallica's full-image url (.../f1/full/full/0/native.jpg, the sidecar's original_url form) and the viewer dropped crossOriginPolicy — a plain cross-origin image displays without CORS. True IIIF tiling is a deferred enhancement (would need a CORS-friendly image host or a proxy). Found in MVP phone review.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- **Node:** impl:feature/corpus-browser

Closed: Fixed in dc8c8c3: full-image descriptor (.../f1/full/full/0/native.jpg) + dropped crossOriginPolicy; renders without CORS. Rebuilt; served page emits native.jpg.
<!-- SECTION:NOTES:END -->
