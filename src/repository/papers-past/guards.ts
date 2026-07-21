/**
 * Origin + segment-coverage guards for the {@link PapersPastAdapter}
 * (specs/015-papers-past-acquisition, audit-log AUDIT-04 / AUDIT-05). Extracted
 * from `adapter.ts` to keep that file focused (and under the module size limit).
 *
 * These are fail-loud invariants, never fallbacks:
 * - {@link assertPapersPastArticleUrl} refuses any article-page URL that is not
 *   an `https` Papers Past `/newspapers/` URL, so a malformed/compromised
 *   `record.sourceUrl` cannot make the adapter navigate/persist/parse an
 *   off-origin page under a legitimate identifier.
 * - {@link assertPapersPastImageUrl} refuses any resolved image locator that is
 *   not on the Papers Past origin, so the adapter never byte-fetches (and
 *   mirrors) arbitrary same-shaped GIFs from another host.
 * - {@link assertAllRecordedSegmentsCovered} refuses to commit when a sequence
 *   the record PINS is no longer present in the freshly-verified set (silent
 *   partial loss), the drop-direction complement of the remote-change checksum
 *   guard.
 */

import type { AcquiredAsset } from '@/model/acquired-asset';

/** The sole permitted Papers Past origin (scheme + host). */
export const PAPERS_PAST_ORIGIN = 'https://paperspast.natlib.govt.nz';
/** The sole permitted Papers Past host. */
const PAPERS_PAST_HOST = 'paperspast.natlib.govt.nz';

/**
 * Normalize `pageUrl` through `new URL` and REQUIRE scheme `https:`, host
 * `paperspast.natlib.govt.nz`, and a `/newspapers/` path; returns the normalized
 * URL string. Throws (fail-loud) on anything else -- an off-origin, http, or
 * non-`/newspapers/` value never reaches navigate/persist/parse.
 */
export function assertPapersPastArticleUrl(pageUrl: string): string {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    throw new Error(
      `PapersPastAdapter: article URL "${pageUrl}" is not a valid absolute URL ` +
        '(origin guard, fail-loud).',
    );
  }
  if (
    url.protocol !== 'https:' ||
    url.host !== PAPERS_PAST_HOST ||
    !url.pathname.includes('/newspapers/')
  ) {
    throw new Error(
      `PapersPastAdapter: article URL "${pageUrl}" is not a Papers Past newspapers URL ` +
        `(require https://${PAPERS_PAST_HOST}/newspapers/...) -- refusing to navigate an ` +
        'off-origin page under a Papers Past identifier (origin guard, fail-loud).',
    );
  }
  return url.toString();
}

/**
 * REQUIRE a resolved image locator to be on the Papers Past origin (scheme
 * `https:`, host `paperspast.natlib.govt.nz`) BEFORE any byte fetch. Throws
 * (fail-loud) otherwise, so the adapter never mirrors bytes from another host.
 */
export function assertPapersPastImageUrl(imageUrl: string): void {
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    throw new Error(
      `PapersPastAdapter: image locator "${imageUrl}" is not a valid absolute URL ` +
        '(origin guard, fail-loud).',
    );
  }
  if (url.protocol !== 'https:' || url.host !== PAPERS_PAST_HOST) {
    throw new Error(
      `PapersPastAdapter: image locator "${imageUrl}" is not on the Papers Past origin ` +
        `(${PAPERS_PAST_ORIGIN}) -- refusing to fetch/mirror off-origin bytes ` +
        '(origin guard, fail-loud).',
    );
  }
}

/**
 * Assert that every `page-master` asset the record PINS (with a set `sequence`)
 * is present in `verifiedSequences` -- the freshly-verified segment set. A
 * recorded sequence the fresh parse no longer yields is silent partial loss; it
 * throws the same remote-change fail-loud class as the checksum-drift guard.
 */
export function assertAllRecordedSegmentsCovered(
  recordedAssets: readonly AcquiredAsset[],
  verifiedSequences: ReadonlySet<number>,
): void {
  for (const asset of recordedAssets) {
    if (asset.role !== 'page-master' || asset.sequence === undefined) {
      continue;
    }
    if (!verifiedSequences.has(asset.sequence)) {
      throw new Error(
        `PapersPastAdapter.acquire: the record pins a page-master for sequence ` +
          `${asset.sequence}, but the fresh parse no longer yields it -- the remote ` +
          'facsimile set shrank; refusing to archive a strictly-smaller copy as complete ' +
          '(remote-change fail-loud).',
      );
    }
  }
}
