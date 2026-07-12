/**
 * Colony Cults read-through CDN (TASK-12).
 *
 * A Cloudflare Worker that fronts the PUBLIC colony-cults B2 bucket for the
 * READ/consumption side only. It maps `https://<worker>.workers.dev/<key>` to
 * the B2 friendly download URL `${B2_DOWNLOAD_BASE}/<key>` and serves the
 * response from Cloudflare's edge cache, so a cache HIT never touches B2 (no
 * Class B download transaction, no egress -- B2->Cloudflare egress is free via
 * the Bandwidth Alliance).
 *
 * Reads only. Writes (PutObject, Class A) and integrity --verify talk to B2
 * DIRECTLY, never through this cache -- otherwise --verify would check stale
 * edge state and the integrity guarantee is defeated (see the TASK-12 design).
 *
 * `<key>` is the archive-relative object key, identical to the per-asset
 * provenance `object_store.key` (e.g.
 * `archive/cases/port-breton/newspapers/la-nouvelle-france/1879-08-15_bpt6k56068358/f001.jpg`).
 * The corpus-browser `b2-cdn` image provider builds `${CORPUS_CDN_BASE}/<key>`,
 * so point `CORPUS_CDN_BASE` at this Worker's origin.
 *
 * Config comes from wrangler `[vars]`:
 *   - B2_DOWNLOAD_BASE   e.g. https://f004.backblazeb2.com/file/colony-cults
 *   - EDGE_TTL_SECONDS   edge + browser cache lifetime (string int)
 */
export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD' },
      });
    }

    const base = env.B2_DOWNLOAD_BASE;
    if (!base) {
      // Fail loud: a misconfigured Worker must not silently 404 every read.
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

    const originUrl = `${base}/${key}`;

    // `cf.cacheEverything` + `cacheTtl` makes Cloudflare cache the B2 response
    // at the edge PoP; subsequent requests are served from cache without a B2
    // round-trip. Preserve the client method (HEAD stays HEAD).
    const originResponse = await fetch(originUrl, {
      method: request.method,
      cf: { cacheEverything: true, cacheTtl: ttl },
    });

    // Re-emit with an explicit long-lived Cache-Control so browsers/other
    // proxies also cache. The archive masters are effectively immutable; an
    // overwrite is a deliberate, rare event handled by explicit purge (a
    // follow-up: invalidation-on-overwrite in the archive writer).
    const response = new Response(originResponse.body, originResponse);
    if (originResponse.ok) {
      response.headers.set(
        'Cache-Control',
        `public, max-age=${ttl}, immutable`,
      );
    }
    response.headers.set('X-CDN-Origin', 'b2');
    return response;
  },
};
