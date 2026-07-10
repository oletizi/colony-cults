---
id: TASK-9
title: corpus-browser-incomplete-issues
status: To Do
assignee: []
created_date: '2026-07-10 01:37'
updated_date: '2026-07-10 01:37'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - specs/005-corpus-browser
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
loadCorpus fails-loud (correctly, per spec) on collected-but-incomplete PB-P001 issue dirs: the real archive has issue dirs missing issue.txt (e.g. 1883-12-16_bpt6k5606895j) and 5 of 78 issues missing translations. Per-page reading view (US1 MVP) is unaffected, but a full `astro build` (getStaticPaths over all issue dirs) throws until resolved. This is an operator scoping decision, NOT a loader bug — do NOT silently weaken the fail-loud contract. Options: (a) loader loads only complete issues and REPORTS (never silently drops) which declared/partial issues were skipped (honors "no silent caps"); (b) complete the missing data upstream; (c) explicit v1 allowlist of complete issues. Surfaced during /stack-control:execute of specs/005-corpus-browser, task T012. Ties to spec v1 scope "PB-P001, 78 issues".
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- **Node:** impl:feature/corpus-browser
<!-- SECTION:NOTES:END -->
