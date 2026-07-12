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
 * READING WIDTH: when constructed with an `imageWidth`, the descriptor url
 * carries `?w=<n>` so the CDN Worker resizes the master down to that width
 * (cf.image, scale-down) -- a ~reading-size image (hundreds of KiB) instead
 * of the full ~2 MiB master, cutting first-paint bandwidth. `scale-down`
 * never upscales, so images already narrower than `w` are served untouched.
 * Omit `imageWidth` (0 / unset) to serve the full master unchanged.
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
 * @param imageWidth optional reading width (px). When a positive number, the
 *   descriptor url gets `?w=<imageWidth>` so the CDN resizes the master;
 *   omitted / non-positive => the full master url with no query param.
 */
export function makeB2CdnProvider(cdnBase: string, imageWidth?: number): ImageSourceProvider {
  const base = cdnBase.replace(/\/+$/, '');
  const width = typeof imageWidth === 'number' && imageWidth > 0 ? imageWidth : undefined;
  return {
    kind: 'b2-cdn',
    resolve(page: PageInput): ImageDescriptor {
      return resolveB2CdnImage(base, page, width);
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
function resolveB2CdnImage(base: string, page: PageInput, width?: number): ImageDescriptor {
  const key = page.objectStoreKey?.trim();
  if (!key) {
    throw new Error(
      `b2-cdn provider: page ${JSON.stringify(page.folioId)} has no object_store key -- ` +
        'cannot build a CDN image url without the archive object-store key ' +
        '(image-provider contract G-2).'
    );
  }

  const query = width ? `?w=${width}` : '';
  return {
    kind: 'full-image',
    url: `${base}/${key}${query}`,
  };
}
