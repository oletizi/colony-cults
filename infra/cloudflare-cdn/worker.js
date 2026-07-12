/**
 * Colony Cults read-through CDN (TASK-12).
 *
 * A Cloudflare Worker that fronts the PUBLIC colony-cults B2 bucket for the
 * READ/consumption side only. It maps `https://<worker>.workers.dev/<key>` to
 * the B2 friendly download URL `${B2_DOWNLOAD_BASE}/<key>` and serves the
 * response from Cloudflare's edge cache, so a cache HIT never touches B2 (no
 * Class B download transaction; B2->Cloudflare egress is free via the
 * Bandwidth Alliance).
 *
 * Reads only. Writes (PutObject, Class A) and integrity --verify talk to B2
 * DIRECTLY, never through this cache.
 *
 * `<key>` is the archive-relative object key, identical to a provenance
 * `object_store.key`. The corpus-browser `b2-cdn` image provider builds
 * `${CORPUS_CDN_BASE}/<key>`, so point `CORPUS_CDN_BASE` at this Worker.
 *
 * Caching contract (IMPORTANT):
 *   - ONLY 2xx responses are cached, via the explicit Cache API (`caches.default`)
 *     under a versioned key. Error responses (e.g. a B2 403
 *     `download_cap_exceeded` while the daily cap is blown) are NEVER cached --
 *     otherwise a transient 403 would be served for the whole TTL even after the
 *     cap resets. (An earlier version used `cf.cacheEverything + cacheTtl`, which
 *     cached errors too; `cacheTtlByStatus` would fix that but is Enterprise-only,
 *     so we cache explicitly instead.)
 *   - Bump `CACHE_VERSION` to invalidate the whole namespace without a
 *     zone-level purge (workers.dev has no zone to purge). The version also rides
 *     on the origin fetch as `?ccv=` (B2 ignores unknown query params) so a new
 *     version bypasses any stale edge entry under the old key.
 *   - CORS: every response carries `Access-Control-Allow-Origin: *`. The reading
 *     viewer loads page images through OpenSeadragon with
 *     `crossOriginPolicy: 'Anonymous'` (see `site/src/islands/viewer.ts`), so the
 *     browser requires an ACAO header or it taints the canvas and the image fails
 *     to render. B2 sends no CORS header on the public bucket, so the Worker adds
 *     it. `*` is origin-independent, so it is safe to bake into the cached entry.
 *
 * Image resizing (READING WIDTH):
 *   - An optional `?w=<n>` query param resizes the master via Cloudflare Image
 *     Resizing (`cf.image`, fit=scale-down) so the browser fetches a reading-size
 *     image (hundreds of KiB) instead of the full ~2 MiB master. The corpus-browser
 *     `b2-cdn` provider appends `?w=` (see src/browser/providers/b2-cdn.ts, driven
 *     by CORPUS_CDN_IMAGE_WIDTH). `scale-down` never upscales, so a page already
 *     narrower than `w` is returned untouched. An out-of-range/invalid `w` is
 *     ignored (full master). Each distinct width is cached under its own key and
 *     counts as one transform against the account's monthly quota.
 *   - Requires "Image Resizing (transformations)" enabled for the zone/account
 *     (works on the free `*.workers.dev` host). Without it, `cf.image` is ignored
 *     and the master is served -- correct, just not smaller.
 *
 * Config (wrangler `[vars]`):
 *   - B2_DOWNLOAD_BASE   e.g. https://f004.backblazeb2.com/file/colony-cults
 *   - EDGE_TTL_SECONDS   edge + browser cache lifetime for 2xx (string int)
 *   - MAX_IMAGE_WIDTH    largest accepted `?w=` (string int; default 5000)
 */
const CACHE_VERSION = '3';

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD' },
      });
    }

    const base = env.B2_DOWNLOAD_BASE;
    if (!base) {
      return new Response('CDN misconfigured: B2_DOWNLOAD_BASE unset', {
        status: 500,
      });
    }
    const ttl = Number.parseInt(env.EDGE_TTL_SECONDS ?? '2592000', 10);

    const url = new URL(request.url);
    const key = url.pathname.replace(/^\/+/, '');
    if (key === '') {
      return new Response('Not Found (no object key)', { status: 404 });
    }

    // Optional reading-width resize. A valid positive `?w=` within bounds is
    // honored via cf.image (scale-down); anything else => full master.
    const maxWidth = Number.parseInt(env.MAX_IMAGE_WIDTH ?? '5000', 10);
    const rawWidth = url.searchParams.get('w');
    let width = null;
    if (rawWidth !== null && /^\d+$/.test(rawWidth)) {
      const w = Number.parseInt(rawWidth, 10);
      if (w > 0 && w <= maxWidth) {
        width = w;
      }
    }

    // Our own edge-cache entry, namespaced by version AND width so each reading
    // size is cached independently (and the master, width=full, separately).
    // Only 2xx ever land here.
    const cache = caches.default;
    const variant = width ? `w${width}` : 'full';
    const cacheKey = new Request(`${url.origin}/__cdn/v${CACHE_VERSION}/${variant}/${key}`);

    const cached = await cache.match(cacheKey);
    if (cached) {
      const hit = new Response(cached.body, cached);
      hit.headers.set('X-CDN-Cache', 'HIT');
      // CORS so browsers can use the image cross-origin (the corpus-browser
      // OpenSeadragon viewer requests it with crossOrigin=anonymous; without
      // this the canvas taints and the scan blanks).
      hit.headers.set('Access-Control-Allow-Origin', '*');
      return hit;
    }

    // Miss: fetch B2 directly. `cacheEverything: false` keeps Cloudflare from
    // implicitly caching the subrequest (so errors are never cached); the
    // `?ccv=` version busts any stale entry left by an earlier code version.
    // When a width is requested, `cf.image` resizes the master at the edge
    // (scale-down: never upscale); billed as one transform per unique variant.
    const originCf = { cacheEverything: false };
    if (width) {
      originCf.image = { width, fit: 'scale-down', quality: 85 };
    }
    const origin = await fetch(`${base}/${key}?ccv=${CACHE_VERSION}`, {
      cf: originCf,
    });

    if (!origin.ok) {
      // Never cache an error (e.g. B2 403 download_cap_exceeded).
      const err = new Response(origin.body, origin);
      err.headers.set('Cache-Control', 'no-store');
      err.headers.set('X-CDN-Cache', 'BYPASS-ERR');
      err.headers.set('X-CDN-Origin', 'b2');
      err.headers.set('Access-Control-Allow-Origin', '*');
      return err;
    }

    const ok = new Response(origin.body, origin);
    ok.headers.set('Cache-Control', `public, max-age=${ttl}, immutable`);
    ok.headers.set('X-CDN-Cache', 'MISS');
    ok.headers.set('X-CDN-Origin', 'b2');
    ok.headers.set('Access-Control-Allow-Origin', '*');
    ctx.waitUntil(cache.put(cacheKey, ok.clone()));
    return ok;
  },
};
