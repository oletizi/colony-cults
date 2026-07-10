# Contract: Corpus Loader

Reads the local archive clone + bibliography SSOT and returns the normalized `CorpusView` (see data-model.md). Pure, fail-loud, no browser dependency.

## Entry point (`src/browser/load/corpus.ts`)

```ts
export interface LoadConfig {
  archivePath: string;              // local archive clone root (config, not a secret)
  sources: string[];               // source ids to include, e.g. ['PB-P001']
  provider: ImageProviderConfig;   // active image-source provider
}

// Throws on any missing/inconsistent corpus data. Never returns partial/placeholder data.
export function loadCorpus(config: LoadConfig): CorpusView;
```

## Steps

1. Load each source's SSOT via `@/bibliography` → `SourceView` scaffold (id, title, kind, ark, rights).
2. Enumerate the source's issue directories → `IssueView` (issueId, date, sequence).
3. For each issue: read `issue.txt`, split on `\f` → per-page raw OCR (`src/browser/load/ocr-pages.ts`).
4. Pair each page with `translation/pNNN.fr.txt` / `pNNN.en.txt` + the `.yml` provenance sidecar (`src/browser/load/translation.ts`).
5. Resolve each page image through the active provider → `ImageDescriptor`.
6. Assemble `ProvenanceRecord` per page from sidecar + SSOT.

## Guarantees (testable — vitest)

- **G-1 (page-count coherence)**: for every issue, `imageCount === ocrSegmentCount === translationPairCount`; a mismatch **throws** naming source + issue (edge case).
- **G-2 (required layers)**: a page missing `english` or raw OCR **throws** naming source/issue/page (FR-002).
- **G-3 (provenance completeness)**: a page whose sidecar lacks any provenance field (sha256/ark/rights/date/page) **throws** (SC-004).
- **G-4 (no fallback)**: no code path substitutes a placeholder image, empty text, or default provenance for missing data (SC-006).
- **G-5 (no credentials)**: `loadCorpus` reads only the local clone + public handles; it requires no credentials/secrets (FR-018).
- **G-6 (determinism)**: given the same archive clone + config, `loadCorpus` returns the same `CorpusView` (stable ids/order) — so routes and the search index are reproducible.

## Fixture

`tests/integration/browser/` normalizes a real PB-P001 issue (`1879-08-15_bpt6k56068358`: 8 pages) end-to-end and asserts G-1..G-4 on both the happy path and a deliberately-corrupted copy (removed translation, dropped provenance field, page-count skew).
