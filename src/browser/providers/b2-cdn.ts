/**
 * The `b2-cdn` `ImageSourceProvider`: builds full-image descriptors from the
 * archive's `object_store` key, fronted by a CDN base url (see
 * specs/005-corpus-browser/contracts/image-provider.md). This is the
 * provider used when the browser reads page images from a mirrored
 * Backblaze B2 bucket via CDN rather than straight from the source
 * (`source-iiif`, `src/browser/providers/source-iiif.ts`).
 *
 * Emits an UN-tiled `full-image` descriptor: the descriptor url is
 * `<cdnBase>/<objectStoreKey>` -- the CDN fronts the B2 bucket, so the
 * object-store key IS the request path. OpenSeadragon loads this as a
 * plain single image and drives client-side zoom/pan itself (no
 * `info.json`, unlike `source-iiif`'s tiled IIIF descriptor).
 *
 * DEPLOY NOTE (not a code concern here): the reading viewer sets
 * `crossOriginPolicy: 'Anonymous'` on the OSD viewer (see
 * `site/src/islands/viewer.ts`) so cross-origin tiles don't taint the
 * canvas. Rendering a b2-cdn image therefore requires the CDN/B2 bucket to
 * send `Access-Control-Allow-Origin` on the image response -- that is a CDN
 * configuration matter for whoever deploys the CDN, not something this
 * provider (a build-time URL builder) can affect.
 */

import type { ImageDescriptor } from '@/browser/model';
import type { ImageSourceProvider, PageInput } from '@/browser/providers/provider';

/**
 * Constructs the `b2-cdn` {@link ImageSourceProvider}.
 *
 * @param cdnBase the CDN base url fronting the B2 bucket (e.g.
 *   `https://cdn.example/pb`). Callers (see `makeProvider` in
 *   `src/browser/providers/provider.ts`) already guarantee this is
 *   non-empty before constructing this provider (image-provider contract
 *   G-1) -- this function does not re-validate it.
 */
export function makeB2CdnProvider(cdnBase: string): ImageSourceProvider {
  const base = cdnBase.replace(/\/+$/, '');
  return {
    kind: 'b2-cdn',
    resolve(page: PageInput): ImageDescriptor {
      return resolveB2CdnImage(base, page);
    },
  };
}

/**
 * Builds the full-image {@link ImageDescriptor} for `page` from its archive
 * `object_store` key.
 *
 * @throws Error if `page.objectStoreKey` is `null` or empty -- naming the
 *   folio (image-provider contract G-2). There is no placeholder or
 *   default url substituted for a missing key (G-4).
 */
function resolveB2CdnImage(base: string, page: PageInput): ImageDescriptor {
  const key = page.objectStoreKey?.trim();
  if (!key) {
    throw new Error(
      `b2-cdn provider: page ${JSON.stringify(page.folioId)} has no object_store key -- ` +
        'cannot build a CDN image url without the archive object-store key ' +
        '(image-provider contract G-2).'
    );
  }

  return {
    kind: 'full-image',
    url: `${base}/${key}`,
  };
}
