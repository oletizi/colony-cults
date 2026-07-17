# Quickstart / Validation Guide: Page-range (excerpt) acquisition

Runnable scenarios that prove the feature works end-to-end. Details live in
[data-model.md](./data-model.md) and [contracts/](./contracts/); implementation lives in `tasks.md`.

## Prerequisites

- Repo deps installed; `npm test` (vitest) and `tsx` runnable.
- For the live end-to-end scenario only: a private per-session archive clone + B2 env
  (`COLONY_ARCHIVE_ROOT`, `COLONY_S3_*`, B2 creds) — see the `archive-acquisition-setup` memory
  and `specs/009-corpus-gap-closure/quickstart.md`. Unit scenarios need none of this.
- Folios confirmed by the pinpoint step (for PB-P054: Gallica `ContentSearch` grounds folios
  48–50 in "…Dubreil de Rays…").

## Scenario A — Folio-range parser (unit, no network)

```bash
npm test -- folio-range
```

**Expected**: all `parseFolioRange` cases from [contracts/model.md](./contracts/model.md) pass —
`"48-50,55"` → `[48,49,50,55]`; dedup of `"48-50,49"`; and fail-loud throws for `"50-48"`,
`"0-3"`, `"48-"`, `""`.

## Scenario B — Fetch core fetches only the selected folios (unit, injected fakes)

```bash
npm test -- fetch/issue
```

**Expected** (fake Gallica client + object store, no real network):
- context with `folios: [48,49,50]` on a 200-page doc ⇒ exactly folios 48,49,50 fetched; no other.
- a requested folio `> pageCount` ⇒ throws, nothing written.
- context with NO `folios` ⇒ every folio `1..pageCount` fetched (unchanged-default regression).

## Scenario C — Dry-run scopes to the selection (unit/CLI)

```bash
bib fetch-source bpt6k61587296 --source-id PB-P054 --pages 48-50 --dry-run
```

**Expected**: reports rights + target dir + estimate for **3 folios**, writes nothing.

## Scenario D — Live end-to-end: acquire PB-P054 (needs archive + B2 env)

```bash
bib fetch-source bpt6k61587296 --source-id PB-P054 --pages 48-50 --object-store
bib reconcile PB-P054
```

**Expected**:
- exactly 3 masters (`f048.jpg`, `f049.jpg`, `f050.jpg`) mirrored to B2 with per-page provenance
  (checksum, object key, retrieval metadata, rights).
- `RepositoryRecord.folios` recorded as `[48, 49, 50]`.
- `bib reconcile PB-P054` → archived (3/3 declared folios in the object store).
- PB-P054 advances `to-collect` → `archived`.

## Scenario E — Fail-loud negatives (CLI)

```bash
bib fetch-source bpt6k61587296 --source-id PB-P054 --pages 9000     # > pageCount
bib fetch-source bpt6k61587296 --source-id PB-P054 --pages 50-48    # reversed
bib fetch-source bpt6k61587296 --source-id PB-P054 --pages ""       # empty
```

**Expected**: each exits non-zero with a descriptive error and writes nothing.

## Success mapping

| Spec success criterion | Scenario |
|---|---|
| SC-001 exactly the pertinent pages held | D |
| SC-002 N folios ⇒ N masters + N provenance | B, D |
| SC-003 whole-document unchanged | B (no-`folios` case) |
| SC-004 invalid selection refused, nothing written | A, E |
| SC-005 PB-P054 → archived, folios 48–50 in B2 | D |
