---
id: TASK-46
title: acquire-metadata-completion-structural
status: To Do
assignee: []
created_date: '2026-07-19 19:20'
updated_date: '2026-07-19 19:21'
labels:
  - agent-found
  - 'type:gap'
  - promoted
dependencies: []
references:
  - src/sourcegroup/acquire.ts
ordinal: 46000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Constitution Principle XV (added v1.4.0) requires any process that retrieves an object or writes an asset to complete its SSOT metadata in the SAME operation, fail-loud, mechanically impossible to skip. The current acquire pipeline VIOLATES this: bib acquire records assets + companions but does NOT advance the RepositoryRecord status; a SEPARATE bib reconcile (which the operator must remember to run) advances to-collect -> archived. Confirmed live this session: acquiring PB-P061 left status at to-collect with 3 masters already in B2 until a manual reconcile. This is the historical TASK-20 finding (Done), whose fix (TASK-21 -> reconcile.ts) landed the reconcile logic but as a SEPARABLE step, not welded into acquire. Scope: make metadata completion STRUCTURAL — weld status advancement + the full record (assets, provenance, checksum, status, metadataSnapshot) into the acquire operation so it is mechanically impossible to finish an acquisition with an incomplete or unadvanced record; fail loud if the metadata cannot be written; retire the acquire-now-reconcile-later split (or make reconcile an inseparable automatic tail of acquire). Applies to every adapter (gallica / new-italy-museum / internet-archive / papers-past). Earns the full spec-driven treatment (feature-rigor tier).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- **Promoted-to:** roadmap:impl:feature/acquire-metadata-completion
<!-- SECTION:NOTES:END -->
