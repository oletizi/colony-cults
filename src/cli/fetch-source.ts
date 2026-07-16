import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ParsedArgs } from '@/cli/parse';
import { sourceKind } from '@/bibliography/load';
import { issueDir, monographDir, sourceLayout } from '@/archive/location';
import { buildCensus } from '@/census/build';
import { serializeCensus } from '@/census/serialize';
import { loadCensus } from '@/census/load';
import { censusPath } from '@/cli/census';
import type { Census } from '@/model/census';
import type { IssueCheckpoint } from '@/cli/archive-checkpoint';
import { parseFolioRange } from '@/fetch/folio-range';
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

  // Guardrail (TASK-3 / contracts/fetch-guardrail.md): a Source Group has no
  // archival object of its own to fetch. Key on the SSOT canonical `kind`
  // (FR-003), NOT on `sourceLayout`'s registry -- an unregistered group would
  // otherwise surface the opaque "no archive layout registered" error instead
  // of this actionable redirect. Must run BEFORE `sourceLayout` is consulted.
  const sourcesDir = path.join(deps.repoRoot, 'bibliography', 'sources');
  if (sourceKind(sourceId, sourcesDir) === 'source-group') {
    throw new Error(
      `fetch-source: "${sourceId}" is a Source Group — it has no archival object to fetch. ` +
        `Discover and inventory its members, then fetch the members.`,
    );
  }

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
 *
 * `--pages <spec>` (spec 012, T009): parsed with {@link parseFolioRange} --
 * fail loud (malformed spec throws before any I/O) -- and threaded through to
 * both the dry-run estimate and the real fetch, so the whole document/excerpt
 * distinction is honored consistently across `--dry-run`. Absent -> unchanged
 * whole-document behavior.
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

  const folios =
    args.options.pages !== undefined ? parseFolioRange(args.options.pages) : undefined;

  const dir = monographDir(sourceId, deps.archiveRoot);
  deps.log(`fetch-source: monograph ${sourceId} -> ${dir}`);

  if (args.flags.verify) {
    const mismatches = await verifyIssueDir(dir, deps.log, deps.objectStore);
    if (mismatches > 0) {
      throw new Error(
        `fetch-source: ${mismatches} checksum mismatch(es) for ${sourceId}`,
      );
    }
    return;
  }

  if (args.flags.dryRun) {
    const estimated = await dryRunDocument(deps, documentArk, dir, folios);
    deps.log(
      `fetch-source (dry-run): estimated total ~${formatBytes(estimated)} ` +
        `for monograph ${sourceId}; wrote nothing`,
    );
    return;
  }

  const result = await realFetchMonograph(deps, sourceId, documentArk, args.flags, folios);
  if (args.flags.ocr) {
    await runOcrForIssue(deps, result.dir, args.flags);
  }
  // A monograph is a single document, so it gets ONE checkpoint (commit+push)
  // after the whole document is fetched -- unlike the periodical loop, there
  // is no per-issue date to carry (`IssueCheckpoint.date` is optional exactly
  // for this case; see `src/cli/archive-checkpoint.ts`).
  const checkpoint: IssueCheckpoint = {
    sourceId,
    ark: documentArk,
    dir: result.dir,
    pageCount: result.pageCount,
    written: result.pages.length - result.skippedCount,
    skipped: result.skippedCount,
  };
  await deps.onIssueComplete?.(checkpoint);
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
        verifyMismatches += await verifyIssueDir(dir, deps.log, deps.objectStore);
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
        const checkpoint: IssueCheckpoint = {
          sourceId,
          ark: issue.ark,
          date: issue.date,
          dir: result.dir,
          pageCount: result.pageCount,
          written: result.pages.length - result.skippedCount,
          skipped: result.skippedCount,
        };
        await deps.onIssueComplete?.(checkpoint);
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
