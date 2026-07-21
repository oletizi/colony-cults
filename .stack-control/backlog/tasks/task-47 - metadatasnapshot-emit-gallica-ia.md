---
id: TASK-47
title: metadatasnapshot-emit-gallica-ia
status: To Do
assignee: []
created_date: '2026-07-19 20:58'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - specs/016-acquire-metadata-completion/spec.md
ordinal: 47000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-on from spec 016 (acquire-metadata-completion) clarify decision (2026-07-19): record-level metadataSnapshot completeness is best-effort per-adapter. papers-past and new-italy-museum records emit a record-level metadataSnapshot; gallica and internet-archive adapters do not yet. To fully realize Principle XV metadata completeness, add record-level metadataSnapshotRef emission to the gallica and internet-archive acquire paths so their acquired records carry the persisted-response snapshot like museum/papers-past. Scoped OUT of spec 016 (which does not fail an adapter for an absent snapshot); this item adds the emission per adapter.
<!-- SECTION:DESCRIPTION:END -->
