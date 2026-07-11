/**
 * The `ImageByteSource` contract: fetches print-resolution page-image bytes
 * for one page and reports how they were verified (see
 * specs/007-corpus-print-pdf/contracts/image-fetch.md). Two implementations
 * exist -- `makeB2ImageSource` (`./b2-source.ts`, primary) and
 * `makeIiifImageSource` (`./iiif-source.ts`, alternate) -- both share the
 * types and small helpers declared here.
 *
 * IMPORTANT ASYMMETRY (read before touching either implementation): the
 * snapshot's `ImageRequest.sha256` is the checksum of the **B2 master**
 * object (recorded at archive-fetch time, see `@/archive/provenance`). That
 * makes it an EXACT integrity check ONLY against B2 master bytes --
 * `makeB2ImageSource` fetches those same bytes and MUST verify them against
 * it, failing loud on any mismatch (G-1). The IIIF alternate
 * (`makeIiifImageSource`) fetches a *different derivative* -- Gallica's own
 * `full/max` JPEG rendering of the same folio -- whose bytes are NOT
 * expected to hash-match the B2 master (different encode pipeline, possibly
 * different resolution). Comparing IIIF bytes against the master sha256
 * would therefore fail on cryptographically PERFECT IIIF fetches -- a
 * false-fail, not a real integrity problem. So `makeIiifImageSource` does
 * NOT compare against `ImageRequest.sha256` at all; instead it records
 * `provider: 'source-iiif'` on the `FetchedImage` it returns and reports the
 * checksum of the bytes it actually received (of the IIIF derivative, not
 * the master), so the colophon (`@/pdf/load/colophon`) can flag that this
 * page's image did not come from the sha256-verified master.
 */

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Which `ImageByteSource` served a page's bytes -- mirrors `ImageAsset.provider` (`@/pdf/model`). */
export type ImageSourceKind = 'b2-cdn' | 'source-iiif';

/**
 * One page's image request. `ark`/`objectStoreKey` may individually be
 * absent depending on which source is asked to resolve the page -- `sha256`
 * is always the recorded **B2 master** checksum (see the module doc above).
 */
export interface ImageRequest {
  /** Page/view id (e.g. `f001`), used in every error message and the written file's name. */
  folioId: string;
  /** Source archival identifier (Gallica ark), or `null` if the source has none recorded. */
  ark: string | null;
  /** Archive `object_store` key for the B2 master, or `''`/effectively-absent if never mirrored. */
  objectStoreKey: string;
  /** The B2 master's recorded sha256 (`RawPage.imageSha256`, the folio sidecar's image-master hash) -- see the asymmetry note above. */
  sha256: string;
}

/** The fetched, locally-written bytes for one page, plus how they were verified. */
export interface FetchedImage {
  /** Absolute path to the fetched bytes on local disk (a build temp dir). */
  bytesPath: string;
  /**
   * sha256 of the bytes actually fetched. For `b2-cdn` this is guaranteed
   * to equal the request's `sha256` (verified before returning -- G-1). For
   * `source-iiif` this is the IIIF derivative's own checksum and is NOT
   * expected to equal the request's (master) `sha256` -- see the module doc.
   */
  sha256: string;
  /** Pixel width if known, else `null` (dimension probing is out of scope here -- Typst reads it itself). */
  width: number | null;
  /** Pixel height if known, else `null`. */
  height: number | null;
  /** Which source served the bytes -- carries the verification asymmetry into `ImageAsset.provider`. */
  provider: ImageSourceKind;
}

/** One `ImageByteSource` implementation -- injected into the edition build (`@/pdf/render/build`). */
export interface ImageByteSource {
  readonly kind: ImageSourceKind;
  fetch(page: ImageRequest): Promise<FetchedImage>;
}

/**
 * The minimal shape of an HTTP response an `ImageByteSource` needs --
 * satisfied structurally by the real global `fetch`'s `Response`, so
 * production code can inject `fetch` directly while tests inject a small
 * fake with no network I/O (image-fetch contract G-5).
 */
export interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** An injectable single-argument HTTP GET -- real `fetch` conforms structurally. */
export type FetchFn = (url: string) => Promise<FetchResponse>;

let cachedTempDir: Promise<string> | null = null;

/**
 * Lazily creates (once per process) a private temp directory to hold
 * fetched image bytes, and returns it. No credential or secret is ever
 * written into this directory's path or contents (G-4) -- it is a plain
 * `os.tmpdir()` subdirectory.
 */
function ensureTempDir(): Promise<string> {
  if (!cachedTempDir) {
    cachedTempDir = mkdtemp(path.join(tmpdir(), 'corpus-print-pdf-images-'));
  }
  return cachedTempDir;
}

/**
 * Writes fetched bytes to a file inside the shared build temp dir and
 * returns its absolute path. Shared by both `ImageByteSource`
 * implementations so bytes are never duplicated with different naming
 * schemes. The filename encodes only the source `kind` and `folioId` --
 * never any credential or secret (G-4).
 */
export async function writeFetchedBytes(
  kind: ImageSourceKind,
  folioId: string,
  bytes: Uint8Array,
): Promise<string> {
  const dir = await ensureTempDir();
  const safeFolioId = folioId.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(dir, `${kind}-${safeFolioId}.jpg`);
  await writeFile(filePath, bytes);
  return filePath;
}

/**
 * Converts a `FetchResponse`'s body to a `Uint8Array`. Shared by both
 * `ImageByteSource` implementations.
 */
export async function readResponseBytes(response: FetchResponse): Promise<Uint8Array> {
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Asserts `actual` (the sha256 of freshly fetched bytes) matches `expected`
 * (the recorded B2 master sha256). Throws naming the folio and BOTH hashes
 * on mismatch (G-1) -- used by `makeB2ImageSource` only; `makeIiifImageSource`
 * deliberately never calls this (see the module doc's asymmetry note).
 */
export function assertMasterSha256Match(folioId: string, expected: string, actual: string): void {
  if (actual !== expected) {
    throw new Error(
      `image-fetch(b2-cdn): sha256 mismatch for folio ${JSON.stringify(folioId)} -- ` +
        `expected ${expected}, got ${actual}. Fetched bytes do not match the archived B2 master; ` +
        'refusing to embed unverified image data (image-fetch contract G-1).',
    );
  }
}
