---
id: TASK-10
title: source-iiif-folio-padding
status: Done
assignee: []
created_date: '2026-07-10 04:41'
updated_date: '2026-07-10 04:43'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
references:
  - src/browser/providers/source-iiif.ts
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The source-iiif provider builds the IIIF folio segment from the zero-padded image filename folioId (e.g. f001), producing URLs like https://gallica.bnf.fr/iiif/ark:/12148/bpt6k56068358/f001 — but Gallica's IIIF uses UN-padded folios (f1, f2, ...). The page sidecar's own original_url confirms .../f1/full/full/0/native.jpg. Result: the deep-zoom scan does not load (blank OpenSeadragon pane) in the reading view. Fix: map the zero-padded folioId to Gallica's un-padded IIIF folio (strip leading zeros) in src/browser/providers/source-iiif.ts, OR carry the sidecar's original_url/IIIF base through PageInput and use it directly. Found during MVP preview of the reading view (T015/T016). Add a provider unit-test asserting the built IIIF folio is un-padded, and re-verify against a real Gallica info.json.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- **Node:** impl:feature/corpus-browser

Closed: Fixed in 81da98e: source-iiif un-pads folioId (f001->f1) for Gallica IIIF; provider tests added; site rebuilt, built pages now emit /f1.
<!-- SECTION:NOTES:END -->
