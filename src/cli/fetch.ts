import { existsSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ParsedArgs, ParsedFlags } from '@/cli/parse';
import type {
  GallicaClient,
  IssueMetaClient,
} from '@/gallica/gallica-client';
import { GallicaHttpClient } from '@/gallica/gallica-client';
import { HttpClient } from '@/gallica/http-client';
import { resolveArchiveRoot, issueDir, sourceLayout } from '@/archive/location';
import { verifyAsset } from '@/archive/store';
import { resolveRights } from '@/rights/gate';
import { buildCensus } from '@/census/build';
import { serializeCensus } from '@/census/serialize';
import { loadCensus } from '@/census/load';
import { censusPath } from '@/cli/census';
import { fetchIssue, type FetchClient } from '@/fetch/issue';
import { estimateIssue } from '@/fetch/estimate';
import type { Census } from '@/model/census';

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
}

/** Build the default (real network + disk) dependencies. */
export function defaultFetchDeps(): FetchDeps {
  const repoRoot = process.cwd();
  const http = new HttpClient();
  return {
    client: new GallicaHttpClient(http),
    repoRoot,
    archiveRoot: resolveArchiveRoot(repoRoot),
    clock: () => new Date(),
    builtAt: new Date().toISOString().slice(0, 10),
    log: (message) => {
      console.log(message);
    },
  };
}

/** Require a named string option, failing loud when absent/blank. */
function requireOption(
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
function resolveSlug(sourceId: string, explicit: string | undefined): string {
  if (explicit !== undefined && explicit.trim().length > 0) {
    return explicit;
  }
  return sourceLayout(sourceId).slug;
}

/** Human-readable byte size, e.g. `12.3 MB`. */
function formatBytes(bytes: number): string {
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

/**
 * Resolve an issue's `YYYY-MM-DD` date for its archive directory name: prefer
 * an on-disk census (offline, deterministic); else ask the host (OAIRecord
 * `dc:date`). A census that exists but omits the ark falls through to the host.
 */
async function resolveIssueDate(
  deps: FetchDeps,
  sourceId: string,
  slug: string,
  issueArk: string,
): Promise<string> {
  const bareArk = issueArk.replace(/^ark:\/12148\//, '');
  const file = censusPath(deps.repoRoot, sourceId, slug);
  if (existsSync(file)) {
    const census = loadCensus(file);
    const match = census.issues.find((issue) => issue.ark === bareArk);
    if (match !== undefined) {
      return match.date;
    }
  }
  return deps.client.issueDate(issueArk);
}

/** Load the source census, building (and persisting) it first when absent. */
async function loadOrBuildCensus(
  deps: FetchDeps,
  periodicalArk: string,
  sourceId: string,
  slug: string,
): Promise<Census> {
  const file = censusPath(deps.repoRoot, sourceId, slug);
  if (existsSync(file)) {
    deps.log(`fetch-source: using existing census ${file}`);
    return loadCensus(file);
  }
  deps.log(`fetch-source: census absent; building ${file}`);
  const census = await buildCensus(
    periodicalArk,
    deps.client,
    sourceId,
    deps.builtAt,
  );
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, serializeCensus(census), 'utf-8');
  return census;
}

/**
 * Dry-run report for one issue: resolve (non-throwing) rights, print status and
 * the target directory, and — for public-domain issues — a sampled size
 * estimate. Returns the estimated bytes to accumulate (0 when not PD).
 */
async function dryRunIssue(
  deps: FetchDeps,
  sourceId: string,
  issueArk: string,
  date: string,
): Promise<number> {
  const dir = issueDir(sourceId, { ark: bareArk(issueArk), date }, deps.archiveRoot);
  const rights = await resolveRights(issueArk, deps.client);
  if (rights.status !== 'public-domain') {
    deps.log(
      `  ${issueArk}  rights=${rights.status}  -> REFUSE (no download)  ${dir}`,
    );
    return 0;
  }
  const estimate = await estimateIssue(issueArk, deps.client);
  deps.log(
    `  ${issueArk}  rights=public-domain  ${estimate.pageCount} page(s)  ` +
      `~${formatBytes(estimate.estimatedBytes)}  ${dir}`,
  );
  return estimate.estimatedBytes;
}

/** Drop the `ark:/12148/` namespace so directory names use the bare ark. */
function bareArk(issueArk: string): string {
  return issueArk.replace(/^ark:\/12148\//, '');
}

/** Fetch one issue's images into the archive; logs a per-issue summary. */
async function realFetchIssue(
  deps: FetchDeps,
  sourceId: string,
  issueArk: string,
  date: string,
  flags: ParsedFlags,
): Promise<void> {
  const result = await fetchIssue(issueArk, {
    client: deps.client,
    sourceId,
    date,
    archiveRoot: deps.archiveRoot,
    clock: deps.clock,
    force: flags.force,
    log: deps.log,
  });
  deps.log(
    `fetch-issue: ${result.issueArk} -> ${result.dir} :: ` +
      `${result.pageCount} page(s), ` +
      `${result.pages.length - result.skippedCount} written ` +
      `(${formatBytes(result.bytesWritten)}), ` +
      `${result.skippedCount} skipped`,
  );
}

/**
 * `fetch-issue <issueArk> --source-id <id> [--slug <slug>]`.
 *
 * Rights-gated, resumable single-issue image fetch. `--dry-run` reports rights
 * status + target path + estimated size (writes nothing); `--verify` re-hashes
 * existing pages against their recorded checksums (no download).
 */
export async function runFetchIssue(
  args: ParsedArgs,
  deps: FetchDeps = defaultFetchDeps(),
): Promise<void> {
  const issueArk = args.positional[0];
  if (issueArk === undefined) {
    throw new Error('fetch-issue: missing required argument <issueArk>');
  }
  const sourceId = requireOption(args.options.sourceId, 'source-id', 'fetch-issue');
  const slug = resolveSlug(sourceId, args.options.slug);
  const date = await resolveIssueDate(deps, sourceId, slug, issueArk);

  if (args.flags.verify) {
    const dir = issueDir(sourceId, { ark: bareArk(issueArk), date }, deps.archiveRoot);
    deps.log(`fetch-issue (verify): ${issueArk}`);
    const mismatches = await verifyIssueDir(dir, deps.log);
    if (mismatches > 0) {
      throw new Error(
        `fetch-issue: ${mismatches} checksum mismatch(es) for ${issueArk}`,
      );
    }
    return;
  }

  if (args.flags.dryRun) {
    deps.log(`fetch-issue (dry-run): ${issueArk}`);
    await dryRunIssue(deps, sourceId, issueArk, date);
    return;
  }

  await realFetchIssue(deps, sourceId, issueArk, date, args.flags);
}

/**
 * `fetch-source <periodicalArk> --source-id <id> [--slug <slug>]`.
 *
 * Loads (or builds) the census, then iterates every issue — each independently
 * rights-gated and resumable. `--dry-run` prints per-issue rights + paths +
 * estimated total size; `--verify` re-hashes existing pages. A per-issue
 * failure is reported loudly and the run continues; the command exits non-zero
 * if any issue failed.
 */
export async function runFetchSource(
  args: ParsedArgs,
  deps: FetchDeps = defaultFetchDeps(),
): Promise<void> {
  const periodicalArk = args.positional[0];
  if (periodicalArk === undefined) {
    throw new Error('fetch-source: missing required argument <periodicalArk>');
  }
  const sourceId = requireOption(args.options.sourceId, 'source-id', 'fetch-source');
  const slug = resolveSlug(sourceId, args.options.slug);
  const census = await loadOrBuildCensus(deps, periodicalArk, sourceId, slug);

  deps.log(
    `fetch-source: ${census.issues.length} issue(s) for ${sourceId} ` +
      `(${slug})`,
  );

  const failures: string[] = [];
  let estimatedTotal = 0;
  let verifyMismatches = 0;

  for (const issue of census.issues) {
    try {
      if (args.flags.verify) {
        const dir = issueDir(
          sourceId,
          { ark: issue.ark, date: issue.date },
          deps.archiveRoot,
        );
        deps.log(`fetch-source (verify): ${issue.ark} (${issue.date})`);
        verifyMismatches += await verifyIssueDir(dir, deps.log);
      } else if (args.flags.dryRun) {
        estimatedTotal += await dryRunIssue(deps, sourceId, issue.ark, issue.date);
      } else {
        deps.log(`fetch-source: ${issue.ark} (${issue.date})`);
        await realFetchIssue(deps, sourceId, issue.ark, issue.date, args.flags);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      deps.log(`fetch-source: SKIP ${issue.ark} -- ${message}`);
      failures.push(`${issue.ark}: ${message}`);
    }
  }

  if (args.flags.dryRun) {
    deps.log(
      `fetch-source (dry-run): estimated total ~${formatBytes(estimatedTotal)} ` +
        `across ${census.issues.length} issue(s); wrote nothing`,
    );
  }
  if (args.flags.verify && verifyMismatches > 0) {
    failures.push(`${verifyMismatches} checksum mismatch(es)`);
  }
  if (failures.length > 0) {
    throw new Error(
      `fetch-source: ${failures.length} issue(s) failed:\n  ${failures.join('\n  ')}`,
    );
  }
}

/** Re-hash every `f<NNN>.jpg` present for an issue; returns mismatch count. */
async function verifyIssueDir(
  dir: string,
  log: (message: string) => void,
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
    const result = await verifyAsset(path.join(dir, name));
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
