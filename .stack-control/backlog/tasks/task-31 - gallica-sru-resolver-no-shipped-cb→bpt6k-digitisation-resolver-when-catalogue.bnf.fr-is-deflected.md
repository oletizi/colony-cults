---
id: TASK-31
title: >-
  gallica-sru-resolver: no shipped cb→bpt6k digitisation resolver when
  catalogue.bnf.fr is deflected
status: To Do
assignee: []
created_date: '2026-07-16 17:00'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - specs/009-corpus-gap-closure/tasks.md
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PB-P002 discovery leads are BnF catalogue notices (cb...). bib inventory needs Gallica document arks (bpt6k...). The only shipped cb->bpt6k path (bib discover / bnf-catalogue-sru) probes catalogue.bnf.fr, which the CDN deflects. Reachable index is Gallica's own SRU (gallica.bnf.fr/SRU), which returns bpt6k arks for a title/author search, but no shipped verb wraps it. First attempt: a one-off resolver driving the shipped polite HttpClient (not raw fetch). Graduate to a real bib verb if it proves repetitive. FR-013 capability gap surfaced by the corpus-growth (US3) pass.
<!-- SECTION:DESCRIPTION:END -->
