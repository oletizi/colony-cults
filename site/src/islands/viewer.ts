/**
 * T016 -- the OpenSeadragon deep-zoom viewer island for the reading view.
 *
 * Provider-agnostic (image-provider contract G-3): given a resolved
 * {@link ImageDescriptor} it initializes an OpenSeadragon viewer with pan/zoom
 * on a target element, choosing the tile source purely from `descriptor.kind`:
 *
 *   - `kind: 'iiif'`      -> the IIIF image API. `descriptor.url` is the IIIF
 *                           image base (e.g. `.../iiif/<ark>/<folioId>`); OSD's
 *                           IIIF tile source is driven by that base's
 *                           `info.json`, so we point OSD at `<base>/info.json`.
 *   - `kind: 'full-image'`-> OSD's simple ("image") tile source over the full
 *                           image url, with client-side zoom.
 *
 * The island fails loud on a malformed descriptor rather than rendering a blank
 * viewer (no fallbacks / mock data): an unknown `kind` or empty `url` throws.
 *
 * Chrome-less by design: OSD's built-in navigation buttons need sprite assets
 * (`prefixUrl`) that a strict CSP would block, so we disable them and wire the
 * reading view's own +/-/reset controls to the viewport. Mouse-wheel, drag and
 * touch pan/zoom stay fully enabled.
 */

import OpenSeadragon from 'openseadragon';
import type { Viewer } from 'openseadragon';
import type { ImageDescriptor } from '@/browser/model';

/** What OSD's `tileSources` accepts for the two descriptor kinds we build. */
type ViewerTileSource = string | { type: 'image'; url: string };

/** The `kind` values a descriptor may carry (mirrors {@link ImageDescriptor}). */
const IMAGE_KINDS = ['iiif', 'full-image'] as const;

/**
 * Builds the OpenSeadragon tile source for a resolved descriptor.
 *
 * @throws Error if `descriptor.url` is empty -- the viewer would otherwise
 *   silently render nothing.
 */
export function buildTileSource(descriptor: ImageDescriptor): ViewerTileSource {
  const url = descriptor.url.trim();
  if (url.length === 0) {
    throw new Error(
      `viewer: ImageDescriptor.url is empty for kind ${JSON.stringify(descriptor.kind)} -- ` +
        'cannot build an OpenSeadragon tile source.'
    );
  }

  if (descriptor.kind === 'iiif') {
    // The descriptor carries the IIIF image *base*; OSD's IIIF tile source is
    // driven by `<base>/info.json`. Passing that url as a string lets OSD fetch
    // and self-configure the tiled source.
    const base = url.replace(/\/+$/, '');
    return `${base}/info.json`;
  }

  // descriptor.kind === 'full-image' -- OSD's simple single-image source.
  return { type: 'image', url };
}

/**
 * Initializes an OpenSeadragon viewer for `descriptor` on `element` with
 * pan/zoom enabled and the built-in chrome suppressed (CSP-safe).
 */
export function createReadingViewer(element: HTMLElement, descriptor: ImageDescriptor): Viewer {
  return OpenSeadragon({
    element,
    tileSources: buildTileSource(descriptor),
    // Suppress OSD's sprite-driven chrome; the reading view supplies controls.
    showNavigationControl: false,
    showZoomControl: false,
    showHomeControl: false,
    showFullPageControl: false,
    showSequenceControl: false,
    showNavigator: false,
    // No crossOriginPolicy: displaying a cross-origin Gallica image needs no
    // CORS; forcing crossOrigin="anonymous" would make the browser refuse the
    // image when Gallica omits CORS headers, blanking the viewer (TASK-11).
    gestureSettingsMouse: { scrollToZoom: true, clickToZoom: false, dblClickToZoom: true },
    minZoomImageRatio: 0.85,
    maxZoomPixelRatio: 2.5,
    visibilityRatio: 1,
    constrainDuringPan: true,
    animationTime: 0.6,
    springStiffness: 8,
    immediateRender: false,
  });
}

/** Parses and validates the descriptor serialized onto a mount's data attribute. */
function readDescriptor(mount: HTMLElement): ImageDescriptor {
  const raw = mount.dataset.osdDescriptor;
  if (raw === undefined || raw.trim().length === 0) {
    throw new Error('viewer: mount element is missing its data-osd-descriptor payload.');
  }

  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('viewer: data-osd-descriptor did not parse to an object.');
  }

  const record = parsed as Record<string, unknown>;
  const kind = record.kind;
  const url = record.url;
  if (kind !== 'iiif' && kind !== 'full-image') {
    throw new Error(
      `viewer: data-osd-descriptor.kind must be one of ${IMAGE_KINDS.join(' | ')}; got ${JSON.stringify(kind)}.`
    );
  }
  if (typeof url !== 'string') {
    throw new Error('viewer: data-osd-descriptor.url must be a string.');
  }

  const descriptor: ImageDescriptor = { kind, url };
  if (typeof record.width === 'number') descriptor.width = record.width;
  if (typeof record.height === 'number') descriptor.height = record.height;
  return descriptor;
}

/** Wires the reading view's zoom-in / zoom-out / reset controls to `viewer`. */
function wireControls(root: HTMLElement, viewer: Viewer): void {
  const bind = (selector: string, action: () => void): void => {
    const button = root.querySelector<HTMLButtonElement>(selector);
    if (button === null) return;
    button.addEventListener('click', () => action());
  };
  bind('[data-osd-zoom-in]', () => {
    viewer.viewport.zoomBy(1.4).applyConstraints();
  });
  bind('[data-osd-zoom-out]', () => {
    viewer.viewport.zoomBy(1 / 1.4).applyConstraints();
  });
  bind('[data-osd-reset]', () => {
    viewer.viewport.goHome(false);
  });
}

/**
 * Mounts a viewer on every `[data-osd-mount]` in the document that has not yet
 * been initialized. Idempotent: a mounted element is flagged so re-invocation
 * (Astro dedupes the island script per page, but be defensive) is a no-op.
 */
export function mountAll(doc: Document = document): Viewer[] {
  const mounts = Array.from(doc.querySelectorAll<HTMLElement>('[data-osd-mount]'));
  const viewers: Viewer[] = [];
  for (const mount of mounts) {
    if (mount.dataset.osdReady === 'true') continue;
    const descriptor = readDescriptor(mount);
    const viewer = createReadingViewer(mount, descriptor);
    mount.dataset.osdReady = 'true';
    const root = mount.closest<HTMLElement>('[data-osd-root]') ?? mount;
    wireControls(root, viewer);
    viewers.push(viewer);
  }
  return viewers;
}
