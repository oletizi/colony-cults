---
id: TASK-28
title: verify-member/promote is Gallica-hardwired — blocks museum (accession) members
status: To Do
assignee: []
created_date: '2026-07-14 23:35'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Live end-to-end test of the 011 museum path (PB-P013, Pioneers Group Photo 1890) proved inventory + DOM + codex extraction + grounding + rights-assess all SANE, but promote is blocked: bib verify-member is Gallica-specific. identifierResolved (src/sourcegroup/verify-member.ts:268) runs the injected ArkResolver on the record (a museum record has an accession, no ark -> fails); rights (verify-member.ts:273) checks record.rights?.status (the Gallica OAIRecord Rights), not the museum rightsAssessment (-> fails). So an accession member cannot reach approved-for-acquisition, blocking acquire. 011 design FR-017 wrongly assumed museum group-members reuse the existing verify/promote path unchanged; that path needs the same repository-adapter dispatch acquire got (T012/T019). Fix: make verify-member/promote adapter-aware — for an accession member, identifierResolved = the museum adapter's resolve (DOM confirms item + accession), rights = the recorded rightsAssessment.rightsStatus === 'public-domain'. Surfaced by the live acquisition sanity test, not unit tests (which mocked the adapter).
<!-- SECTION:DESCRIPTION:END -->
