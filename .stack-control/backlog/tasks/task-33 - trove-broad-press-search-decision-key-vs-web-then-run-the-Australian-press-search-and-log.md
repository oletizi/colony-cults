---
id: TASK-33
title: >-
  trove-broad-press-search-decision: key-vs-web then run the Australian-press
  search-and-log
status: To Do
assignee: []
created_date: '2026-07-17 06:34'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - bibliography/sources/PB-P005.yml
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The parallel Australian-press sweep (PB-P005) covers the affair + New Italy aftermath in Trove. No Trove ADAPTER (SRCH-0007 disproved it) -- search-only for discovery/measurement, acquire discrete anchors manually n=1.

ToS REVIEW (2026-07-17, operator-supplied full Trove API Terms of Use). The API terms are COMPATIBLE for discovery, with constraints:
- Metadata-only scope: the API rights extend ONLY to metadata; they do NOT cover digital objects/images (thumbnail/viewcopy), and the 2025 NLA enforcement treats API extraction of resource CONTENT (e.g. newspaper full text) as a breach. So DO NOT pull article text/images via the API -- acquire the public-domain articles OUT-OF-BAND (manual, on their own pre-1955 PD basis; governed by the general Trove Terms of Use + Copyright, not the API terms -- those two pages still un-reviewed).
- Caching (clauses 8-10): the API licence permits caching metadata for at most 30 days and requires removal if withdrawn -- structurally incompatible with our permanent public repo. RESOLVED by an EXCEPTION: our persist-raw-responses convention is a frugality/politeness convenience, not a hard rule; for Trove we DO NOT persist raw API responses (re-fetch instead). Record only DERIVED facts (counts, a few article IDs) in the search-log, with Trove attribution.
- Attribution (clause 11): credit Trove + the third-party source, hyperlink, use the logo on any public display.
- Rate (clauses 12-13): stay within the per-minute quota; our ~1 req/s discipline complies.
- Durability caveat (clauses 19-20): NLA revokes keys + changes terms without notice (did so in 2025) -- treat the API as a discovery convenience, NEVER a dependency.

DECISION (reframed from the original key-vs-web): use Trove for DISCOVERY only, no raw-response persistence, derived-facts-with-attribution in the search-log, content acquired out-of-band. Open sub-questions: (a) register our own API key (non-transferable, 12-month expiry) vs keyless web interface; (b) review the general Trove Terms of Use + Copyright before relying on the web route; (c) then run the search-and-log and author the SearchLogRecord.
<!-- SECTION:DESCRIPTION:END -->
