import path from 'node:path';
import type {
  IiifClient,
  OaiRecordClient,
} from '@/gallica/gallica-client';
import { iiifImageUrl, issueLandingUrl } from '@/gallica/gallica-client';
import { assertPublicDomain } from '@/rights/gate';
import { issueDir, sourceLayout } from '@/archive/location';
import { sourceMeta } from '@/archive/source-registry';
import {
  isAssetRecorded,
  storeAsset,
  type StoreResult,
} from '@/archive/store';
import type { ProvenanceFields } from '@/archive/provenance';
import type { Rights } from '@/model/rights';

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
}

/** Per-issue fetch outcome. */
export interface FetchIssueResult {
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
 * Fetch one issue's full-resolution page images into the private archive
 * (T023, FR-003/004/006/007/009).
 *
 * Order matters for safety: the rights gate runs FIRST, so a non-public-domain
 * (or absent-rights) issue throws before anything is downloaded or written.
 * Then, for each page `1..pageCount`, the full-native IIIF JPEG is fetched and
 * stored as `f<NNN>.jpg` with a companion provenance YAML. Resumability: a page
 * already present with a matching recorded checksum is skipped WITHOUT
 * re-downloading, unless `force` is set. Images only — no OCR here.
 */
export async function fetchIssue(
  issueArk: string,
  ctx: FetchIssueContext,
): Promise<FetchIssueResult> {
  // FR-004: rights gate FIRST — throws (and downloads nothing) if not PD.
  const rights = await assertPublicDomain(issueArk, ctx.client);

  const pageCount = await ctx.client.pagination(issueArk);
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error(
      `fetchIssue: issue ${issueArk} reported a non-positive page count ` +
        `(${pageCount})`,
    );
  }

  const layout = sourceLayout(ctx.sourceId);
  const meta = sourceMeta(ctx.sourceId);
  const dir = issueDir(
    ctx.sourceId,
    { ark: bareIssueArk(issueArk), date: ctx.date },
    ctx.archiveRoot,
  );
  const retrieved = ctx.clock().toISOString();
  const catalogUrl = issueLandingUrl(issueArk);

  const pages: StoreResult[] = [];
  let bytesWritten = 0;
  let skippedCount = 0;

  for (let page = 1; page <= pageCount; page += 1) {
    const targetPath = path.join(dir, pageFileName(page));

    // Resumability (FR-009 / SC-005): skip the download itself for a page
    // already present with a matching recorded checksum.
    if (ctx.force !== true && (await isAssetRecorded(targetPath))) {
      pages.push({ path: targetPath, sha256: '', skipped: true });
      skippedCount += 1;
      ctx.log?.(`  skip  ${pageFileName(page)} (already recorded)`);
      continue;
    }

    const originalUrl = iiifImageUrl(issueArk, page);
    const bytes = await ctx.client.iiifImage(issueArk, page);

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
      // local_path + sha256 are (re)derived inside storeAsset from real bytes.
      local_path: '',
      sha256: '',
      format: 'image/jpeg',
      ocr_status: 'none',
      rights_raw: rights.rawResponse,
      notes: null,
    };

    const result = await storeAsset(
      bytes,
      targetPath,
      provenance,
      ctx.archiveRoot,
      { force: ctx.force },
    );
    pages.push(result);
    if (result.skipped) {
      skippedCount += 1;
      ctx.log?.(`  skip  ${pageFileName(page)} (already recorded)`);
    } else {
      bytesWritten += bytes.byteLength;
      ctx.log?.(`  wrote ${pageFileName(page)} (${bytes.byteLength} bytes)`);
    }
  }

  return {
    issueArk,
    dir,
    pageCount,
    rights,
    pages,
    bytesWritten,
    skippedCount,
  };
}
