# Contract: Search

Client-side, per-page search over both languages via Pagefind (FR-008..FR-010, OQ-5). No server.

## Index granularity

- **One indexed unit per page** (`SearchDocument`, see data-model.md): `french` (raw OCR + corrected French when present) and `english`, tagged with `sourceId`/`issueId`/`pageId` and the page `routeUrl`.
- Pagefind builds its index at build time from the emitted reading-view HTML; the per-page reading view therefore carries both language texts in indexable markup.

## Behavior

- **B-1**: A query for a term present in the corpus returns results **client-side** (no server round-trip) (FR-008, SC-003).
- **B-2**: Selecting a result navigates to that page's reading view via `routeUrl` (FR-009).
- **B-3**: A term present only in the English translation, or only in the French text, is found — both layers are indexed (FR-010).
- **B-4**: Result granularity is the page (not the issue) — the reader lands on the exact page (OQ-5).

## Guarantees

- **G-1**: The deployed site performs search with no application server (static Pagefind index + client JS).
- **G-2**: The index is reproducible from the same `CorpusView` (deterministic search docs — corpus-loader G-6).
- **G-3**: Every result's `routeUrl` resolves to an existing page route (no dangling results).
