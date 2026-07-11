/**
 * The `b2-cdn` `ImageByteSource`: fetches print-resolution page-image bytes
 * from the archive's mirrored Backblaze B2 bucket (see
 * specs/007-corpus-print-pdf/contracts/image-fetch.md). This is the PRIMARY
 * source for the PDF build -- its bytes ARE the archived master, so this is
 * the only `ImageByteSource` that sha256-verifies against
 * `ImageRequest.sha256` (see `./fetch.ts`'s module doc for why the IIIF
 * alternate does not).
 *
 * The B2 bucket is PUBLIC, so the fetch is a plain, unauthenticated HTTP GET
 * against `<cdnBase>/<objectStoreKey>` -- NO credentials, NO S3 request
 * signing (unlike `@/archive/s3-object-store`'s `S3ObjectStore`, which signs
 * requests for the archive-writer's private bucket access). The URL shape
 * mirrors `@/browser/providers/b2-cdn`'s `resolveB2CdnImage` (same
 * `<cdnBase>/<objectStoreKey>` pattern, same trailing-slash trim), applied
 * here to fetch bytes at build time instead of building a browser-facing
 * descriptor url.
 */

import { sha256OfBytes } from '@/archive/checksum';
import {
  assertMasterSha256Match,
  readResponseBytes,
  writeFetchedBytes,
  type FetchFn,
  type FetchedImage,
  type ImageByteSource,
  type ImageRequest,
} from '@/pdf/images/fetch';

/**
 * Constructs the `b2-cdn` {@link ImageByteSource}.
 *
 * @param cdnBase the CDN base url fronting the public B2 bucket (e.g.
 *   `https://cdn.example/pb`). Sourced from config by the caller -- never
 *   hardcoded here.
 * @param fetchFn the HTTP GET to use (injected so unit tests supply an
 *   in-memory fake -- image-fetch contract G-5). Production callers pass the
 *   global `fetch`.
 */
export function makeB2ImageSource(cdnBase: string, fetchFn: FetchFn): ImageByteSource {
  const base = cdnBase.replace(/\/+$/, '');
  return {
    kind: 'b2-cdn',
    fetch(page: ImageRequest): Promise<FetchedImage> {
      return fetchB2Image(base, fetchFn, page);
    },
  };
}

/**
 * Fetches, sha256-verifies (against the B2 master checksum), and writes to
 * disk the print-resolution bytes for `page`.
 *
 * @throws Error if `page.objectStoreKey` is `null`/empty -- naming the folio
 *   (image-fetch contract G-2). No placeholder or default url is substituted
 *   for a missing key.
 * @throws Error if the HTTP GET does not return `ok` -- naming the folio and
 *   the CDN url.
 * @throws Error if the fetched bytes' sha256 does not equal
 *   `page.sha256` -- naming the folio and BOTH hashes (G-1).
 */
async function fetchB2Image(
  base: string,
  fetchFn: FetchFn,
  page: ImageRequest,
): Promise<FetchedImage> {
  const key = page.objectStoreKey?.trim();
  if (!key) {
    throw new Error(
      `b2-cdn image source: page ${JSON.stringify(page.folioId)} has no object_store key -- ` +
        'cannot fetch a print-resolution master without the archive object-store key ' +
        '(image-fetch contract G-2).',
    );
  }

  const url = `${base}/${key}`;
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(
      `b2-cdn image source: fetching folio ${JSON.stringify(page.folioId)} from ${url} failed ` +
        `with status ${response.status}.`,
    );
  }

  const bytes = await readResponseBytes(response);
  const actualSha256 = sha256OfBytes(bytes);
  assertMasterSha256Match(page.folioId, page.sha256, actualSha256);

  const bytesPath = await writeFetchedBytes('b2-cdn', page.folioId, bytes);

  return {
    bytesPath,
    sha256: actualSha256,
    width: null,
    height: null,
    provider: 'b2-cdn',
  };
}
