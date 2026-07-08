# Phase 1 Data Model: Source Translation

Entities are lightweight — this feature derives text artifacts from an existing archive, reusing the fetcher's provenance/store types. No database; the archive filesystem is the store.

## Reused types (from the fetcher — not redefined here)

- **`ProvenanceFields`** (`@/archive/provenance`) — the per-artifact YAML companion record. Reused for translation artifacts. Fields already present that translation populates: `id`, `title`, `case`, `language`, `source_archive`, `catalog_url`, `rights_status`, `retrieved`, `local_path`, `sha256`, `format`, `notes`. See "Provenance additions" below for the machine-assisted/engine/model fields.
- **`StoreResult`**, **`storeAsset`**, **`companionYamlPath`**, **`isAssetRecorded`** (`@/archive/store`) — writing + idempotent skip.
- **`SourceLayout`**, **`resolveArchiveRoot`**, **`issueDir`**, **`findIssueDir`**, **`assertInsideArchive`** (`@/archive/location`) — locating the issue dir offline and guarding writes.

## New entities

### PageChunk
One page of an issue — the unit of work.

| Field | Type | Notes |
|-------|------|-------|
| `pageNumber` | number | 1-based; aligns with page image `fNNN.jpg`. |
| `sourceText` | string | Raw OCR text for this page (a `\f`-delimited slice of `issue.txt`). |
| `correctedFrench` | string \| null | Output of the cleanup pass; null until produced. |
| `english` | string \| null | Output of the translation pass; null until produced. |

**Derivation**: `splitPages(issueText)` = `issueText.split('\f')`, dropping a trailing empty final element. Chunk index i → `pageNumber` i+1.

**Lifecycle / state**: `pending` → (cleanup) → `cleaned` → (translate) → `translated`. Each transition is idempotent and independently persisted (per-page intermediate files), so a re-run resumes at the first non-`translated` page. A failed transition leaves the page in its prior persisted state — never a partial artifact.

### TranslationArtifact
A durable derived text file + its provenance companion.

| Field | Type | Notes |
|-------|------|-------|
| `kind` | `'corrected-french' \| 'english'` | Which pass produced it. |
| `scope` | `'page' \| 'issue'` | Per-page intermediate vs assembled whole-issue. |
| `path` | string | Absolute path inside the issue dir (see research R5). |
| `text` | string | The content. |
| `provenance` | `ProvenanceFields` | The `.yml` companion (YAML). |

**Whole-issue assembly**: `issue.fr.txt` = per-page `correctedFrench` joined in page order; `issue.en.txt` = per-page `english` joined in page order. An issue with any non-`translated` page is reported **incomplete** and its whole-issue artifacts reflect only completed pages (spec Edge Case).

### Provenance additions (translation-specific)
The machine-assisted labeling required by FR-006/FR-007/AGENTS.md. Decision deferred to tasks between:
- **(a)** structured line(s) in the existing `notes` field, or
- **(b)** additive **optional** keys on `ProvenanceFields`: `engine?: string` (`"claude-code-cli"`), `model?: string`, `translation?: string` (`"machine-assisted"`).

Leaning (b) (first-class, queryable, additive so existing fetcher records stay valid). Either way these values MUST appear in every translation artifact's `.yml`:

| Provenance value | Source |
|------------------|--------|
| engine = `claude-code-cli` | constant |
| model | the `--model` resolved for the run |
| date (`retrieved`) | injected clock, ISO |
| translation = `machine-assisted` | constant (FR-007) |
| original-language citation | from the source page provenance: `title`, `catalog_url`, `language` |
| `rights_status` | copied from the source page provenance (must be `public-domain`) |
| `type` | `corrected-french-text` / `english-translation` |
| `format` | `text/plain` |

### TranslateRunReport
Per-run outcome surface (FR-015).

| Field | Type | Notes |
|-------|------|-------|
| `issues` | array of `{ ark, outcome, pagesDone, pagesTotal, message? }` | outcome ∈ `translated \| skipped \| refused \| failed \| incomplete`. |
| `abortedOnConsecutiveFailures` | boolean | true when the FR-017 threshold (N=3) tripped. |

## Validation rules

- **Rights**: refuse unless the source page provenance `rights_status === 'public-domain'` (FR-008); write nothing on refusal.
- **Input**: missing/empty `issue.txt` → fail loud for that issue (FR-002); an empty page chunk is reported, never fabricated.
- **Write-guard**: every artifact + companion path passes `assertInsideArchive` before any write (reused, non-overridable).
- **Idempotency**: a page whose intermediate is present + checksum-recorded is skipped unless `--force` (reuses `isAssetRecorded`); an issue whose whole-issue artifacts are present is skipped unless `--force` (FR-011).
