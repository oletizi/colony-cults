/**
 * `createCdnObjectStore` is the READ-ONLY `ObjectStore` backend that fronts
 * the public CDN mirroring the B2 bucket (spec 017: "read from the CDN, not
 * the B2 bucket directly" -- operator directive).
 *
 * The summarizer only ever READS already-acquired assets (e.g. a Papers Past
 * member's detached `ocr-text` asset, via `@/archive/issue-text-materialize`'s
 * `materializeIssueText`) -- it never writes to the object store. Reading via
 * the CDN means `bib summarize` needs no B2 credentials
 * (`COLONY_S3_*`/`COLONY_B2_CREDENTIALS`, see `@/archive/b2-config`) at all;
 * only `@/archive/s3-object-store`'s `S3ObjectStore` (used by acquisition/
 * archive-writer flows that actually PUT into the bucket) still needs them.
 *
 * `get(key)` performs an unsigned, unauthenticated GET at
 * `${cdnBase}/${key}` and returns the response body's RAW bytes -- never
 * `.text()` -- so a caller that sha256-verifies the fetched bytes (as
 * `materializeIssueText` does) is checksumming the exact bytes served, not a
 * UTF-8 decode/re-encode round trip that could silently substitute
 * replacement characters for invalid byte sequences in a non-UTF-8 asset.
 *
 * `head`/`put`/`attachSha256Metadata` all throw: a read-only summarizer must
 * never be able to mutate the store it reads through, and `materializeIssueText`
 * never calls them, so this is a safe, deliberate limitation rather than an
 * unimplemented gap.
 */

import type { ObjectHead, ObjectStore, PutOptions } from '@/archive/object-store';

/** Strips any trailing slashes from `base` so `${base}/${key}` never double-slashes. */
function stripTrailingSlashes(base: string): string {
  return base.replace(/\/+$/, '');
}

/** Throws the shared "not supported -- read-only" error for a mutating method. */
function throwReadOnly(method: string): never {
  throw new Error(
    `createCdnObjectStore: ${method} not supported -- the CDN store is READ-ONLY ` +
      `(public GET only); summarize only reads already-acquired assets and never ` +
      `writes to the object store.`,
  );
}

/**
 * Build a read-only `ObjectStore` that fetches object bytes via unsigned GET
 * requests against `cdnBase` (the public CDN fronting the B2 bucket).
 *
 * `get` throws a descriptive Error naming the request URL on either a
 * network failure or a non-2xx response (fail loud, no fallback, no partial
 * bytes). `head`/`put`/`attachSha256Metadata` always throw -- this store
 * supports reads only.
 */
export function createCdnObjectStore(cdnBase: string): ObjectStore {
  const base = stripTrailingSlashes(cdnBase);

  return {
    async head(_key: string): Promise<ObjectHead> {
      return throwReadOnly('head');
    },
    async put(_key: string, _bytes: Uint8Array, _options: PutOptions): Promise<void> {
      return throwReadOnly('put');
    },
    async get(key: string): Promise<Uint8Array> {
      const url = `${base}/${key}`;
      let response: Response;
      try {
        response = await fetch(url);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`createCdnObjectStore.get: failed to fetch ${url} -- ${message}`);
      }
      if (!response.ok) {
        throw new Error(
          `createCdnObjectStore.get: GET ${url} returned HTTP ${response.status} ${response.statusText}`,
        );
      }
      return new Uint8Array(await response.arrayBuffer());
    },
    async attachSha256Metadata(
      _key: string,
      _sha256: string,
      _contentType?: string,
    ): Promise<void> {
      return throwReadOnly('attachSha256Metadata');
    },
  };
}
