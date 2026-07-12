# Cloudflare read-through CDN for the B2 archive (TASK-12)

A Cloudflare Worker on `*.workers.dev` that fronts the **public** `colony-cults`
B2 bucket for the **read/consumption** side, caching masters at the edge so a
cache HIT never incurs a B2 Class B (download) transaction. Writes and integrity
`--verify` talk to B2 **directly** and never through this cache.

Reads resolve as `https://<worker>.workers.dev/<key>`, where `<key>` is the
archive-relative object key (identical to a provenance `object_store.key`). The
corpus-browser `b2-cdn` image provider builds `${CORPUS_CDN_BASE}/<key>`, so set
`CORPUS_CDN_BASE` to the Worker origin.

## One-time setup

1. **Make the bucket public** (prints the real `downloadUrl`; verifies an
   anonymous read):

   ```
   python3 infra/cloudflare-cdn/set-bucket-public.py
   ```

   If it reports a `writeBuckets` capability error, flip it with the B2 master
   key or in the console (Bucket Settings → *Files in bucket are:* Public).
   Update `B2_DOWNLOAD_BASE` in `wrangler.toml` if the printed `downloadUrl`
   host differs from `f004`.

2. **Deploy the Worker** (needs a free Cloudflare account; no custom domain):

   ```
   cd infra/cloudflare-cdn
   npx wrangler login       # browser OAuth; grants CLI access to your account
   npx wrangler deploy      # prints the https://colony-cults-cdn.<sub>.workers.dev URL
   ```

3. **Verify edge caching** (second request should show a cache HIT / age):

   ```
   K=archive/cases/port-breton/newspapers/la-nouvelle-france/1881-04-15_bpt6k5605235w/f001.jpg
   curl -sI "https://colony-cults-cdn.<sub>.workers.dev/$K" | grep -iE 'http/|cf-cache-status|cache-control|age'
   curl -sI "https://colony-cults-cdn.<sub>.workers.dev/$K" | grep -iE 'cf-cache-status|age'
   ```

4. **Wire the site build** to the CDN:

   ```
   export CORPUS_IMAGE_PROVIDER=b2-cdn
   export CORPUS_CDN_BASE=https://colony-cults-cdn.<sub>.workers.dev
   CORPUS_ARCHIVE_PATH=../../colony-cults-archive npm run site:build
   ```

   Expect each page's viewer descriptor to switch to the `b2-cdn` `full-image`
   URL `${CORPUS_CDN_BASE}/<object_store-key>`.

## Follow-ups

- **Invalidation on overwrite** — masters are treated immutable (long edge TTL).
  A rare overwrite needs an explicit edge purge; a later change to the archive
  writer can purge the affected key. Not needed for the append-only common case.
- **Rotate the exposed B2 key** (TASK-7) — independent, but do it before wider use.
- **Class B still applies to cold/one-off reads** (cache miss); this pays off on
  repeated reads (the browser, downstream tools), not first-touch of unique keys.
