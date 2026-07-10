# Quickstart: Corpus Browser (validation guide)

Runnable scenarios that prove the feature works end-to-end. Implementation details live in `tasks.md`; this is a run/validation guide.

## Prerequisites

- Node 20, this repo's deps installed (`npm install`), plus the new deps (Astro, OpenSeadragon, Pagefind) once added.
- A **local archive clone** with PB-P001 content (default `../colony-cults-archive`). No credentials — the corpus is public-domain.

## Configuration

Set the archive path and image provider by flag/env (no secrets):

```bash
export CORPUS_ARCHIVE_PATH=../colony-cults-archive
export CORPUS_IMAGE_PROVIDER=source-iiif        # or: b2-cdn (requires CORPUS_CDN_BASE)
# export CORPUS_CDN_BASE=https://cdn.example/…   # only for b2-cdn
```

## Scenario 1 — Data layer normalizes PB-P001 (fail-loud) [US1, FR-001/002]

```bash
npm run test -- browser        # vitest: unit + integration for src/browser/
```

Expected: page-splitting, translation pairing, provider URL construction, and search-doc tests pass; the integration test normalizes issue `1879-08-15_bpt6k56068358` (8 pages) and the corrupted-copy cases (removed translation / dropped provenance field / page-count skew) all **throw** with a message naming source/issue/page.

## Scenario 2 — Build the site & read a page [US1, US2]

```bash
cd site && npm run build        # Astro static build → site/dist/
npm run preview                 # serve site/dist/ locally
```

Expected: opening `/sources/PB-P001/issues/1879-08-15_bpt6k56068358/pages/p001/` shows the scan in the deep-zoom viewer with the page's French OCR and English translation alongside, a populated provenance rail, and previous/next page navigation. No application server is needed to serve `dist/`.

## Scenario 3 — Search [US3, SC-003]

```bash
# Pagefind runs as part of the build; then in the previewed site:
# search a term known to appear in PB-P001 (e.g. "Port-Breton")
```

Expected: results appear client-side and link to the containing **page** reading view; a term present only in English (or only in French) is found.

## Scenario 4 — Provider swap [US5, SC-005]

```bash
CORPUS_IMAGE_PROVIDER=b2-cdn CORPUS_CDN_BASE=https://cdn.example/pb npm --prefix site run build
```

Expected: the same page renders with image URLs from the object-store+CDN provider; the viewer/reading view are unchanged. Building `b2-cdn` **without** `CORPUS_CDN_BASE` fails loud (no fallback).

## Scenario 5 — Fail-loud on missing data [SC-006]

Remove a required field (e.g. delete a page's `translation/pNNN.en.txt` in a scratch copy of the clone) and rebuild.

Expected: the build **fails** with a message naming the offending source/issue/page — no placeholder, no silent skip.

## Scenario 6 — CSP-safe assets [SC-007]

Inspect the built page's network requests.

Expected: the display typeface loads from an inlined data-URI `@font-face`; there are no requests to external font/asset hosts.

## Notes

- **UX/UI**: any change to the reading view, navigation, search UI, provenance rail, or visual identity is made via `/frontend-design:frontend-design` (Constitution Principle I) — not hand-edited ad hoc.
- **Deferred**: public export (OQ-4), object-store tiling vs full-image (OQ-6), and non-periodical data shapes (OQ-7) are out of v1's validated path.
