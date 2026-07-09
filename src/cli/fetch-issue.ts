import { existsSync } from 'node:fs';
import type { ParsedArgs } from '@/cli/parse';
import { issueDir, sourceLayout } from '@/archive/location';
import { loadCensus } from '@/census/load';
import { censusPath } from '@/cli/census';
import {
  bareArk,
  defaultFetchDeps,
  dryRunDocument,
  realFetchIssue,
  requireOption,
  resolveSlug,
  runOcrForIssue,
  verifyIssueDir,
  type FetchDeps,
} from '@/cli/fetch-shared';

/**
 * `fetch-issue <issueArk> --source-id <id> [--slug <slug>]`.
 *
 * Rights-gated, resumable single-issue image fetch for a PERIODICAL source
 * (a monograph source has no per-issue arks; it throws here and points at
 * `fetch-source`, FR-016). `--dry-run` reports rights status + target path +
 * estimated size (writes nothing); `--verify` re-hashes existing pages
 * against their recorded checksums (no download).
 */
export async function runFetchIssue(
  args: ParsedArgs,
  deps: FetchDeps = defaultFetchDeps(args),
): Promise<void> {
  // SC-008 / AS2: an OCR-enabled run fails loud BEFORE any work when the
  // toolchain is missing; an images-only run (no --ocr) never calls this.
  if (args.flags.ocr) {
    await deps.ocrPreflight();
  }

  const issueArk = args.positional[0];
  if (issueArk === undefined) {
    throw new Error('fetch-issue: missing required argument <issueArk>');
  }
  const sourceId = requireOption(args.options.sourceId, 'source-id', 'fetch-issue');
  if (sourceLayout(sourceId).kind !== 'periodical') {
    throw new Error(
      `fetch-issue: source "${sourceId}" is a monograph (single document, ` +
        `no dated issues) -- use "fetch-source <documentArk> --source-id ` +
        `${sourceId}" instead`,
    );
  }
  const slug = resolveSlug(sourceId, args.options.slug);
  const date = await resolveIssueDate(deps, sourceId, slug, issueArk);

  if (args.flags.verify) {
    const dir = issueDir(sourceId, { ark: bareArk(issueArk), date }, deps.archiveRoot);
    deps.log(`fetch-issue (verify): ${issueArk}`);
    const mismatches = await verifyIssueDir(dir, deps.log, deps.objectStore);
    if (mismatches > 0) {
      throw new Error(
        `fetch-issue: ${mismatches} checksum mismatch(es) for ${issueArk}`,
      );
    }
    return;
  }

  if (args.flags.dryRun) {
    deps.log(`fetch-issue (dry-run): ${issueArk}`);
    const dir = issueDir(sourceId, { ark: bareArk(issueArk), date }, deps.archiveRoot);
    await dryRunDocument(deps, issueArk, dir);
    return;
  }

  const result = await realFetchIssue(deps, sourceId, issueArk, date, args.flags);
  if (args.flags.ocr) {
    await runOcrForIssue(deps, result.dir, args.flags);
  }
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
  const bare = bareArk(issueArk);
  const file = censusPath(deps.repoRoot, sourceId, slug);
  if (existsSync(file)) {
    const census = loadCensus(file);
    const match = census.issues.find((issue) => issue.ark === bare);
    if (match !== undefined) {
      return match.date;
    }
  }
  return deps.client.issueDate(issueArk);
}
