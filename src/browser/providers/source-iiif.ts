/**
 * The `source-iiif` `ImageSourceProvider`: builds IIIF descriptors directly
 * from the source's Gallica ark (see
 * specs/005-corpus-browser/contracts/image-provider.md). This is the
 * provider used when the browser reads page images straight from Gallica
 * rather than a mirrored CDN (`b2-cdn`, T027).
 *
 * Gallica IIIF page image URL: `https://gallica.bnf.fr/iiif/ark:/12148/<id>/
 * f<N>/full/full/0/native.jpg` (the exact form the corpus sidecars record in
 * `original_url`). We emit that full-image url as a `full-image` descriptor
 * (a simple single image the viewer loads with client-side zoom), NOT a tiled
 * `iiif` descriptor: OSD's tiled path fetches `info.json` cross-origin, which
 * requires CORS that Gallica does not reliably send to a browser, blanking the
 * viewer (TASK-11). A plain cross-origin image needs no CORS to display, so
 * this renders reliably. (True IIIF tiling is a deferred enhancement.)
 */

import type { ImageDescriptor } from '@/browser/model';
import type { ImageSourceProvider, PageInput } from '@/browser/providers/provider';

const GALLICA_IIIF_BASE = 'https://gallica.bnf.fr/iiif';

/**
 * Constructs the `source-iiif` {@link ImageSourceProvider}.
 */
export function makeSourceIiifProvider(): ImageSourceProvider {
  return {
    kind: 'source-iiif',
    resolve(page: PageInput): ImageDescriptor {
      return resolveSourceIiifImage(page);
    },
  };
}

/**
 * Builds the IIIF {@link ImageDescriptor} for `page` from its source `ark`
 * and `folioId`.
 *
 * @throws Error if `page.ark` is `null` or empty -- naming the folio
 *   (image-provider contract G-2). There is no placeholder or default url
 *   substituted for a missing ark (G-4).
 * @throws Error if `page.folioId` is empty -- the descriptor url would
 *   otherwise be malformed.
 */
function resolveSourceIiifImage(page: PageInput): ImageDescriptor {
  const ark = page.ark?.trim();
  if (!ark) {
    throw new Error(
      `source-iiif provider: page ${JSON.stringify(page.folioId)} has no ark -- ` +
        'cannot build an IIIF image url without the source archival identifier ' +
        '(image-provider contract G-2).'
    );
  }

  const folioId = page.folioId.trim();
  if (folioId.length === 0) {
    throw new Error(
      `source-iiif provider: page with ark ${JSON.stringify(ark)} has an empty folioId -- ` +
        'cannot build an IIIF image url without the page view id.'
    );
  }

  return {
    kind: 'full-image',
    url: `${GALLICA_IIIF_BASE}/${ark}/${gallicaFolio(folioId)}/full/full/0/native.jpg`,
  };
}

/**
 * Normalizes an archive folio id (zero-padded, e.g. `f001`) to the UN-padded
 * form Gallica's IIIF service uses (`f1`). Archive page images are named
 * `fNNN.jpg`, but Gallica addresses folios as `f1`, `f2`, ... `f10`, so a
 * verbatim `f001` yields a 404/403 and a blank viewer (TASK-10). The page
 * sidecar's own `original_url` confirms the `.../f1/...` form.
 *
 * @throws Error if `folioId` is not the expected `f<digits>` shape -- fail
 *   loud rather than emit a malformed IIIF url.
 */
function gallicaFolio(folioId: string): string {
  const match = /^f(\d+)$/.exec(folioId);
  if (!match) {
    throw new Error(
      `source-iiif provider: unexpected folioId ${JSON.stringify(folioId)} -- ` +
        'expected the form "f<digits>" (e.g. "f001") to map to a Gallica IIIF folio.'
    );
  }
  return `f${Number(match[1])}`;
}
