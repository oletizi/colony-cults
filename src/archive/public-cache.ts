import { existsSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256OfBytes } from '@/archive/checksum';
import {
  readProvenance,
  type ObjectStoreLocation,
} from '@/archive/provenance';

/**
 * Minimal HTTP-GET surface {@link restoreIssueImages} depends on -- a strict
 * subset of the global `fetch` `Response`. Kept small and injectable so tests
 * can drive the restore with an in-memory fake instead of real network I/O.
 */
export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** An anonymous HTTP GET (default: the runtime's global `fetch`). */
export type HttpGet = (url: string) => Promise<HttpResponse>;

/** The default GET: an anonymous, credential-free `fetch` (public bucket read). */
export const defaultHttpGet: HttpGet = (url) => fetch(url);

/**
 * The public, path-style URL for an object in a PUBLIC-READ bucket:
 * `${endpoint}/${bucket}/${key}`. This is deliberately credential-free -- it
 * does NOT go through the S3 SDK (`@/archive/s3-object-store`), which signs
 * requests with the write credentials. Reading the cache needs no key.
 */
export function publicObjectUrl(location: ObjectStoreLocation): string {
  const endpoint = location.endpoint.replace(/\/+$/, '');
  const key = location.key.replace(/^\/+/, '');
  return `${endpoint}/${location.bucket}/${key}`;
}

/** Options for {@link restoreIssueImages} (all injectable; real `fetch` by default). */
export interface RestoreImagesOptions {
  /** Anonymous HTTP GET (default {@link defaultHttpGet}). */
  httpGet?: HttpGet;
  /** Optional line-oriented progress sink. */
  log?: (message: string) => void;
  /** Re-download and overwrite even when a local `f###.jpg` is already present. */
  force?: boolean;
}

/** Outcome of one {@link restoreIssueImages} call. */
export interface RestoreImagesResult {
  /** Absolute `f###.jpg` paths written from the cache this run. */
  restored: string[];
  /** Absolute `f###.jpg` paths already present locally (left untouched). */
  skipped: string[];
}

/**
 * Restore an issue's page-image masters (`f###.jpg`) from the PUBLIC B2 cache
 * "when available", using each page's already-committed `f###.yml` companion
 * as the source of truth: the companion records the object's `object_store`
 * location (provider/bucket/key/endpoint) and its `sha256`.
 *
 * For every page whose local `.jpg` is absent (or when `force`), this GETs the
 * public path-style URL anonymously, VERIFIES the downloaded bytes' sha256
 * against the companion's recorded value, and only then writes the local
 * image. It is idempotent: a page whose image is already present is skipped.
 *
 * FAILS LOUD -- never falls back to Gallica (re-fetching from the source
 * archive is deliberately out of scope here; it is aggressive on academic
 * infrastructure and rate-limited). It throws when:
 *  - the directory has no `f###.yml` companions (issue never fetched);
 *  - a page is absent locally AND its companion records no `object_store`
 *    location (nothing to restore from);
 *  - the public GET returns a non-OK status;
 *  - a download's sha256 does not match the companion's recorded value.
 */
export async function restoreIssueImages(
  issueDir: string,
  options: RestoreImagesOptions = {},
): Promise<RestoreImagesResult> {
  const httpGet = options.httpGet ?? defaultHttpGet;

  const entries = await readdir(issueDir);
  const companions = entries
    .filter((name) => /^f\d{3}\.yml$/.test(name))
    .sort();
  if (companions.length === 0) {
    throw new Error(
      `restoreIssueImages: no page provenance (f###.yml) in ${issueDir} -- fetch the issue first`,
    );
  }

  const restored: string[] = [];
  const skipped: string[] = [];

  for (const companion of companions) {
    const jpgName = companion.replace(/\.yml$/, '.jpg');
    const jpgPath = path.join(issueDir, jpgName);

    if (options.force !== true && existsSync(jpgPath)) {
      skipped.push(jpgPath);
      continue;
    }

    const fields = await readProvenance(path.join(issueDir, companion));
    const location = fields.object_store;

    if (location === null) {
      // No cache to restore from. If the local image happens to exist (only
      // reachable under `force`), leave it; otherwise there is nothing to do
      // but fail loud -- we do NOT re-fetch from Gallica.
      if (existsSync(jpgPath)) {
        skipped.push(jpgPath);
        continue;
      }
      throw new Error(
        `restoreIssueImages: ${jpgName} is absent locally and its companion records ` +
          `no object_store location -- nothing to restore from ` +
          `(refusing to re-fetch from the source archive)`,
      );
    }

    const url = publicObjectUrl(location);
    const response = await httpGet(url);
    if (!response.ok) {
      throw new Error(
        `restoreIssueImages: GET ${url} failed (${response.status} ${response.statusText})`,
      );
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const actual = sha256OfBytes(bytes);
    if (actual !== fields.sha256) {
      throw new Error(
        `restoreIssueImages: ${jpgName} sha256 mismatch from ${url} -- ` +
          `companion records ${fields.sha256}, download is ${actual}`,
      );
    }

    await writeFile(jpgPath, bytes);
    options.log?.(`  pull  ${jpgName} <- ${url}`);
    restored.push(jpgPath);
  }

  return { restored, skipped };
}
