import { assertInsideArchive } from '@/archive/location';
import { storeAsset } from '@/archive/store';
import { readProvenance, type InputLayer } from '@/archive/provenance';
import { firstPageProvenanceYaml } from '@/translate/rights';
import { selectSummaryInput } from '@/summarize/select-input';
import { summaryIsUpToDate } from '@/summarize/idempotency';
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
 *  4. Idempotency (FR-010, `@/summarize/idempotency`): when NOT forced and
 *     {@link summaryIsUpToDate} reports the existing thorough artifact's
 *     sidecar already records these exact input layers, skip -- no engine
 *     call, no write.
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

  if (ctx.force !== true && (await summaryIsUpToDate(issueDir, selected.layers))) {
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
  //
  // `force: true` here (NOT `ctx.force`) is deliberate: the regenerate-vs-skip
  // decision already happened above via `summaryIsUpToDate`, so reaching this
  // line always means "write". `storeAsset`'s OWN legacy byte-level dedup
  // (skip when the target's on-disk bytes already hash to what its companion
  // records) exists for a different case -- resuming an interrupted fetch --
  // and must NOT be allowed to veto this write: a regeneration triggered by a
  // changed input layer (FR-010 US5 AC-2) must always land its updated
  // `input_layers` provenance, even on the rare occasion the newly generated
  // markdown bytes happen to coincide with what is already on disk.
  await storeAsset(
    encode(renderThoroughMarkdown(generated)),
    thoroughPath,
    thoroughProvenance,
    ctx.archiveRoot,
    { force: true },
  );
  await storeAsset(
    encode(renderConciseMarkdown(generated)),
    concisePath,
    conciseProvenance,
    ctx.archiveRoot,
    { force: true },
  );

  ctx.log(`  summarize  ${issueDir} -> generated (thorough + concise)`);

  return { issueDir, status: 'generated', thoroughPath, concisePath };
}
