/**
 * The single interface every page image URL is built through
 * (specs/005-corpus-browser/contracts/image-provider.md). Two
 * implementations are selected by config (dependency injection, no
 * inheritance): `source-iiif` (`@/browser/providers/source-iiif`) and
 * `b2-cdn` (T027). The reading view consumes only the resolved
 * `ImageDescriptor` -- it never knows which provider produced it
 * (image-provider contract G-3).
 */

import type { ImageDescriptor, ImageProviderConfig } from '@/browser/model';
import { makeSourceIiifProvider } from '@/browser/providers/source-iiif';

/**
 * What both providers may need to resolve one page's image. Carries the
 * source `ark` (for `source-iiif`), the page `folioId` (`fNNN`), and the
 * archive `object_store` key for the page image (for `b2-cdn`).
 */
export interface PageInput {
  /** The source's archival identifier, or `null` when unavailable. */
  ark: string | null;
  /** The image/view id (`f001`). */
  folioId: string;
  /** The archive `object_store` key for this page's image, or `null` when unavailable. */
  objectStoreKey: string | null;
}

/**
 * Resolves the viewer-ready {@link ImageDescriptor} for one page. Throws
 * (never returns a placeholder) when the page's handle or the provider
 * config is missing (image-provider contract G-2, G-4).
 */
export interface ImageSourceProvider {
  readonly kind: 'source-iiif' | 'b2-cdn';
  resolve(page: PageInput): ImageDescriptor;
}

/**
 * Selects the {@link ImageSourceProvider} implementation for `config`.
 *
 * Throws on missing required config -- there is no fallback between
 * providers (FR-013; image-provider contract G-1). The `b2-cdn`
 * implementation itself lands in T027; this factory already enforces its
 * required-config guarantee (a missing/empty `cdnBase` throws) ahead of
 * that work.
 *
 * @throws Error if `config.kind` is `'b2-cdn'` and `cdnBase` is missing or
 *   empty.
 * @throws Error if `config.kind` is `'b2-cdn'` (the implementation is not
 *   yet available -- T027).
 */
export function makeProvider(config: ImageProviderConfig): ImageSourceProvider {
  if (config.kind === 'source-iiif') {
    return makeSourceIiifProvider();
  }

  // config.kind === 'b2-cdn' here -- ImageProviderConfig is a two-variant
  // discriminated union, so this is the only remaining case.
  if (config.cdnBase.trim().length === 0) {
    throw new Error(
      'makeProvider: the "b2-cdn" image provider requires a non-empty cdnBase ' +
        '(image-provider contract G-1) -- it does not fall back to source-iiif. ' +
        'Set CORPUS_CDN_BASE (see src/browser/config.ts).'
    );
  }

  throw new Error(
    'makeProvider: the "b2-cdn" image provider is not yet implemented (T027). ' +
      'Use { kind: "source-iiif" } until the b2-cdn implementation lands.'
  );
}
