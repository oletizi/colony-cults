# Quickstart & Validation: Corpus Coverage & Discovery Audit

Runnable scenarios that prove the feature works end-to-end. Field shapes are in
[`contracts/authored-fields.md`](./contracts/authored-fields.md); the command contract is in
[`contracts/bib-coverage.md`](./contracts/bib-coverage.md). No implementation code here.

## Prerequisites

- Repo checked out on `feature/corpus-coverage-audit`; `npm install` done.
- The shipped `port-breton` bibliography under `bibliography/sources/`.

## Setup / build

```
npm test            # unit + integration
tsc --noEmit        # typecheck (no any/as/@ts-ignore)
```

## Scenario 1 — Report over the current corpus (US1)

```
bib coverage
bib coverage --json
```

**Expect**: per-campaign counts, evidence-class distribution, the (possibly empty) register,
and search history. Every unknown gap prints the literal `unknown`; there is **no** coverage
percentage. `git status` is clean afterward (nothing written).

## Scenario 2 — Record and resolve a citation (US2)

1. Add a `references[]` entry (no `resolvedTo`) to a source YAML (see contract).
2. `bib coverage` → the citation appears in the register as referenced-but-unidentified
   under its campaign (or the ungrouped bucket if the owning source has no `partOf`).
3. Set `resolvedTo` to an existing `sourceId`; re-run → it drops out of the unresolved register.
4. Set `resolvedTo` to a non-existent id; run `bib validate` → **fails loud**, naming
   the dangling reference.

## Scenario 3 — Suspected gap + believed extent (US3, US4)

1. Add a `suspected[]` entry (with `basis`) and `knownMemberCount: 3` to a source-group YAML.
2. `bib coverage` → the suspicion appears under that campaign with its `basis`; the
   per-campaign gap shows `3 - actual`.
3. Change to `knownMemberCount: unknown` → the gap prints the literal `unknown` (not `0`).
4. Add `suspected` or `knownMemberCount` to a non-group source; `bib validate` →
   **fails loud** (group-only fields).

## Scenario 4 — Search log (US5)

1. Append an entry to `bibliography/search-log.yml` with a unique `id` (see contract).
2. `bib coverage` → it appears in the repository × campaign matrix and the
   repository-axis rollup.
3. Append a second entry with a duplicate `id`; `bib validate` → **fails loud**, naming
   the duplicate id.

## Scenario 5 — Evidence class (US6)

1. Set `evidenceClass` on a source to a vocab value → counted in the distribution.
2. Set an out-of-vocabulary value; `bib validate` → **fails loud**, naming the value.

## Scenario 6 — Per-work counting (SC-006)

1. On a fixture, give one `Source` two RepositoryRecords (two archives).
2. `bib coverage` → the work counts **once** in lifecycle counts; copies show only in
   the per-archive view. Work-level totals are not inflated.

## Scenario 7 — Regenerability (SC-004)

1. `bib coverage --json > /tmp/a.json` (outside the tree); re-run to `/tmp/b.json`.
2. `diff /tmp/a.json /tmp/b.json` → identical. No derived file is committed; a snapshot for a
   past commit is reproduced by running at that commit.

## Validation-case: PB-P004 (SC-007)

Run every scenario above against `PB-P004` (the trial-records campaign) and confirm the same
commands work unchanged on any other source-group — no PB-P004-specific code path.
