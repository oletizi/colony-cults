import { existsSync } from 'node:fs';
import { assertInsideArchive } from '@/archive/location';
import { companionYamlPath, storeAsset } from '@/archive/store';
import { readProvenance, type InputLayer } from '@/archive/provenance';
import { firstPageProvenanceYaml } from '@/translate/rights';
import { selectSummaryInput, type SelectedSummaryInput } from '@/summarize/select-input';
import {
  buildSummaryProvenance,
  issueConciseSummaryPath,
  issueThoroughSummaryPath,
  renderConciseMarkdown,
  renderThoroughMarkdown,
} from '@/summarize/artifacts';
import type { SummarizationRunner } from '@/summarize/types';

/**
 * Injected dependencies for {@link summarizeIssue} (composition, not
 * inheritance), mirroring `OcrContext` (`src/ocr/run.ts`) /
 * `TranslateIssueCtx` (`src/translate/issue.ts`): a swappable engine, the
 * archive write root, a clock for provenance timestamps, a log sink, and the
 * `force`/`dryRun` run modifiers.
 */
export interface SummarizeIssueCtx {
  /** Injected summarization engine (the `claude` CLI adapter, or a fake in tests). */
  runner: SummarizationRunner;
  /**
   * Resolved model id/alias for this run (CLI flag > config > default; see
   * `resolveSummaryModel`), the exact value sent to `runner.summarize` AND
   * recorded in each artifact's provenance.
   */
  model: string;
  /** Absolute private-archive root (all writes are guarded inside it). */
  archiveRoot: string;
  /** Clock for the `retrieved` provenance timestamp (determinism/testability). */
  clock: () => Date;
  /** Line-oriented progress sink. */
  log: (message: string) => void;
  /** Regenerate even when the input layers are unchanged since the last run (FR-010). */
  force?: boolean;
  /**
   * Resolve inputs and report the intended work instead of performing it
   * (contracts/cli-summarize.md `--dry-run`): never calls `runner.summarize`,
   * never writes anything. Defaults to `false` (the normal, executing path).
   */
  dryRun?: boolean;
}

/** Terminal classification of one {@link summarizeIssue} call. */
export type SummarizeIssueStatus = 'generated' | 'skipped' | 'dry-run';

/** Outcome of one {@link summarizeIssue} call. */
export interface SummarizeIssueResult {
  /** The issue directory summarization ran against. */
  issueDir: string;
  /** Terminal classification: a real generation, an idempotent skip, or a dry-run report. */
  status: SummarizeIssueStatus;
  /** Absolute path of the thorough summary artifact (written only when `status === 'generated'`). */
  thoroughPath: string;
  /** Absolute path of the concise summary artifact (written only when `status === 'generated'`). */
  concisePath: string;
}

/** UTF-8 text -> bytes, for {@link storeAsset} (which re-derives the checksum). */
function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * True when the thorough summary artifact already on disk was generated from
 * the SAME input-layer paths + shas {@link selected} identifies (FR-010's
 * idempotency key) -- i.e. re-running would be redundant. A missing artifact,
 * a missing/unreadable sidecar, a missing `input_layers` block, or a
 * path/sha256 mismatch (in either order or count) all mean "not up to date";
 * this never throws, it only ever returns `false` on anything short of an
 * exact match.
 */
async function isUpToDate(
  issueDir: string,
  selected: SelectedSummaryInput,
): Promise<boolean> {
  const yamlPath = companionYamlPath(issueThoroughSummaryPath(issueDir));
  if (!existsSync(yamlPath)) {
    return false;
  }
  try {
    const existing = await readProvenance(yamlPath);
    const recorded = existing.input_layers;
    if (recorded === undefined || recorded.length !== selected.layers.length) {
      return false;
    }
    return selected.layers.every(
      (layer, i) => recorded[i]?.path === layer.path && recorded[i]?.sha256 === layer.sha256,
    );
  } catch {
    return false;
  }
}

/**
 * Generate one issue's two-depth summary from its best-available acquired
 * text (T018, US1, FR-001/002/003/004/005/010/016).
 *
 * FLOW:
 *  1. Guard the target directory (defense in depth; `storeAsset` re-checks
 *     the actual artifact targets below).
 *  2. {@link selectSummaryInput} (FR-002) -- FAILS LOUD (throws, writes
 *     nothing) when the issue has no usable text layer (FR-003, US1 AC-3).
 *  3. DRY-RUN (contracts/cli-summarize.md `--dry-run`): report the intended
 *     work and return -- never calls the runner, never writes.
 *  4. Idempotency (FR-010): when NOT forced and the existing thorough
 *     artifact's sidecar already records these exact input layers, skip --
 *     no engine call, no write.
 *  5. One `runner.summarize` call produces BOTH depths (FR-001, one
 *     full-text pass, two depths, so the concise can never disagree with the
 *     thorough it was distilled from).
 *  6. Derive the base citation/rights provenance from the issue's first page
 *     companion (same object-store-robust scan `translateIssue` uses --
 *     `firstPageProvenanceYaml`, `src/translate/rights.ts` -- so a page whose
 *     local image was migrated to the object store still resolves).
 *  7. Write BOTH artifacts via `storeAsset` ONLY (Constitution XV weld) --
 *     never a direct `fs.writeFile` of summary markdown.
 */
export async function summarizeIssue(
  issueDir: string,
  ctx: SummarizeIssueCtx,
): Promise<SummarizeIssueResult> {
  // Guard FIRST, before any filesystem interaction.
  assertInsideArchive(issueDir, ctx.archiveRoot);

  const thoroughPath = issueThoroughSummaryPath(issueDir);
  const concisePath = issueConciseSummaryPath(issueDir);

  // FR-003 / US1 AC-3: fail loud, write nothing, when no usable text exists.
  const selected = await selectSummaryInput(issueDir);

  if (ctx.dryRun === true) {
    const layerNames = selected.layers.map((layer) => layer.path).join(', ');
    ctx.log(
      `summarize (dry-run): ${issueDir} -- would generate from [${layerNames}]`,
    );
    return { issueDir, status: 'dry-run', thoroughPath, concisePath };
  }

  if (ctx.force !== true && (await isUpToDate(issueDir, selected))) {
    ctx.log(`  skip  ${issueDir} (input layers unchanged)`);
    return { issueDir, status: 'skipped', thoroughPath, concisePath };
  }

  const generated = await ctx.runner.summarize(selected.text, ctx.model);

  const base = await readProvenance(await firstPageProvenanceYaml(issueDir));
  const retrieved = ctx.clock().toISOString();
  const inputLayers: InputLayer[] = selected.layers.map((layer) => ({
    path: layer.path,
    sha256: layer.sha256,
  }));

  const thoroughProvenance = buildSummaryProvenance(
    base,
    'thorough',
    ctx.runner.name,
    ctx.model,
    retrieved,
    inputLayers,
    selected.inputQuality,
  );
  const conciseProvenance = buildSummaryProvenance(
    base,
    'concise',
    ctx.runner.name,
    ctx.model,
    retrieved,
    inputLayers,
    selected.inputQuality,
  );

  // Constitution XV weld: BOTH artifacts go through storeAsset, which writes
  // the bytes + companion sidecar + MANIFEST.sha256 entry as one operation.
  await storeAsset(
    encode(renderThoroughMarkdown(generated)),
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

  ctx.log(`  summarize  ${issueDir} -> generated (thorough + concise)`);

  return { issueDir, status: 'generated', thoroughPath, concisePath };
}
