---
id: TASK-52
title: browser-loaders-bypass-archive-layout-overrides
status: To Do
assignee: []
created_date: '2026-07-28 21:10'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
references:
  - 'src/browser/load/books.ts:79'
ordinal: 52000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
browser/load/books.ts and browser/load/papers-past.ts rebuild archive/cases/<case>/<type> by hand instead of reading sourceLayout().type, bypassing FR-017 step 1 entirely: a manifest archiveLayoutOverride that relocates a Source is invisible to them. PB-P002 and PB-P003 are precisely the two sources carrying overrides (spec 018 T013 established their archive slugs are hand-authored and do not derive from the canonical title). Corpus-neutral, so not a second-corpus coupling point, but a real override-blindness defect on the browser path only. Found by spec 018 T017. NEEDS VERIFICATION against a real CORPUS_ARCHIVE_PATH clone to establish whether it breaks those two sources today or is latent.
<!-- SECTION:DESCRIPTION:END -->
