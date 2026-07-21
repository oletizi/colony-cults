---
id: TASK-41
title: discovery-hathitrust-googlebooks-broad-sweep
status: To Do
assignee: []
created_date: '2026-07-17 16:26'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
ordinal: 41000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Untried discovery axis (partially recorded only as negative PB-P012 lookups). Neither HathiTrust nor Google Books has had a proper affair-wide sweep; both appear in the search-log only as narrow negative holding-checks for the Vermont plaidoiries (PB-P012). A broad pass is likely to re-find already-held books (de Groote, Baudouin) but may surface untried English/French monographs on the affair or the New Italy aftermath not present on Gallica or the Internet Archive. Note the prior Google Books friction: keyless API rate-limits (429) - route through the shipped polite HttpClient with a key if needed. capture-not-scope: axis recorded; query handles, dedup against held corpus, and rights method to be scoped when run.
<!-- SECTION:DESCRIPTION:END -->
