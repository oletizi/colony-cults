# Quickstart: Source-Group Acquisition

Validates the pipeline end-to-end. Assumes the shipped `gallica` CLI builds and the private archive / B2 object store are configured (`COLONY_ARCHIVE_ROOT`, B2 credentials) as for the existing fetcher.

## Prerequisites

- `npm install`; `npm run typecheck` and `npm test` green.
- PB-P004 exists as a `source-group` (`bibliography/sources/PB-P004.yml`) — shipped.
- The discovery mechanism selected by the spike is reachable (or you have operator-supplied candidate ARKs).

## Scenario A — single member, happy path (SC-001)

```bash
# 1. Inventory a known public-domain legal record into PB-P004
bib inventory <ark> --group PB-P004 --kind monograph
#    → creates bibliography/sources/PB-P007.yml (partOf: PB-P004, status: discovered)
#      + a RepositoryRecord (status: wanted) + an immutable metadata snapshot

# 2. Verify the copy (deterministic; no status change)
bib verify-member PB-P007
#    → verdict: identifierResolved/rights/requiredMetadata/duplicate = passed

# 3. Promote (reruns verification, records verdict, advances lifecycle)
bib promote PB-P007
#    → Source discovered → approved-for-acquisition; RepositoryRecord wanted → to-collect;
#      verification verdict recorded

# 4. Acquire (reuses the shipped fetcher; ARK resolved from the RepositoryRecord)
bib acquire PB-P007 --object-store
#    → page images → B2, OCR, provenance; the operator never typed the ARK again
```

**Expected**: PB-P007 ends `approved-for-acquisition` with a recorded verdict and mirrored assets in the object store; provenance written.

## Scenario B — non-acquirable candidate is excluded (FR-013a)

```bash
bib inventory <non-public-domain-ark> --group PB-P004
bib verify-member PB-P008          # → rights check fails
bib exclude-member PB-P008 --reason "not public domain"
#    → Source discovered → excluded, reason recorded; never promoted or acquired
```

## Scenario C — ambiguity and fail-loud (FR-009a, SC-005)

```bash
# A member with two archive copies requires an explicit selector
bib promote PB-P009                     # → fails loud: --archive required
bib promote PB-P009 --archive "Gallica / BnF"   # → selects that copy

# Discovery mechanism unavailable → clear failure, no fallback
bib discover "marquis de Rays procès"   # → fails loud if the mechanism is down
```

## Scenario D — reusability on a second source-group (SC-003)

Run Scenario A against a **different** existing source-group id (not PB-P004) to prove the pipeline is corpus-agnostic — same commands, no PB-P004 special-casing.

## Scenario E — the PB-P004 validation run (SC-002)

Drive Scenario A for each identified original court record of the Marquis de Rays corpus (indictment, proceedings, sentencing, appeal, government report). Acceptance: the corpus's public-domain records are acquired to the object store, each with preserved provenance and an immutable raw-metadata snapshot.

## Reference

- Command contracts: [contracts/cli-commands.md](./contracts/cli-commands.md)
- Data model & state transitions: [data-model.md](./data-model.md)
- Design decisions: [research.md](./research.md)
