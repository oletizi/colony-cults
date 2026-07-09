# Quickstart: Canonical Source Metadata Model

Validation scenarios that prove the feature works end-to-end. Assumes the repo is installed (`npm install`) and the `yaml` dependency added (research R-002).

## Prerequisites

- Node 20, `tsx`, `vitest` (already in `devDependencies`).
- The private archive checkout at `../colony-cults-archive` for provenance-derived scenarios (per-asset provenance is read from there).
- `data/census/PB-P001-la-nouvelle-france.json` present (it is).

## Scenario 1 — PB-P001 keeps both archive copies (P1 / SC-001 / SC-005)

`bib migrate` folds the five *original* representations into the SSOT and restores the SLQ record. Its durable input is the pair of curated CSVs frozen under `bibliography/legacy/` (`sources.csv` + `acquisition-tracker.csv`) — NOT the top-level `bibliography/sources.csv` / `acquisition-tracker.csv`, which are *generated views* (Scenario 3) written only by `bib regenerate` and are never valid migrate input (they are lossy re-derivations of the SSOT). Because the frozen originals never change, `bib migrate` IS re-runnable and idempotent: re-running it reproduces byte-identical `bibliography/sources/*.yml`. Verify the result directly:

```bash
npx tsx src/index.ts bib show PB-P001 --json --archive-root <archive-checkout>
```

**Expected**: two `repositoryRecords` for PB-P001 — one `Gallica / BnF`, one `State Library of Queensland` — each with its own copy-level identifier and provenance. Adding a Gallica acquisition never removes the SLQ record.

## Scenario 2 — Identifier placement is enforced (P2 / SC-002)

Author a Source YAML with an `ark` under `identifiers:` (copy-level on a work), then:

```bash
npx tsx src/index.ts bib validate --json
```

**Expected**: exit `1`; a `identifier-leak` finding naming the `ark` value and stating it belongs at copy level. Move it under the matching `repositoryRecords[].identifiers` → validate exits `0`.

## Scenario 3 — One edit, regenerated views agree (P2 / SC-003 / SC-004 / SC-008)

```bash
# edit a title in bibliography/sources/PB-P001.yml, then:
npx tsx src/index.ts bib regenerate
git diff --stat bibliography/           # sources.csv (+ other views) updated, no hand edits
npx tsx src/index.ts bib validate       # exit 0: no view-drift
# now hand-edit bibliography/sources.csv directly, then:
npx tsx src/index.ts bib validate       # exit 1: view-drift finding
```

**Expected**: derived views change only via regeneration; a hand-edited view is flagged as drift.

## Scenario 4 — Serial issues match the census (P3 / SC-006)

```bash
npx tsx src/index.ts bib show PB-P001 --json | jq '.repositoryRecords[].issues | length'
```

**Expected**: issue count equals the census `totalIssues` (78); each copy references an asset manifest, not a single checksum.

## Scenario 5 — Referential integrity (P3 / SC-007)

```bash
npx tsx src/index.ts bib validate --json    # on a clean tree → { ok: true, findings: [] }
```

Seed an orphan (an asset provenance with no matching repository record) and a record with no source → re-run → both reported; remove them → clean.

## Automated equivalents

```bash
npm test -- bibliography          # unit: load/derive/regenerate/validate/migrate
npm test -- integration/bibliography   # end-to-end: PB-P001 two-copy + regenerate + validate
npm run typecheck                 # tsc --noEmit, no any/as/@ts-ignore
```

**Definition of done for this feature**: all five scenarios pass, `bib validate` is clean on the migrated tree, and `npm test` + `npm run typecheck` are green.
