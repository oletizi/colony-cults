import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ParsedArgs } from '@/cli/parse';
import { issueDir, monographDir, sourceLayout } from '@/archive/location';
import { buildCensus } from '@/census/build';
import { serializeCensus } from '@/census/serialize';
import { loadCensus } from '@/census/load';
import { censusPath } from '@/cli/census';
import type { Census } from '@/model/census';
import {
  defaultFetchDeps,
  dryRunDocument,
  formatBytes,
  realFetchIssue,
  realFetchMonograph,
  requireOption,
  resolveSlug,
  runOcrForIssue,
  verifyIssueDir,
  type FetchDeps,
} from '@/cli/fetch-shared';

/**
 * `fetch-source <ark> --source-id <id> [--slug <slug>]`.
 *
 * Dispatches on the source's registered `kind` (FR-016): a `periodical`
 * source (e.g. `PB-P001`) keeps the census-driven behavior in {@link
 * runFetchSourcePeriodical}; a `monograph` source (e.g. `PB-P002`/`PB-P003`)
 * has no census -- it fetches its single document directly (see {@link
 * runFetchSourceMonograph}).
 */
export async function runFetchSource(
  args: ParsedArgs,
  deps: FetchDeps = defaultFetchDeps(args),
): Promise<void> {
  const ark = args.positional[0];
  if (ark === undefined) {
    throw new Error('fetch-source: missing required argument <periodicalArk>');
  }
  const sourceId = requireOption(args.options.sourceId, 'source-id', 'fetch-source');

  if (sourceLayout(sourceId).kind === 'monograph') {
    await runFetchSourceMonograph(args, deps, sourceId, ark);
    return;
  }

  await runFetchSourcePeriodical(args, deps, sourceId, ark);
}

/**
 * Monograph branch of `fetch-source` (FR-016): no census, one document.
 * `--dry-run` reports rights + target dir + estimated size; `--verify`
 * re-hashes existing pages; otherwise fetches the single document via {@link
 * realFetchMonograph} (sharing its per-page pipeline with `fetch-issue`).
 */
async function runFetchSourceMonograph(
  args: ParsedArgs,
  deps: FetchDeps,
  sourceId: string,
  documentArk: string,
): Promise<void> {
  if (args.flags.ocr) {
    await deps.ocrPreflight();
  }

  const dir = monographDir(sourceId, deps.archiveRoot);
  deps.log(`fetch-source: monograph ${sourceId} -> ${dir}`);

  if (args.flags.verify) {
    const mismatches = await verifyIssueDir(dir, deps.log);
    if (mismatches > 0) {
      throw new Error(
        `fetch-source: ${mismatches} checksum mismatch(es) for ${sourceId}`,
      );
    }
    return;
  }

  if (args.flags.dryRun) {
    const estimated = await dryRunDocument(deps, documentArk, dir);
    deps.log(
      `fetch-source (dry-run): estimated total ~${formatBytes(estimated)} ` +
        `for monograph ${sourceId}; wrote nothing`,
    );
    return;
  }

  const result = await realFetchMonograph(deps, sourceId, documentArk, args.flags);
  if (args.flags.ocr) {
    await runOcrForIssue(deps, result.dir, args.flags);
  }
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
 * Periodical branch of `fetch-source`.
 *
 * Loads (or builds) the census, then iterates every issue — each independently
 * rights-gated and resumable. `--dry-run` prints per-issue rights + paths +
 * estimated total size; `--verify` re-hashes existing pages. A per-issue
 * failure is reported loudly and the run continues; the command exits non-zero
 * if any issue failed.
 */
async function runFetchSourcePeriodical(
  args: ParsedArgs,
  deps: FetchDeps,
  sourceId: string,
  periodicalArk: string,
): Promise<void> {
  // SC-008 / AS2: fail loud before any work when OCR is requested and the
  // toolchain is missing; never invoked for an images-only run.
  if (args.flags.ocr) {
    await deps.ocrPreflight();
  }

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
      const dir = issueDir(sourceId, { ark: issue.ark, date: issue.date }, deps.archiveRoot);
      if (args.flags.verify) {
        deps.log(`fetch-source (verify): ${issue.ark} (${issue.date})`);
        verifyMismatches += await verifyIssueDir(dir, deps.log);
      } else if (args.flags.dryRun) {
        estimatedTotal += await dryRunDocument(deps, issue.ark, dir);
      } else {
        deps.log(`fetch-source: ${issue.ark} (${issue.date})`);
        const result = await realFetchIssue(
          deps,
          sourceId,
          issue.ark,
          issue.date,
          args.flags,
        );
        if (args.flags.ocr) {
          await runOcrForIssue(deps, result.dir, args.flags);
        }
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
