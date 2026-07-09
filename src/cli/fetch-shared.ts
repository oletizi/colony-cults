import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { ParsedArgs, ParsedFlags } from '@/cli/parse';
import type { GallicaClient, IssueMetaClient } from '@/gallica/gallica-client';
import { GallicaHttpClient } from '@/gallica/gallica-client';
import { HttpClient } from '@/gallica/http-client';
import { resolveArchiveRoot, sourceLayout } from '@/archive/location';
import { verifyAsset } from '@/archive/store';
import type { ObjectStore } from '@/archive/object-store';
import { resolveObjectStoreConfig } from '@/archive/b2-config';
import { S3ObjectStore } from '@/archive/s3-object-store';
import {
  commitAndPushIssueCheckpoint,
  type IssueCheckpoint,
  type PageStored,
} from '@/cli/archive-checkpoint';
import { resolveRights } from '@/rights/gate';
import {
  fetchIssue,
  fetchMonograph,
  type FetchClient,
  type FetchIssueResult,
} from '@/fetch/issue';
import { estimateIssue } from '@/fetch/estimate';
import { assertOcrToolchain } from '@/ocr/preflight';
import { ocrIssue, defaultOcrCommandRunner } from '@/ocr/run';
import type { OcrCommandRunner } from '@/ocr/types';

/**
 * Shared types, dependencies, and helpers used by BOTH `fetch-issue`
 * (`src/cli/fetch-issue.ts`) and `fetch-source` (`src/cli/fetch-source.ts`) --
 * split out from a single `fetch.ts` (T034/T036) to keep each file under the
 * project's file-size guideline.
 */

/**
 * Composed client the fetch commands depend on: the rights + pagination + IIIF
 * capabilities `fetchIssue`/`estimateIssue` need, plus census enumeration
 * (`GallicaClient`) and single-issue date resolution (`IssueMetaClient`).
 */
export type FetchCliClient = FetchClient & GallicaClient & IssueMetaClient;

/** Injectable side effects for the fetch commands (real network + disk by default). */
export interface FetchDeps {
  client: FetchCliClient;
  /** Public-repo root the census path is resolved against. */
  repoRoot: string;
  /** Private-archive root (`../colony-cults-archive`). */
  archiveRoot: string;
  /** Retrieval-timestamp clock (injected for determinism/testability). */
  clock: () => Date;
  /** ISO date stamped into a census built on demand. */
  builtAt: string;
  /** Line-oriented output sink (stdout in production). */
  log: (message: string) => void;
  /**
   * OCR toolchain preflight (T029/FR-013). Invoked ONLY when `--ocr` is set,
   * before any fetch work -- an images-only run must never call this
   * (SC-008). Injected so tests can simulate an absent toolchain.
   */
  ocrPreflight: () => Promise<void>;
  /** Injected OCR command runner (T030), used when `--ocr` wires OCR in. */
  ocrRunner: OcrCommandRunner;
  /**
   * Object-store backend for page-image masters (T015/T016), opt-in via
   * `--object-store`. Undefined -- the default -- means legacy local-only
   * behavior: no upload, `object_store` stays null in provenance. OCR text
   * assets never use this (they stay local/git regardless).
   */
  objectStore?: ObjectStore;
  /**
   * Coordinates recorded in provenance's `object_store` block; only
   * meaningful together with {@link FetchDeps.objectStore}. The object key
   * itself is re-derived from the archive layout, not carried here.
   */
  objectStoreCoords?: { provider: string; bucket: string; endpoint: string };
  /**
   * Per-issue checkpoint hook, opt-in via `--checkpoint`. The fetch core
   * (`src/fetch/*`) never calls this and never imports git; only the CLI
   * orchestration layer (`fetch-issue.ts`/`fetch-source.ts`) invokes it, once
   * per completed issue. Undefined -- the default -- means checkpointing is
   * off: tests and dry-runs never touch git. When wired (by
   * {@link defaultFetchDeps}), it delegates to
   * {@link commitAndPushIssueCheckpoint}, the only place `git` is invoked.
   */
  onIssueComplete?: (checkpoint: IssueCheckpoint) => Promise<void>;
  /**
   * Per-page checkpoint hook, opt-in via `--checkpoint` (MONOGRAPH sources
   * only -- a periodical's issues are already bounded by `onIssueComplete`,
   * so this stays undefined for them). Threaded straight through to the
   * fetch core's `DocumentFetchContext` (`src/fetch/issue.ts`), which never
   * imports git; only {@link defaultFetchDeps} wires a git-touching
   * implementation in, via {@link buildMonographPageCheckpointHook}.
   */
  onPageStored?: (p: PageStored) => Promise<void>;
}

/**
 * Gentle pacing for bulk IIIF image fetching. Full-resolution page images are
 * large (multiple MB) and Gallica rate-limits (HTTP 429) a burst of them, so
 * the fetch path serializes downloads (`maxConcurrent: 1`) and spaces them
 * further apart than the small XML service calls. Backoff + `Retry-After`
 * handling in HttpClient recover from a throttle if one still occurs.
 */
const IMAGE_FETCH_CONCURRENCY = 1;
const IMAGE_FETCH_MIN_INTERVAL_MS = 2000;

/**
 * Shape of {@link commitAndPushIssueCheckpoint}, injected into {@link
 * buildMonographPageCheckpointHook} so the page-cadence logic itself can be
 * unit tested with a fake commit function -- no real git required.
 */
export type CommitCheckpointFn = (
  archiveRoot: string,
  checkpoint: IssueCheckpoint,
  opts: { push: boolean },
) => Promise<void>;

/**
 * Build a STATEFUL per-page checkpoint hook for a MONOGRAPH fetch
 * (`--checkpoint` + `--checkpoint-every <N>`): commits+pushes (via `commit`)
 * every `checkpointEvery` pages, closing over running written/skipped
 * counters so each checkpoint's commit message reflects only the pages
 * stored since the LAST checkpoint (or document start).
 *
 * This state is scoped to ONE closure instance -- callers must build a fresh
 * hook per fetch invocation (never share one across documents/runs); {@link
 * defaultFetchDeps} does exactly this, once per `defaultFetchDeps` call.
 *
 * A periodical issue never uses this -- it stays bounded by the existing
 * per-issue `onIssueComplete` hook; only a monograph document (unbounded
 * page count) needs page-level cadence.
 */
export function buildMonographPageCheckpointHook(
  archiveRoot: string,
  checkpointEvery: number,
  commit: CommitCheckpointFn,
): (stored: PageStored) => Promise<void> {
  if (!Number.isInteger(checkpointEvery) || checkpointEvery < 1) {
    throw new Error(
      `buildMonographPageCheckpointHook: checkpointEvery must be a positive ` +
        `integer (got ${checkpointEvery})`,
    );
  }

  let pagesSinceCheckpoint = 0;
  let writtenSinceCheckpoint = 0;
  let skippedSinceCheckpoint = 0;

  return async (stored: PageStored): Promise<void> => {
    if (stored.skipped) {
      skippedSinceCheckpoint += 1;
    } else {
      writtenSinceCheckpoint += 1;
    }
    pagesSinceCheckpoint += 1;

    if (pagesSinceCheckpoint < checkpointEvery) {
      return;
    }

    const checkpoint: IssueCheckpoint = {
      sourceId: stored.sourceId,
      ark: stored.ark,
      dir: stored.dir,
      pageCount: stored.pageCount,
      written: writtenSinceCheckpoint,
      skipped: skippedSinceCheckpoint,
      page: stored.page,
    };

    pagesSinceCheckpoint = 0;
    writtenSinceCheckpoint = 0;
    skippedSinceCheckpoint = 0;

    await commit(archiveRoot, checkpoint, { push: true });
  };
}

/**
 * Build the default (real network + disk) dependencies.
 *
 * `args` supplies the CLI-level overrides threaded in via T016:
 * `--archive-root <path>` (passed as `resolveArchiveRoot`'s `override`) and
 * the opt-in `--object-store` flag. When `--object-store` is absent (the
 * default), no `ObjectStore` is constructed and the archive stays
 * local-only, unchanged from prior behavior. When present,
 * `resolveObjectStoreConfig()` is called eagerly here so a missing
 * config/credential fails loud before any fetch work begins, rather than
 * failing mid-run on the first page.
 */
export function defaultFetchDeps(args: ParsedArgs): FetchDeps {
  const repoRoot = process.cwd();
  const archiveRoot = resolveArchiveRoot(repoRoot, args.options.archiveRoot);
  const http = new HttpClient({
    maxConcurrent: IMAGE_FETCH_CONCURRENCY,
    minRequestIntervalMs: IMAGE_FETCH_MIN_INTERVAL_MS,
  });

  let objectStore: ObjectStore | undefined;
  let objectStoreCoords: FetchDeps['objectStoreCoords'];
  if (args.flags.objectStore) {
    const config = resolveObjectStoreConfig();
    objectStore = new S3ObjectStore(config);
    objectStoreCoords = {
      provider: config.provider,
      bucket: config.bucket,
      endpoint: config.endpoint,
    };
  }

  // `--checkpoint` (operator's design): commit AND push after every issue.
  // Absent/false leaves `onIssueComplete` undefined, so tests/dry-runs never
  // touch git -- checkpointing is opt-in and this is the ONLY place the git
  // adapter (`@/cli/archive-checkpoint`) is constructed. This same hook also
  // serves as a monograph's FINAL FLUSH: `runFetchSourceMonograph` calls it
  // once at document end with the full document totals, so any pages stored
  // since the last page-cadence checkpoint (below) are committed too -- a
  // clean no-op if the last page-cadence checkpoint already covers them.
  const onIssueComplete: FetchDeps['onIssueComplete'] = args.flags.checkpoint
    ? (checkpoint) =>
        commitAndPushIssueCheckpoint(archiveRoot, checkpoint, { push: true })
    : undefined;

  // Page-level cadence (`--checkpoint-every <N>`, default 1) applies ONLY to
  // a MONOGRAPH source -- a periodical's issues are already bounded, so they
  // keep the per-issue-only behavior above (`onPageStored` stays undefined).
  // `args.options.sourceId` may be absent/unregistered at this point for
  // commands that do not need it; that is caught later by `requireOption`/
  // `sourceLayout`, so it is treated as "not a monograph" here rather than
  // thrown on -- this function must stay side-effect-free on that path.
  let onPageStored: FetchDeps['onPageStored'];
  if (args.flags.checkpoint && args.options.sourceId !== undefined) {
    const isMonograph = sourceLayout(args.options.sourceId).kind === 'monograph';
    if (isMonograph) {
      const checkpointEvery = args.options.checkpointEvery ?? 1;
      onPageStored = buildMonographPageCheckpointHook(
        archiveRoot,
        checkpointEvery,
        commitAndPushIssueCheckpoint,
      );
    }
  }

  return {
    client: new GallicaHttpClient(http),
    repoRoot,
    archiveRoot,
    clock: () => new Date(),
    builtAt: new Date().toISOString().slice(0, 10),
    log: (message) => {
      console.log(message);
    },
    ocrPreflight: () => assertOcrToolchain(),
    ocrRunner: defaultOcrCommandRunner(),
    objectStore,
    objectStoreCoords,
    onIssueComplete,
    onPageStored,
  };
}

/** Require a named string option, failing loud when absent/blank. */
export function requireOption(
  value: string | undefined,
  name: string,
  command: string,
): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${command}: --${name} is required`);
  }
  return value;
}

/** The slug for a source: explicit `--slug` wins, else the registered layout's. */
export function resolveSlug(sourceId: string, explicit: string | undefined): string {
  if (explicit !== undefined && explicit.trim().length > 0) {
    return explicit;
  }
  return sourceLayout(sourceId).slug;
}

/** Human-readable byte size, e.g. `12.3 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** Drop the `ark:/12148/` namespace so directory names use the bare ark. */
export function bareArk(issueArk: string): string {
  return issueArk.replace(/^ark:\/12148\//, '');
}

/**
 * Dry-run report for one document (a periodical issue or a monograph):
 * resolve (non-throwing) rights, print status and the target directory, and —
 * for public-domain documents — a sampled size estimate. Returns the
 * estimated bytes to accumulate (0 when not PD). Shared between the
 * periodical and monograph dry-run paths so the reporting logic is not
 * duplicated between the two source kinds.
 */
export async function dryRunDocument(
  deps: FetchDeps,
  documentArk: string,
  dir: string,
): Promise<number> {
  const rights = await resolveRights(documentArk, deps.client);
  if (rights.status !== 'public-domain') {
    deps.log(
      `  ${documentArk}  rights=${rights.status}  -> REFUSE (no download)  ${dir}`,
    );
    return 0;
  }
  const estimate = await estimateIssue(documentArk, deps.client);
  deps.log(
    `  ${documentArk}  rights=public-domain  ${estimate.pageCount} page(s)  ` +
      `~${formatBytes(estimate.estimatedBytes)}  ${dir}`,
  );
  return estimate.estimatedBytes;
}

/** Fetch one periodical issue's images into the archive; logs a per-issue summary. */
export async function realFetchIssue(
  deps: FetchDeps,
  sourceId: string,
  issueArk: string,
  date: string,
  flags: ParsedFlags,
): Promise<FetchIssueResult> {
  const result = await fetchIssue(issueArk, {
    client: deps.client,
    sourceId,
    date,
    archiveRoot: deps.archiveRoot,
    clock: deps.clock,
    force: flags.force,
    log: deps.log,
    objectStore: deps.objectStore,
    objectStoreCoords: deps.objectStoreCoords,
    onPageStored: deps.onPageStored,
  });
  deps.log(
    `fetch-issue: ${result.issueArk} -> ${result.dir} :: ` +
      `${result.pageCount} page(s), ` +
      `${result.pages.length - result.skippedCount} written ` +
      `(${formatBytes(result.bytesWritten)}), ` +
      `${result.skippedCount} skipped`,
  );
  return result;
}

/**
 * Fetch a monograph source's single document into the archive (FR-016); logs
 * a summary. Reuses {@link fetchMonograph}, which shares its per-page
 * pipeline with {@link fetchIssue} (see `src/fetch/issue.ts`).
 */
export async function realFetchMonograph(
  deps: FetchDeps,
  sourceId: string,
  documentArk: string,
  flags: ParsedFlags,
): Promise<FetchIssueResult> {
  const result = await fetchMonograph(documentArk, {
    client: deps.client,
    sourceId,
    archiveRoot: deps.archiveRoot,
    clock: deps.clock,
    force: flags.force,
    log: deps.log,
    objectStore: deps.objectStore,
    objectStoreCoords: deps.objectStoreCoords,
    onPageStored: deps.onPageStored,
  });
  deps.log(
    `fetch-source (monograph): ${result.issueArk} -> ${result.dir} :: ` +
      `${result.pageCount} page(s), ` +
      `${result.pages.length - result.skippedCount} written ` +
      `(${formatBytes(result.bytesWritten)}), ` +
      `${result.skippedCount} skipped`,
  );
  return result;
}

/**
 * Run OCR (T030) against a just-fetched issue/document directory, wired in
 * via `--ocr` (T031). The preflight (T029) has already run by the time this
 * is called -- see the `runFetchIssue`/`runFetchSource` callers.
 */
export async function runOcrForIssue(
  deps: FetchDeps,
  issueDirPath: string,
  flags: ParsedFlags,
): Promise<void> {
  const result = await ocrIssue(issueDirPath, {
    runner: deps.ocrRunner,
    archiveRoot: deps.archiveRoot,
    clock: deps.clock,
    force: flags.force,
    log: deps.log,
  });
  deps.log(
    `  ocr   ${result.text.path} (${result.text.skipped ? 'skipped' : 'written'})`,
  );
}

/**
 * Re-hash every `f<NNN>.jpg` present in a directory; returns mismatch count.
 *
 * When `objectStore` is supplied (the `--object-store` backend is enabled),
 * each object-store-backed page is verified against its B2 master rather than
 * the local file (FR-008, SC-002/SC-004) -- a legacy page with
 * `object_store: null` still falls back to local verification, handled by
 * {@link verifyAsset} itself.
 */
export async function verifyIssueDir(
  dir: string,
  log: (message: string) => void,
  objectStore?: ObjectStore,
): Promise<number> {
  if (!existsSync(dir)) {
    log(`  verify: no archive directory ${dir} (nothing fetched yet)`);
    return 0;
  }
  const pageFiles = readdirSync(dir)
    .filter((name) => /^f\d+\.jpg$/.test(name))
    .sort();
  if (pageFiles.length === 0) {
    log(`  verify: no page images in ${dir}`);
    return 0;
  }
  let mismatches = 0;
  for (const name of pageFiles) {
    const result = await verifyAsset(path.join(dir, name), { objectStore });
    if (result.ok) {
      log(`  ok    ${name}`);
    } else {
      mismatches += 1;
      log(`  BAD   ${name} recorded=${result.recorded} actual=${result.actual}`);
    }
  }
  log(`  verify: ${pageFiles.length} page(s), ${mismatches} mismatch(es)`);
  return mismatches;
}
