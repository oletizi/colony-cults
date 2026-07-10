---
id: TASK-3
title: pb-p004-source-layout
status: Done
assignee: []
created_date: '2026-07-08 14:28'
updated_date: '2026-07-10 04:34'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SOURCE_LAYOUTS registers only PB-P001/P002/P003; the spec scopes PB-P004 (trial/legal records) but --source-id PB-P004 fails at sourceLayout() before any work. Also SOURCE_LAYOUTS is config-as-code (editing TS to onboard a source). Fix: register PB-P004 once its Gallica item is identified, and/or make source onboarding data-driven from the acquisition-register. (govern MEDIUM)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed: Resolved by impl:feature/source-groups (shipped+closed): PB-P004 reclassified kind:source-group; fetch-source throws a descriptive 'is a Source Group — discover its members' guardrail (verified in src/cli/fetch-source.ts).
<!-- SECTION:NOTES:END -->
