# Phase 1 Data Model: Page-range (excerpt) acquisition

## Entity: Folio selection (transient input)

The normalized result of parsing a `--pages <spec>` argument.

- **Type**: `number[]` — de-duplicated, ascending, every element a positive integer.
- **Producer**: `parseFolioRange(spec: string): number[]` (new pure module `src/fetch/folio-range.ts`).
- **Grammar** (`<spec>`): one or more comma-separated *tokens*; each token is either a single folio `N` or an inclusive range `A-B` (with `A <= B`). Whitespace around commas/hyphens tolerated.
- **Validation (fail-loud, throws with a descriptive message)**:
  - non-integer / non-numeric token → error
  - `A > B` in a range (reversed, e.g. `50-48`) → error
  - any folio `< 1` → error
  - a spec that resolves to zero folios (empty/whitespace) → error
  - duplicates / overlaps (`48-50,49`) → NOT an error; de-duplicated into the ascending set
- **Note**: bounds against the document (`folio > pageCount`) are NOT the parser's job — the parser has no document; the fetch core enforces the upper bound once `pageCount` is known.

## Entity: `RepositoryRecord.folios` (new optional field)

Records an excerpt holding's intended extent.

- **File**: `src/model/repository-record.ts` — add `folios?: number[]` to the `RepositoryRecord` interface.
- **Semantics**: present ⇒ the held copy is an EXCERPT of the document at `originalUrl`/`identifiers` ark, comprising exactly these folios. Absent ⇒ a whole-document holding (today's behavior, unchanged).
- **Invariants**: when present, non-empty, ascending, unique, all `>= 1` (mirrors the parser's normalized output).
- **Round-trip**: loader (`src/bibliography/load-fields.ts` / `authored-record.ts`), serializer (`src/bibliography/migrate-serialize.ts`), and validation (`src/bibliography/validate-checks.ts`) must read/write/validate `folios` losslessly. Vocab/allow-list updates in `src/bibliography/vocab.ts` if the loader is allow-list-driven.
- **Completeness**: an excerpt record is COMPLETE when the archive holds exactly `folios` (masters verified in the object store) — independent of the document's `pageCount`. No `held==pageCount` gate exists; none is added.

## Entity: fetch context `folios` (new optional field)

- **Files**: `FetchMonographContext` (and `FetchIssueContext` if shared) in `src/fetch/issue.ts` — add optional `folios?: number[]`.
- **Behavior**: absent ⇒ loop `1..pageCount` (unchanged). Present ⇒ loop exactly `folios`, each fetched via `iiifImageUrl(ark, folio)` → `f<NNN>.jpg`, so filenames / object keys / provenance keys are unchanged.
- **Bounds check (fail-loud)**: after resolving `pageCount = ctx.client.pagination(ark)`, reject the run if any requested folio `< 1` or `> pageCount` — write nothing.
- **Result**: `FetchIssueResult.pageCount` keeps meaning the document total; add `requestedFolios?: number[]` (or `fetchedCount`) for an accurate summary line.

## Relationships

```text
--pages <spec>  --parseFolioRange-->  number[] (selection)
                                          |
                                          v
                         fetch context.folios  --constrains-->  per-page loop (issue.ts)
                                          |                          |
                                          v                          v
                    RepositoryRecord.folios (recorded)      f<NNN>.jpg masters + per-page provenance
                                          |
                                          v
                              reconcile: held folios == declared folios  (complete)
```

## Non-changes (explicit)

- `Provenance` (`src/model/provenance.ts`) — NO change; already per-asset (per-folio).
- Object store keying, checksum, manifest — NO change; excerpt folios key identically.
- Rights model — NO change; excerpt inherits the document's rights.
