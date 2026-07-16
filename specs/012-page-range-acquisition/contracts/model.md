# Model Contract: folio-range parser + `RepositoryRecord.folios`

## `parseFolioRange(spec: string): number[]`

Pure function, new module `src/fetch/folio-range.ts`. No I/O, no document knowledge.

**Input**: a `--pages` spec string.
**Output**: de-duplicated, ascending `number[]`, every element `>= 1`.

**Contract**:

| Input | Output |
|-------|--------|
| `"48"` | `[48]` |
| `"48-50"` | `[48, 49, 50]` |
| `"48,50,52"` | `[48, 50, 52]` |
| `"48-50,55"` | `[48, 49, 50, 55]` |
| `"48-50,49"` | `[48, 49, 50]` (dedup) |
| `" 48 - 50 , 55 "` | `[48, 49, 50, 55]` (whitespace tolerated) |
| `"50-48"` | **throws** (reversed range) |
| `"0-3"` / `"-1"` | **throws** (folio `< 1`) |
| `"48-"` / `"a-b"` / `"48,,50"` | **throws** (malformed token) |
| `""` / `"   "` | **throws** (empty selection) |

Every throw carries a descriptive message naming the offending token and why (Constitution V).

## `RepositoryRecord.folios?: number[]`

- **Presence**: optional. Absent ⇒ whole-document holding (unchanged). Present ⇒ excerpt holding of exactly these folios of the record's document ark.
- **Shape when present**: non-empty, ascending, unique, all `>= 1` (same normal form as `parseFolioRange` output).
- **Serialization**: YAML sequence of integers under the repository record, e.g.

  ```yaml
  repositoryRecords:
    - sourceArchive: Gallica / BnF
      status: archived
      originalUrl: https://gallica.bnf.fr/ark:/12148/bpt6k61587296
      folios: [48, 49, 50]
      identifiers:
        - type: ark
          value: ark:/12148/bpt6k61587296
  ```
- **Round-trip**: load → in-memory `number[]` → serialize must be lossless and order-stable. `bib validate` accepts a well-formed `folios` and rejects a malformed one (non-array, non-integer, `< 1`, unsorted, or duplicate) fail-loud.
- **Whole-document records**: MUST continue to load/serialize/validate unchanged with `folios` absent.
