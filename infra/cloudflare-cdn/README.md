# Cloudflare read-through CDN for the B2 archive (TASK-12)

A Cloudflare Worker on `*.workers.dev` that fronts the **public** `colony-cults`
B2 bucket for the **read/consumption** side, caching masters at the edge so a
cache HIT never incurs a B2 Class B (download) transaction. Writes and integrity
`--verify` talk to B2 **directly** and never through this cache.

Reads resolve as `https://<worker>.workers.dev/<key>`, where `<key>` is the
archive-relative object key (identical to a provenance `object_store.key`). The
corpus-browser `b2-cdn` image provider builds `${CORPUS_CDN_BASE}/<key>`, so set
`CORPUS_CDN_BASE` to the Worker origin.

Deployed: `https://colony-cults-cdn.oletizi.workers.dev`.

## Status

- **Bucket is already public** (`allPublic`) — `set-bucket-public.py` is kept for
  reference/idempotency but is **not needed**.
- **Worker deployed and correct** — caches only `2xx`; never caches errors; adds
  `Access-Control-Allow-Origin: *` so the OpenSeadragon viewer can load images.
- **B2 download cap has headroom** — verified `2xx` on a live read; cache
  MISS→HIT and error-not-cached both confirmed on the wire. (When the daily cap
  is blown the bucket returns `403 download_cap_exceeded` and nothing can be
  primed until the reset or a raised cap; steady-state HIT reads never touch B2,
  so that is a one-time priming hurdle, not an ongoing one.)

## Caching contract

- **Only `2xx` is cached**, via the explicit Cache API (`caches.default`) under a
  version-namespaced key. Errors (e.g. the 403 above) are returned `no-store` and
  never cached — a transient 403 must not be served for the whole TTL.
- **CORS.** Every response carries `Access-Control-Allow-Origin: *`. The reading
  viewer loads page images through OpenSeadragon with
  `crossOriginPolicy: 'Anonymous'` (`site/src/islands/viewer.ts`), so without an
  ACAO header the browser taints the canvas and the image fails to render. B2
  sends no CORS header on the public bucket, so the Worker adds it; `*` is
  origin-independent and safe to bake into the cached entry.
- **Invalidation.** `workers.dev` has no zone, so there is no global purge-by-URL
  API. Levers, in order of reliability:
  1. **Global (bump `CACHE_VERSION` in `worker.js`)** — flips the cache-key
     namespace everywhere at once; old entries at every PoP are orphaned and age
     out. Use for "invalidate broadly."
  2. **Per-key best-effort (`caches.default.delete()`)** — only evicts at the colo
     the Worker runs in (Cloudflare's cache is per data center). A hint, not a
     guarantee. (Not wired to a route yet; would need an authenticated endpoint.)
  3. **Per-key global** — only available if the CDN moves to a **custom domain (a
     real zone)**, then the zone purge-by-URL API. The natural upgrade for a
     public deploy / routine overwrite-invalidation.

## Setup / operation

1. **Deploy / redeploy the Worker** (Cloudflare account; no custom domain):

   ```
   cd infra/cloudflare-cdn
   npx wrangler login        # once
   npx wrangler deploy
   ```

   Confirm `B2_DOWNLOAD_BASE` in `wrangler.toml` matches the bucket's real
   `downloadUrl` host (confirmed `f004`).

2. **When the B2 cap has headroom, prime the cache**:

   ```
   CORPUS_ARCHIVE_PATH=/Users/orion/work/colony-cults-archive \
   CDN_BASE=https://colony-cults-cdn.oletizi.workers.dev \
   python3 infra/cloudflare-cdn/warm-cache.py
   ```

   Each object is one Class B on first fetch (then cached). ~1.4k images fits the
   2,500/day free tier if there's headroom; the script stops and reports if it
   starts hitting 403s.

3. **Verify caching** (second read should be a HIT). Use `GET` (`-D -`), NOT
   `HEAD` (`-I`): the Cache API does not populate/serve HEAD the same way, so a
   HEAD probe reports `MISS` every time and is misleading.

   ```
   K=archive/cases/port-breton/newspapers/la-nouvelle-france/1881-04-15_bpt6k5605235w/f001.jpg
   URL=https://colony-cults-cdn.oletizi.workers.dev/$K
   curl -s -o /dev/null -D - "$URL" | grep -iE 'x-cdn-cache|cf-cache-status'  # run twice: MISS then HIT
   ```

4. **Wire the site build** to the CDN:

   ```
   export CORPUS_IMAGE_PROVIDER=b2-cdn
   export CORPUS_CDN_BASE=https://colony-cults-cdn.oletizi.workers.dev
   CORPUS_ARCHIVE_PATH=../../colony-cults-archive npm run site:build
   ```

## Follow-ups

- **Rotate the exposed B2 key** (TASK-7) — independent, but do it before wider use.
- **Custom domain** — moving off `workers.dev` to a zone unlocks global
  purge-by-URL (per-key overwrite invalidation) and a stable hostname.
- Class B still applies to cold/one-off reads (cache miss); the CDN pays off on
  repeated reads, not first-touch of unique keys.
