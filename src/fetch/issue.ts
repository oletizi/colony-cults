import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type {
  IiifClient,
  OaiRecordClient,
} from '@/gallica/gallica-client';
import { iiifImageUrl, issueLandingUrl } from '@/gallica/gallica-client';
import { assertPublicDomain } from '@/rights/gate';
import { issueDir, monographDir, sourceLayout } from '@/archive/location';
import { sourceMeta } from '@/archive/source-registry';
import {
  isAssetRecorded,
  storeAsset,
  type StoreResult,
} from '@/archive/store';
import type { ObjectStore } from '@/archive/object-store';
import type { ProvenanceFields } from '@/archive/provenance';
import type { Rights } from '@/model/rights';
// Type-only: erased at compile time, so this never pulls the git-invoking
// runtime code of `@/cli/archive-checkpoint` into the fetch core -- only the
// `PageStored` SHAPE is shared (see that module for why it lives there).
import type { PageStored } from '@/cli/archive-checkpoint';

/**
 * Coordinates recorded in provenance's `object_store` block when a page-image
 * master is uploaded (T015). Mirrors `StoreOptions.objectStoreCoords`
 * (`@/archive/store`) -- the object key itself is re-derived from the
 * archive layout, not carried here.
 */
export type ObjectStoreCoords = {
  provider: string;
  bucket: string;
  endpoint: string;
};

/**
 * The Gallica capabilities `fetchIssue` depends on, composed from the
 * segregated client interfaces (interface-first DI, composition over
 * inheritance). `GallicaHttpClient` satisfies it; unit tests supply a fake.
 */
export interface FetchClient extends OaiRecordClient, IiifClient {
  /** Page count (`nbVueImages`) for one issue. */
  pagination(issueArk: string): Promise<number>;
}

/** Everything `fetchIssue` needs beyond the issue ark; all injectable. */
export interface FetchIssueContext {
  /** The Gallica client (rights + pagination + IIIF images). */
  client: FetchClient;
  /** Colony Cults source ID, e.g. `PB-P001` (selects layout + metadata). */
  sourceId: string;
  /** Normalized issue date `YYYY-MM-DD`, used to name the issue directory. */
  date: string;
  /** Absolute private-archive root (`../colony-cults-archive`). */
  archiveRoot: string;
  /** Injected clock for the retrieval timestamp (testability, determinism). */
  clock: () => Date;
  /** Re-fetch pages that already exist and are checksum-recorded. */
  force?: boolean;
  /** Optional line-oriented progress sink. */
  log?: (message: string) => void;
  /**
   * Object-store backend for page-image masters (T015), opt-in via the CLI's
   * `--object-store` flag. Undefined -- the default -- means legacy
   * local-only behavior: no upload, `object_store` stays null in provenance.
   */
  objectStore?: ObjectStore;
  /** Coordinates recorded in provenance; meaningful only with {@link objectStore}. */
  objectStoreCoords?: ObjectStoreCoords;
  /**
   * Optional per-page hook (T0xx, page-level checkpointing), invoked once per
   * page AFTER it is stored -- both the write and the skip branch. The fetch
   * core never acts on this beyond invoking it; only the CLI orchestration
   * layer (`src/cli/fetch-shared.ts`) wires a git-touching implementation in.
   */
  onPageStored?: (p: PageStored) => Promise<void>;
}

/**
 * Everything `fetchMonograph` needs beyond the document ark; all injectable.
 * Unlike {@link FetchIssueContext} there is no `date` -- a monograph source
 * has exactly one document, so its archive directory (FR-016) is fixed by
 * the source layout alone (see {@link monographDir}).
 */
export interface FetchMonographContext {
  /** The Gallica client (rights + pagination + IIIF images). */
  client: FetchClient;
  /** Colony Cults source ID, e.g. `PB-P002` (must be `kind: 'monograph'`). */
  sourceId: string;
  /** Absolute private-archive root (`../colony-cults-archive`). */
  archiveRoot: string;
  /** Injected clock for the retrieval timestamp (testability, determinism). */
  clock: () => Date;
  /** Re-fetch pages that already exist and are checksum-recorded. */
  force?: boolean;
  /** Optional line-oriented progress sink. */
  log?: (message: string) => void;
  /**
   * Object-store backend for page-image masters (T015), opt-in via the CLI's
   * `--object-store` flag. Undefined -- the default -- means legacy
   * local-only behavior: no upload, `object_store` stays null in provenance.
   */
  objectStore?: ObjectStore;
  /** Coordinates recorded in provenance; meaningful only with {@link objectStore}. */
  objectStoreCoords?: ObjectStoreCoords;
  /**
   * Optional per-page hook (T0xx, page-level checkpointing), invoked once per
   * page AFTER it is stored -- both the write and the skip branch. See the
   * matching field on {@link FetchIssueContext}.
   */
  onPageStored?: (p: PageStored) => Promise<void>;
}

/** Per-document (issue or monograph) fetch outcome. */
export interface FetchIssueResult {
  /** The issue ark (periodical) or document ark (monograph) fetched. */
  issueArk: string;
  /** Absolute archive directory the pages were written into. */
  dir: string;
  /** Page count reported by the host (`nbVueImages`). */
  pageCount: number;
  /** Resolved rights (always `public-domain` here; else nothing was fetched). */
  rights: Rights;
  /** One store result per page (skipped ones flagged). */
  pages: StoreResult[];
  /** Bytes actually downloaded and written this run (excludes skips). */
  bytesWritten: number;
  /** Count of pages skipped because already recorded (resumability). */
  skippedCount: number;
}

/** Internal context for the shared per-document page pipeline. */
interface DocumentFetchContext {
  client: FetchClient;
  sourceId: string;
  /** Absolute archive directory to write pages into (already resolved). */
  dir: string;
  archiveRoot: string;
  clock: () => Date;
  force?: boolean;
  log?: (message: string) => void;
  objectStore?: ObjectStore;
  objectStoreCoords?: ObjectStoreCoords;
  onPageStored?: (p: PageStored) => Promise<void>;
}

/** Zero-padded page ordinal for the `f<NNN>.jpg` asset name. */
function pageFileName(page: number): string {
  return `f${String(page).padStart(3, '0')}.jpg`;
}

/**
 * The bare issue identifier used for the archive directory name (the census
 * and archive layout use bare arks). Drops the `ark:/12148/` namespace so its
 * slashes never leak into the directory tree.
 */
function bareIssueArk(issueArk: string): string {
  return issueArk.trim().replace(/^ark:\/12148\//, '');
}

/**
 * The shared per-document page pipeline (T023/T034, FR-003/004/006/007/009):
 * rights gate first, then fetch+store every page. Used by both {@link
 * fetchIssue} (a periodical's issue, dated subdirectory) and {@link
 * fetchMonograph} (a monograph's single document, flat directory) -- the two
 * differ only in HOW their target directory is resolved before calling this.
 *
 * Order matters for safety: the rights gate runs FIRST, so a non-public-domain
 * (or absent-rights) document throws before anything is downloaded or
 * written. Then, for each page `1..pageCount`, the full-native IIIF JPEG is
 * fetched and stored as `f<NNN>.jpg` with a companion provenance YAML.
 * Resumability: a page already present with a matching recorded checksum is
 * skipped WITHOUT re-downloading, unless `force` is set. Images only — no OCR
 * here.
 */
async function fetchDocumentPages(
  documentArk: string,
  ctx: DocumentFetchContext,
): Promise<FetchIssueResult> {
  // FR-004: rights gate FIRST — throws (and downloads nothing) if not PD.
  const rights = await assertPublicDomain(documentArk, ctx.client);

  const pageCount = await ctx.client.pagination(documentArk);
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error(
      `fetchDocumentPages: document ${documentArk} reported a non-positive ` +
        `page count (${pageCount})`,
    );
  }

  const layout = sourceLayout(ctx.sourceId);
  const meta = sourceMeta(ctx.sourceId);
  const retrieved = ctx.clock().toISOString();
  const catalogUrl = issueLandingUrl(documentArk);

  const pages: StoreResult[] = [];
  let bytesWritten = 0;
  let skippedCount = 0;

  const objectStoreConfigured = ctx.objectStore !== undefined;

  for (let page = 1; page <= pageCount; page += 1) {
    const targetPath = path.join(ctx.dir, pageFileName(page));

    // Is this page already present locally with a matching recorded checksum?
    const recordedLocally =
      ctx.force !== true && (await isAssetRecorded(targetPath));

    // Resumability (FR-009 / SC-005), LEGACY local-only path: with NO object
    // store configured, a page already present + checksum-recorded is skipped
    // WITHOUT re-downloading. When an object store IS configured this local
    // check must NOT short-circuit -- `storeAsset`'s B2 `head(key)` is the
    // skip authority there, so a prior local-only run's masters still get
    // uploaded (audit HIGH finding) rather than silently treated as complete.
    if (!objectStoreConfigured && recordedLocally) {
      pages.push({ path: targetPath, sha256: '', skipped: true });
      skippedCount += 1;
      ctx.log?.(`  skip  ${pageFileName(page)} (already recorded)`);
      await ctx.onPageStored?.({
        sourceId: ctx.sourceId,
        ark: documentArk,
        dir: ctx.dir,
        page,
        pageCount,
        skipped: true,
      });
      continue;
    }

    const originalUrl = iiifImageUrl(documentArk, page);

    // Obtain the bytes: re-read the LOCAL cache file (no IIIF fetch) when the
    // page is already recorded on disk; otherwise download from Gallica. Only
    // reachable with an object store configured OR force -- the legacy skip
    // above returns before this for the pure local-only case.
    let bytes: Uint8Array;
    let downloaded: boolean;
    if (recordedLocally) {
      bytes = await readFile(targetPath);
      downloaded = false;
    } else {
      bytes = await ctx.client.iiifImage(documentArk, page);
      downloaded = true;
    }

    const provenance: ProvenanceFields = {
      id: ctx.sourceId,
      title: meta.title,
      type: 'page-image',
      case: layout.case,
      language: meta.language,
      source_archive: meta.sourceArchive,
      catalog_url: catalogUrl,
      original_url: originalUrl,
      rights_status: rights.status,
      retrieved,
      // local_path + sha256 + size are (re)derived inside storeAsset from the
      // real bytes; object_store is null until the master is uploaded (T009).
      local_path: '',
      sha256: '',
      size: 0,
      format: 'image/jpeg',
      ocr_status: 'none',
      object_store: null,
      rights_raw: rights.rawResponse,
      notes: null,
    };

    const result = await storeAsset(
      bytes,
      targetPath,
      provenance,
      ctx.archiveRoot,
      {
        force: ctx.force,
        objectStore: ctx.objectStore,
        objectStoreCoords: ctx.objectStoreCoords,
      },
    );
    pages.push(result);
    if (result.skipped) {
      // storeAsset skipped: for an object-store run this is a B2-head match
      // (the object already exists at the recorded sha); for a forced
      // re-download it does not occur. Counts as skipped, not as bytes.
      skippedCount += 1;
      ctx.log?.(`  skip  ${pageFileName(page)} (already recorded)`);
    } else if (downloaded) {
      // Freshly downloaded from Gallica and written -- the only path that
      // adds to the "bytes downloaded this run" counter.
      bytesWritten += bytes.byteLength;
      ctx.log?.(`  wrote ${pageFileName(page)} (${bytes.byteLength} bytes)`);
    } else {
      // Backfill: bytes came from the local cache and were uploaded to the
      // object store. No Gallica download happened, so this is neither a skip
      // nor counted as downloaded bytes.
      ctx.log?.(
        `  upload ${pageFileName(page)} (${bytes.byteLength} bytes from local cache)`,
      );
    }

    await ctx.onPageStored?.({
      sourceId: ctx.sourceId,
      ark: documentArk,
      dir: ctx.dir,
      page,
      pageCount,
      skipped: result.skipped,
    });
  }

  return {
    issueArk: documentArk,
    dir: ctx.dir,
    pageCount,
    rights,
    pages,
    bytesWritten,
    skippedCount,
  };
}

/**
 * Fetch one periodical issue's full-resolution page images into the private
 * archive, into its dated `<date>_<ark>` subdirectory (T023). See {@link
 * fetchDocumentPages} for the shared per-page pipeline this wraps.
 */
export async function fetchIssue(
  issueArk: string,
  ctx: FetchIssueContext,
): Promise<FetchIssueResult> {
  const dir = issueDir(
    ctx.sourceId,
    { ark: bareIssueArk(issueArk), date: ctx.date },
    ctx.archiveRoot,
  );
  return fetchDocumentPages(issueArk, { ...ctx, dir });
}

/**
 * Fetch a monograph source's single document into its flat archive directory
 * (T034, FR-016) -- same rights-gated, resumable, guarded per-page pipeline
 * as {@link fetchIssue}, reused via {@link fetchDocumentPages} rather than
 * duplicated. Throws (fail loud) when `sourceId` is not registered as
 * `kind: 'monograph'`.
 */
export async function fetchMonograph(
  documentArk: string,
  ctx: FetchMonographContext,
): Promise<FetchIssueResult> {
  const dir = monographDir(ctx.sourceId, ctx.archiveRoot);
  return fetchDocumentPages(documentArk, { ...ctx, dir });
}
