# Contract: Site Routes

Astro static routes generated from `CorpusView`. Every route is deep-linkable and reproducible (FR-004, SC-002). UI for each is implemented via `/frontend-design:frontend-design` (Principle I).

## Routes

| Route | Page file | Renders |
|-------|-----------|---------|
| `/` | `site/src/pages/index.astro` | Corpus landing — list of sources (v1: PB-P001). |
| `/sources/[sourceId]/` | `sources/[sourceId]/index.astro` | Source overview — its issues, ordered by date. |
| `/sources/[sourceId]/issues/[issueId]/pages/[pageId]/` | `…/pages/[pageId].astro` | **Reading view** (layout ①): deep-zoom scan + page-aligned FR OCR / EN translation + provenance rail + within-issue page nav. |

## Behavior

- **B-1**: Each `PageView` produces exactly one page route; `getStaticPaths` enumerates them from `CorpusView`.
- **B-2**: The reading view mounts the **OpenSeadragon** island for `PageView.image` and shows `ocrFrench` (+ `correctedFrench` when present) and `english` side-by-side (stacked apparatus per the mockup).
- **B-3**: Within-issue nav exposes previous/next page routes (k−1 / k+1) and a link up to the issue + source (FR-006).
- **B-4**: The provenance rail renders `PageView.provenance` (sourceId, ark, date, rights, page, sha256) in the monospace apparatus voice (FR-014).
- **B-5**: A noisy page (`ocrCondition` set) visibly frames the OCR as degraded; the scan stays authoritative (FR-007).
- **B-6**: All routes are static HTML — no application server at runtime (SC-003).

## Guarantees

- **G-1**: Copying any route URL reproduces the same view (deep-linkable; SC-002).
- **G-2**: Route generation throws (build fails) if any `PageView` it would emit is incomplete — no route is emitted for a page with missing data (ties to corpus-loader G-2..G-4).
