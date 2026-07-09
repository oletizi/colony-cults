# Quickstart: Source Groups — validation & guardrail walkthrough

Runnable scenarios that prove the feature end-to-end. Assumes the repo is installed
(`npm install`) and run via `tsx`/`vitest` as elsewhere in this project.

## Prerequisites

- Feature 004 (canonical source metadata) shipped — the SSOT loader/validator/regenerator exist.
- `bibliography/sources/PB-P004.yml` present (migrated to `kind: source-group`).

## Scenario 1 — A source group validates (US2, FR-004/005)

```bash
# Validate the whole bibliography; PB-P004 as a source group must pass.
tsx src/cli/index.ts bib validate      # (existing bib verb; exact invocation per src/cli/bibliography.ts)
```

Expected: exit 0, no findings for `PB-P004`. A group with zero members is accepted. If you add a
`repositoryRecords:` block to a source-group record, re-running reports
`group-has-repository-records` for that id and exits non-zero.

## Scenario 2 — Fetch of a source group is refused informatively (US1, FR-002/003/011, TASK-3)

```bash
tsx src/cli/index.ts fetch-source PB-P004 --source-id PB-P004
```

Expected: **non-zero exit** with:

```
fetch-source: "PB-P004" is a Source Group — it has no archival object to fetch.
Discover and inventory its members, then fetch the members.
```

NOT the old `sourceLayout: no archive layout registered for source "PB-P004"`. An ordinary
fetchable source (e.g. `PB-P001`) is unaffected — its fetch behaves exactly as before.

## Scenario 3 — Member stub with a discovery status (US3, FR-008)

Add a member stub `bibliography/sources/PB-P037.yml` with `partOf: PB-P004` and
`status: discovered` (see contracts/source-group-record.md), then:

```bash
tsx src/cli/index.ts bib validate
```

Expected: exit 0. `discovered` and `approved-for-acquisition` validate as status values;
`PB-P037` resolves its `partOf` to the `PB-P004` group. Point `partOf` at a missing id →
`dangling-part-of`; point it at a non-group source → `part-of-not-a-group`.

## Scenario 4 — Regeneration stays deterministic with a group present (R-002)

```bash
tsx src/cli/index.ts bib regenerate     # regenerate derived views
git diff --stat bibliography/           # expect no spurious churn on re-run
```

Expected: `sources.csv` contains one `PB-P004` row (kind `source-group`, empty acquisition
columns) plus member rows; the acquisition tracker/register contain **no** PB-P004 row.
Re-running regenerate produces a byte-identical result (view-drift check clean).

## Scenario 5 — Migration is idempotent (R-003)

```bash
tsx src/cli/index.ts bib migrate        # or the specific migrate entry per migrate.ts
```

Expected: on an already-migrated `PB-P004.yml`, the migration is a no-op (no diff). On a
pre-migration monograph record, it rewrites to `kind: source-group`, drops the single
`to-collect` repository record, and preserves titles/case/notes.

## Automated coverage

- `tests/unit/bibliography/validate-checks.test.ts` — the four group/member findings + zero-member OK.
- `tests/unit/bibliography/vocab.test.ts` — the two new statuses; existing statuses unchanged.
- `tests/unit/bibliography/migrate.test.ts` — PB-P004 monograph→group, idempotent.
- `tests/unit/model/source.test.ts` — `kind` union + `partOf`.
- `tests/integration/source-groups.test.ts` — validate + fetch-refuse + regenerate end-to-end.

Run all: `vitest run`.
