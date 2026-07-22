---
id: TASK-51
title: bib-sourcegroup-test-failing
status: Done
assignee: []
created_date: '2026-07-22 02:43'
updated_date: '2026-07-22 06:10'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
src/cli/bib-sourcegroup.test.ts has one failing test on feature/edition-publishing, confirmed pre-existing (present before spec 017 via git stash) and unrelated to the source-group PDF feature. Needs triage.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed: Not pre-existing — a T002b test gap. bib-sourcegroup.test asserted a member registers periodical-kind; T002b correctly makes members monograph-kind (flat). Fixed assertion + renamed test (4b8eeec); 22/22 green.
<!-- SECTION:NOTES:END -->
