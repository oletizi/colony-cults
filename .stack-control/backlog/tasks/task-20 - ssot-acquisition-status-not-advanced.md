---
id: TASK-20
title: ssot-acquisition-status-not-advanced
status: Done
assignee: []
created_date: '2026-07-13 04:57'
updated_date: '2026-07-13 05:43'
labels:
  - agent-found
  - 'type:gap'
dependencies: []
references:
  - specs/006-source-group-acquisition/contracts/cli-commands.md#L64
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
BLOCKER for TASK-17 (acquire-pb-p004-corpus). No tool advances a RepositoryRecord acquisition status (to-collect -> collected/archived) in the code-repo SSOT after acquisition. The RUNBOOK reduced tail assumed `bib regenerate` closes the lifecycle from archive provenance; it does not.

Evidence (verified by the orchestrator, 2026-07-13):
- Masters ARE in B2 and per-page provenance (object_store handles) IS committed in the archive.
- `bib regenerate` (src/bibliography/regenerate.ts) writes ONLY the CSV views (bibliography/sources.csv + acquisition-tracker.csv). It never writes bibliography/sources/*.yml.
- `deriveModel` (src/bibliography/derive.ts) has NO logic folding object_store provenance into repositoryRecords[].status.
- No non-test src/ code assigns a record status of 'collected'/'archived'. The only sources/*.yml writers are migrate / inventory / promote / exclude-member / pdf-publish; none advance past to-collect.
- Contract specs/006-source-group-acquisition/contracts/cli-commands.md line 64 states acquire "Advances the RepositoryRecord acquisition status via the fetcher's existing path." The implementation does NOT — a spec/impl mismatch. The acquired state lives only in archive provenance.
- `bib migrate` rebuilds the SSOT from FROZEN bibliography/legacy/*.csv + a STALE archive acquisition-register.csv (pre-reclassification) — running it would corrupt the current source-group model (see TASK-8).

Net: PB-P007..P011 remain repositoryRecords[].status: to-collect in the SSOT; coverage shows no acquisition despite masters being in B2.

## Orchestrator decision (2026-07-13)

The finding is CORRECT and verified. Resolution:
- SANCTIONED FIX: implement the acquisition->SSOT reconcile so `bib acquire` honors contract line 64 (fold archive object_store provenance -> repositoryRecords[].status). Tracked as its own item **TASK-21 (bib-acquire-status-reconcile)** — framed as a bug-fix (spec-compliance), not a new feature.
- REJECTED: option (c) "surface into CSV at to-collect" — that would commit a record asserting the sources are NOT acquired, which is false.
- PERMITTED interim to unblock TASK-17: hand-author the 5 source YAMLs' RepositoryRecord status + object_store handle, then regenerate/validate/commit. This is legitimate SSOT authoring (the YAML IS hand-authored SSOT), NOT a code fallback — but the tool (TASK-21) is the durable answer.

The "no new code / operational campaign" premise of TASK-17 was invalidated by this discovery: a small amount of code (TASK-21) is genuinely required to honor the contract.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed: finding verified and resolved by TASK-21 (bib reconcile); PR #35 merged
<!-- SECTION:NOTES:END -->
