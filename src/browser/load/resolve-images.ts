/**
 * The shared image-resolution step. Takes a serializable {@link CorpusSnapshot}
 * (raw text + metadata + image handles, from either the archive read
 * `readRawCorpus` OR the committed snapshot read `readSnapshotCorpus`) and
 * resolves every page's image through the active {@link ImageProviderConfig},
 * producing the rendered {@link LoadResult} the Astro site consumes.
 *
 * This is the single convergence point: the archive path and the snapshot path
 * both funnel their raw form through here, so images ALWAYS re-resolve from the
 * carried handles (`folioId`, `ark`, `objectStoreKey`) -- swapping the provider
 * (e.g. `source-iiif` -> `b2-cdn`) re-derives every URL with no archive needed.
 */

import type {
  CorpusSnapshot,
  ImageDescriptor,
  ImageProviderConfig,
  IssueView,
  LoadResult,
  PageView,
  RawIssue,
  RawPage,
  RawSource,
  SourceView,
} from '@/browser/model';
import { makeProvider } from '@/browser/providers/provider';
import type { ImageSourceProvider } from '@/browser/providers/provider';

/**
 * Resolves every page image in `raw` through the provider selected by
 * `providerConfig`, returning the rendered corpus + the carried skip report.
 *
 * @throws Error (via the provider) when a page's required image handle for the
 *   selected provider is missing -- no placeholder is substituted (G-4).
 */
export function resolveImages(
  raw: CorpusSnapshot,
  providerConfig: ImageProviderConfig
): LoadResult {
  const provider = makeProvider(providerConfig);

  const sources: SourceView[] = raw.sources.map((source) => resolveSource(source, provider));

  return { corpus: { sources }, skipped: raw.skipped };
}

function resolveSource(source: RawSource, provider: ImageSourceProvider): SourceView {
  return {
    sourceId: source.sourceId,
    title: source.title,
    kind: source.kind,
    language: source.language,
    ark: source.ark,
    rights: source.rights,
    issues: source.issues.map((issue) => resolveIssue(issue, provider)),
  };
}

function resolveIssue(issue: RawIssue, provider: ImageSourceProvider): IssueView {
  const pages = issue.pages.map((page) => resolvePage(page, provider));
  return {
    issueId: issue.issueId,
    date: issue.date,
    sequence: issue.sequence,
    pages,
    pageCount: pages.length,
  };
}

function resolvePage(page: RawPage, provider: ImageSourceProvider): PageView {
  // A CLIPPING carries multiple image strips: resolve EACH, expose the full set
  // as `strips`, and use the FIRST as the primary/search `image`. A normal
  // single-image page has no strips (`strips: null`) and resolves its one handle.
  let image: ImageDescriptor;
  let strips: ImageDescriptor[] | null;
  if (page.strips !== undefined && page.strips !== null) {
    const resolved = page.strips.map((strip) =>
      provider.resolve({
        ark: page.ark,
        folioId: strip.folioId,
        objectStoreKey: strip.objectStoreKey,
      })
    );
    if (resolved.length === 0) {
      throw new Error(
        `resolveImages(${page.pageId}): page carries an empty "strips" array -- a clipping ` +
          'must have at least one image strip.'
      );
    }
    strips = resolved;
    image = resolved[0];
  } else {
    image = provider.resolve({
      ark: page.ark,
      folioId: page.folioId,
      objectStoreKey: page.objectStoreKey,
    });
    strips = null;
  }

  return {
    pageId: page.pageId,
    folioId: page.folioId,
    image,
    strips,
    ocrFrench: page.ocrFrench,
    correctedFrench: page.correctedFrench,
    english: page.english,
    provenance: page.provenance,
    ocrCondition: page.ocrCondition,
  };
}
