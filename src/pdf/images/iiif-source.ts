/**
 * The `source-iiif` `ImageByteSource`: fetches print-resolution page-image
 * bytes directly from Gallica's IIIF Image API as the ALTERNATE to the B2
 * master (see specs/007-corpus-print-pdf/contracts/image-fetch.md). Mirrors
 * `@/browser/providers/source-iiif`'s ark/folio url-building (same
 * `<ark>/<folio>` shape, same un-padded-folio normalization), but requests
 * the IIIF **full-size raster** (`full/max/0/default.jpg`) instead of the
 * browser's tiled `info.json` descriptor -- there is no client-side
 * zoom/pan here, just one full image to embed.
 *
 * VERIFICATION ASYMMETRY (see `./fetch.ts`'s module doc for the full
 * explanation): this source deliberately does NOT sha256-verify its bytes
 * against `ImageRequest.sha256`. That checksum is the B2 MASTER's checksum;
 * this source fetches a different Gallica-rendered derivative that has no
 * reason to hash-match it. Instead it reports `provider: 'source-iiif'` on
 * the returned `FetchedImage` so the colophon can note the image did not
 * come from the sha256-verified master.
 */

import {
  readResponseBytes,
  writeFetchedBytes,
  type FetchFn,
  type FetchedImage,
  type ImageByteSource,
  type ImageRequest,
} from '@/pdf/images/fetch';
import { sha256OfBytes } from '@/archive/checksum';

const GALLICA_IIIF_BASE = 'https://gallica.bnf.fr/iiif';

/**
 * Constructs the `source-iiif` {@link ImageByteSource}.
 *
 * @param fetchFn the HTTP GET to use (injected so unit tests supply a stub
 *   -- image-fetch contract G-5). Production callers pass the global
 *   `fetch`.
 */
export function makeIiifImageSource(fetchFn: FetchFn): ImageByteSource {
  return {
    kind: 'source-iiif',
    fetch(page: ImageRequest): Promise<FetchedImage> {
      return fetchIiifImage(fetchFn, page);
    },
  };
}

/**
 * Fetches and writes to disk the IIIF full-size raster for `page`. Does NOT
 * compare the fetched bytes' sha256 against `page.sha256` (see the module
 * doc's verification-asymmetry note) -- the returned `FetchedImage.sha256`
 * is simply the checksum of the bytes actually received.
 *
 * @throws Error if `page.ark` is `null`/empty -- naming the folio
 *   (image-fetch contract G-3). No placeholder or default url is
 *   substituted for a missing ark.
 * @throws Error if `page.folioId` is not the expected `f<digits>` shape --
 *   fail loud rather than emit a malformed IIIF url.
 * @throws Error if the HTTP GET does not return `ok` -- naming the folio
 *   and the IIIF url.
 */
async function fetchIiifImage(fetchFn: FetchFn, page: ImageRequest): Promise<FetchedImage> {
  const ark = page.ark?.trim();
  if (!ark) {
    throw new Error(
      `source-iiif image source: page ${JSON.stringify(page.folioId)} has no ark -- ` +
        'cannot fetch an IIIF full-size raster without the source archival identifier ' +
        '(image-fetch contract G-3).',
    );
  }

  const folio = gallicaFolio(page.folioId);
  const url = `${GALLICA_IIIF_BASE}/${ark}/${folio}/full/max/0/default.jpg`;

  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(
      `source-iiif image source: fetching folio ${JSON.stringify(page.folioId)} from ${url} ` +
        `failed with status ${response.status}.`,
    );
  }

  const bytes = await readResponseBytes(response);
  const bytesPath = await writeFetchedBytes('source-iiif', page.folioId, bytes);

  return {
    bytesPath,
    // Deliberately the IIIF derivative's own checksum, NOT compared against
    // page.sha256 (the B2 master's checksum) -- see the module doc.
    sha256: sha256OfBytes(bytes),
    width: null,
    height: null,
    provider: 'source-iiif',
  };
}

/**
 * Normalizes an archive folio id (zero-padded, e.g. `f001`) to the UN-padded
 * form Gallica's IIIF service uses (`f1`). Mirrors
 * `@/browser/providers/source-iiif`'s `gallicaFolio` (TASK-10) -- duplicated
 * here rather than imported because that module's helper is private to the
 * browser's descriptor-building concern.
 *
 * @throws Error if `folioId` is not the expected `f<digits>` shape.
 */
function gallicaFolio(folioId: string): string {
  const match = /^f(\d+)$/.exec(folioId);
  if (!match) {
    throw new Error(
      `source-iiif image source: unexpected folioId ${JSON.stringify(folioId)} -- ` +
        'expected the form "f<digits>" (e.g. "f001") to map to a Gallica IIIF folio.',
    );
  }
  return `f${Number(match[1])}`;
}
