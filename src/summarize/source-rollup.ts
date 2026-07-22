import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { assertInsideArchive, resolveFetchedDir, sourceRootDir } from '@/archive/location';
import { sha256OfBytes } from '@/archive/checksum';
import { companionYamlPath, storeAsset } from '@/archive/store';
import { readProvenance, type InputLayer } from '@/archive/provenance';
import { discoverIssueArks } from '@/translate/source';
import {
  buildSummaryProvenance,
  issueThoroughSummaryPath,
  renderConciseMarkdown,
  renderRollupThoroughMarkdown,
  sourceConciseSummaryPath,
  sourceThoroughSummaryPath,
} from '@/summarize/artifacts';
import type { SummarizationRunner } from '@/summarize/types';

/**
 * Injected dependencies for {@link summarizeSource} (composition, not
 * inheritance), mirroring `SummarizeIssueCtx` (`src/summarize/issue.ts`) --
 * minus per-issue idiosyncrasies, since a rollup makes exactly ONE engine
 * call regardless of how many issues it covers.
 */
export interface SummarizeSourceCtx {
  /** Injected summarization engine (the `claude` CLI adapter, or a fake in tests). */
  runner: SummarizationRunner;
  /** Resolved model id/alias for this run, sent to `runner.summarize` AND recorded in provenance. */
  model: string;
  /** Absolute private-archive root (all writes are guarded inside it). */
  archiveRoot: string;
  /** Clock for the `retrieved` provenance timestamp (determinism/testability). */
  clock: () => Date;
  /** Line-oriented progress sink. */
  log: (message: string) => void;
  /** Regenerate even when the covered/missing coverage set is unchanged since the last run. */
  force?: boolean;
  /**
   * Resolve coverage and report the intended work instead of performing it
   * (contracts/cli-summarize.md `--dry-run`): never calls `runner.summarize`,
   * never writes anything.
   */
  dryRun?: boolean;
}

/** Terminal classification of one {@link summarizeSource} call. */
export type SummarizeSourceStatus = 'generated' | 'skipped' | 'dry-run';

/** Outcome of one {@link summarizeSource} call. */
export interface SummarizeSourceResult {
  /** The source's own directory the rollup was written into. */
  sourceDir: string;
  /** Terminal classification: a real generation, an idempotent skip, or a dry-run report. */
  status: SummarizeSourceStatus;
  /** Absolute path of the rollup thorough summary artifact. */
  thoroughPath: string;
  /** Absolute path of the rollup concise summary artifact. */
  concisePath: string;
  /** Issue arks whose thorough summary was folded into this rollup, in discovery order. */
  coveredIssues: string[];
  /** Issue arks discovered for the source but not yet summarized. */
  missingIssues: string[];
}

/** One covered issue's already-generated thorough summary, gathered for the rollup. */
interface CoveredIssue {
  ark: string;
  /** Absolute path of the issue's thorough summary artifact. */
  thoroughPath: string;
  /** Archive-relative path of the issue's thorough summary artifact. */
  relPath: string;
  /** Content of the issue's thorough summary artifact (frontmatter + prose). */
  content: string;
  /** SHA-256 of `content`'s bytes at gather time (the rollup's idempotency key). */
  sha256: string;
}

/** Encode text to bytes and sha256 it in one pass (mirrors `summarizeIssue`'s `encode`). */
function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * Gather the source's existing per-issue THOROUGH summaries (cover-what-exists,
 * FR-009): every issue `discoverIssueArks` finds on disk is classified as
 * COVERED (its `issue.summary.long.en.md` already exists) or MISSING (it
 * doesn't -- not yet summarized). Never fails loud on a missing issue summary
 * -- that is the expected partial-coverage case this rollup exists to handle.
 */
async function gatherCoverage(
  sourceId: string,
  archiveRoot: string,
): Promise<{ covered: CoveredIssue[]; missing: string[] }> {
  const arks = discoverIssueArks(sourceId, archiveRoot);
  const covered: CoveredIssue[] = [];
  const missing: string[] = [];

  for (const ark of arks) {
    const issueDir = resolveFetchedDir(sourceId, ark, archiveRoot);
    const thoroughPath = issueThoroughSummaryPath(issueDir);
    if (!existsSync(thoroughPath)) {
      missing.push(ark);
      continue;
    }
    const bytes = await readFile(thoroughPath);
    const content = bytes.toString('utf-8');
    const relPath = path.relative(archiveRoot, thoroughPath).split(path.sep).join('/');
    covered.push({ ark, thoroughPath, relPath, content, sha256: sha256OfBytes(bytes) });
  }

  return { covered, missing };
}

/** Combine covered issues' thorough content into the rollup's synthesis input, one delimited section per issue. */
function combineIssueSummaries(covered: readonly CoveredIssue[]): string {
  return covered
    .map((issue) => `=== ISSUE ${issue.ark} (thorough summary) ===\n${issue.content}`)
    .join('\n\n');
}

/**
 * True when the existing rollup thorough artifact on disk was generated from
 * the SAME set of covered-issue thorough summaries (by path + content sha256)
 * {@link coveredLayers} identifies -- i.e. re-running would be redundant.
 * Mirrors `isUpToDate` in `src/summarize/issue.ts`; never throws, only ever
 * returns `false` short of an exact match.
 */
async function isUpToDate(sourceDir: string, coveredLayers: InputLayer[]): Promise<boolean> {
  const yamlPath = companionYamlPath(sourceThoroughSummaryPath(sourceDir));
  if (!existsSync(yamlPath)) {
    return false;
  }
  try {
    const existing = await readProvenance(yamlPath);
    const recorded = existing.input_layers;
    if (recorded === undefined || recorded.length !== coveredLayers.length) {
      return false;
    }
    return coveredLayers.every(
      (layer, i) => recorded[i]?.path === layer.path && recorded[i]?.sha256 === layer.sha256,
    );
  } catch {
    return false;
  }
}

/**
 * Generate a source's per-source ROLLUP two-depth summary from its existing
 * per-issue thorough summaries (T029, US4, FR-009).
 *
 * FLOW:
 *  1. Guard the target directory (defense in depth; `storeAsset` re-checks
 *     the actual artifact targets below).
 *  2. {@link gatherCoverage} (cover-what-exists) -- classifies every discovered
 *     issue as covered or missing; FAILS LOUD only when NOTHING is covered
 *     (there is nothing to roll up), never merely because coverage is partial
 *     (US4 AC-2).
 *  3. DRY-RUN: report the intended work and return -- never calls the runner,
 *     never writes.
 *  4. Idempotency: when NOT forced and the existing rollup thorough artifact's
 *     sidecar already records this exact covered-issue set (path + content
 *     sha256), skip -- no engine call, no write. A newly-covered or
 *     newly-missing issue changes this set, so a rollup re-run naturally picks
 *     up new coverage.
 *  5. One `runner.summarize` call over the combined covered-issue thorough
 *     content produces both rollup depths.
 *  6. Derive the base citation/rights provenance from the FIRST covered
 *     issue's already-built thorough-summary sidecar (itself derived from the
 *     issue's first-page provenance by `summarizeIssue`) -- no re-fetch, no
 *     new page scan.
 *  7. Write BOTH artifacts via `storeAsset` ONLY (Constitution XV weld) --
 *     never a direct `fs.writeFile` of summary markdown. `covered_issues` /
 *     `missing_issues` are recorded in the thorough markdown's frontmatter
 *     (`renderRollupThoroughMarkdown`) and summarized in the sidecar `notes`
 *     -- deliberately NOT a new `ProvenanceFields` key (see
 *     `renderRollupThoroughMarkdown`'s doc comment).
 */
export async function summarizeSource(
  sourceId: string,
  ctx: SummarizeSourceCtx,
): Promise<SummarizeSourceResult> {
  const sourceDir = sourceRootDir(sourceId, ctx.archiveRoot);
  // Guard FIRST, before any filesystem interaction.
  assertInsideArchive(sourceDir, ctx.archiveRoot);

  const thoroughPath = sourceThoroughSummaryPath(sourceDir);
  const concisePath = sourceConciseSummaryPath(sourceDir);

  const { covered, missing } = await gatherCoverage(sourceId, ctx.archiveRoot);

  if (covered.length === 0) {
    throw new Error(
      `summarizeSource: no per-issue thorough summaries found yet for source "${sourceId}" ` +
        `-- nothing to roll up (run "bib summarize ${sourceId}" first)`,
    );
  }

  const coveredArks = covered.map((issue) => issue.ark);

  if (ctx.dryRun === true) {
    ctx.log(
      `summarize-source (dry-run): ${sourceId} -- would generate from ` +
        `[covered: ${coveredArks.join(', ')}] (missing: ${missing.join(', ') || 'none'})`,
    );
    return {
      sourceDir,
      status: 'dry-run',
      thoroughPath,
      concisePath,
      coveredIssues: coveredArks,
      missingIssues: missing,
    };
  }

  const coveredLayers: InputLayer[] = covered.map((issue) => ({
    path: issue.relPath,
    sha256: issue.sha256,
  }));

  if (ctx.force !== true && (await isUpToDate(sourceDir, coveredLayers))) {
    ctx.log(`  skip  ${sourceId} rollup (covered issues unchanged)`);
    return {
      sourceDir,
      status: 'skipped',
      thoroughPath,
      concisePath,
      coveredIssues: coveredArks,
      missingIssues: missing,
    };
  }

  const generated = await ctx.runner.summarize(combineIssueSummaries(covered), ctx.model);

  const base = await readProvenance(companionYamlPath(covered[0].thoroughPath));
  const retrieved = ctx.clock().toISOString();
  const coverageNote =
    `Source rollup covers ${covered.length}/${covered.length + missing.length} issues. ` +
    `Missing: ${missing.length > 0 ? missing.join(', ') : 'none'}.`;

  const thoroughProvenance = {
    ...buildSummaryProvenance(base, 'thorough', ctx.runner.name, ctx.model, retrieved, coveredLayers),
    notes: coverageNote,
  };
  const conciseProvenance = {
    ...buildSummaryProvenance(base, 'concise', ctx.runner.name, ctx.model, retrieved, coveredLayers),
    notes: coverageNote,
  };

  // Constitution XV weld: BOTH artifacts go through storeAsset, which writes
  // the bytes + companion sidecar + MANIFEST.sha256 entry as one operation.
  await storeAsset(
    encode(renderRollupThoroughMarkdown(generated, coveredArks, missing)),
    thoroughPath,
    thoroughProvenance,
    ctx.archiveRoot,
    { force: ctx.force },
  );
  await storeAsset(
    encode(renderConciseMarkdown(generated)),
    concisePath,
    conciseProvenance,
    ctx.archiveRoot,
    { force: ctx.force },
  );

  ctx.log(
    `  summarize-source  ${sourceId} -> generated (covered ${covered.length}, missing ${missing.length})`,
  );

  return {
    sourceDir,
    status: 'generated',
    thoroughPath,
    concisePath,
    coveredIssues: coveredArks,
    missingIssues: missing,
  };
}
