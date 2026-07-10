/**
 * T020 -- builds one {@link SearchDocument} per page across the whole
 * {@link CorpusView} for the client-side Pagefind index (search-document
 * contract; data-model.md SearchDocument; FR-008..FR-010, OQ-5).
 *
 * Pure function over the in-memory `CorpusView`: no I/O, no fallbacks. Order
 * is deterministic -- source order, then issue order, then page order, all as
 * already ordered on the `CorpusView` (search-document contract G-2).
 */
import type { CorpusView, PageView, SearchDocument } from '@/browser/model';

/**
 * The page reading-view route (must match the `getStaticPaths` route built in
 * `site/src/pages/sources/[sourceId]/issues/[issueId]/pages/[pageId].astro`):
 * trailing-slash directory form.
 */
function pageRouteUrl(sourceId: string, issueId: string, pageId: string): string {
  return `/sources/${sourceId}/issues/${issueId}/pages/${pageId}/`;
}

/**
 * The indexed French text for a page: raw OCR plus corrected French when
 * present, both concatenated so either layer is searchable (search-document
 * contract B-3). `correctedFrench` is `null` when the corrected layer is
 * absent -- omitted rather than stringified, so the index never contains the
 * literal text "null".
 */
function pageFrenchText(page: PageView): string {
  return page.correctedFrench === null
    ? page.ocrFrench
    : `${page.ocrFrench}\n${page.correctedFrench}`;
}

function buildPageDocument(sourceId: string, issueId: string, page: PageView): SearchDocument {
  return {
    pageId: page.pageId,
    issueId,
    sourceId,
    routeUrl: pageRouteUrl(sourceId, issueId, page.pageId),
    french: pageFrenchText(page),
    english: page.english,
  };
}

/**
 * One `SearchDocument` per page across every source and issue in `corpus`,
 * in corpus order (search-document contract G-2: deterministic from the same
 * `CorpusView`).
 */
export function buildSearchDocuments(corpus: CorpusView): SearchDocument[] {
  return corpus.sources.flatMap((source) =>
    source.issues.flatMap((issue) =>
      issue.pages.map((page) => buildPageDocument(source.sourceId, issue.issueId, page))
    )
  );
}
