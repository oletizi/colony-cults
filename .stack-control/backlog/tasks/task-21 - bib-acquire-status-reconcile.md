---
id: TASK-21
title: bib-acquire-status-reconcile
status: To Do
assignee: []
created_date: '2026-07-13 05:07'
labels:
  - agent-found
  - 'type:bug'
dependencies: []
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make bib acquire honor contract line 64 (specs/006-source-group-acquisition/contracts/cli-commands.md): it promises acquire 'Advances the RepositoryRecord acquisition status via the fetcher's existing path' but the impl never advances the code-repo SSOT (see TASK-20). Fix: after acquisition (masters in object store + provenance committed), reconcile the member's RepositoryRecord — set status to collected/archived and attach the object_store handle — by folding the archive's per-page object_store provenance into repositoryRecords[].status, then write the source YAML via writeSourceFile/serializeSource. PREFERRED shape: a separate idempotent 'bib reconcile <id>' verb that DERIVES status from archive object_store provenance (re-runnable; works for members already acquired upstream like PB-P007..P011; closes TASK-17 without re-fetching), rather than inlining only in runAcquire. Deterministic mapping: object_store handles present for all pages -> archived (else collected). Do NOT use bib migrate (rebuilds from stale legacy CSVs; TASK-8). Acceptance: after acquire/reconcile, bib show + bib coverage report the member acquired; PB-P007..P011 advance past to-collect; bib validate clean; idempotent on re-run. Interim (permitted) to unblock TASK-17 before this lands: hand-author the 5 statuses + object_store handle (legitimate SSOT authoring), regenerate/validate/commit. Blocks/relates: TASK-17, TASK-20.
<!-- SECTION:DESCRIPTION:END -->
