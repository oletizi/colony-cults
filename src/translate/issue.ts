import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveFetchedDir } from '@/archive/location';
import type { PageStored } from '@/cli/archive-checkpoint';
import { readProvenance, type ProvenanceFields } from '@/archive/provenance';
import { isAssetRecorded, storeAsset } from '@/archive/store';
import type { TranslationEngine } from '@/engine/types';
import {
  buildTranslationProvenance,
  issueArtifactPath,
  pageArtifactPath,
  type TranslationKind,
} from '@/translate/artifacts';
import { cleanupPage } from '@/translate/cleanup';
import { assemble, splitPages } from '@/translate/pages';
import { firstPageProvenanceYaml, readIssueRights } from '@/translate/rights';
import { translatePage } from '@/translate/translate-page';
import { translatableLength } from '@/translate/transform';

/** Per-issue outcome (data-model.md TranslateRunReport). */
export type IssueOutcome =
  | 'translated'
  | 'skipped'
  | 'refused'
  | 'failed'
  | 'incomplete';

/** One issue's result, accumulated by `translateSource` into a run report. */
export interface TranslateIssueResult {
  /** The issue ark this result is for. */
  ark: string;
  /** Terminal classification of the run for this issue. */
  outcome: IssueOutcome;
  /** Pages whose fr+en intermediates are present after the run. */
  pagesDone: number;
  /** Total page chunks derived from `issue.txt`. */
  pagesTotal: number;
  /** Human-readable detail for refused/failed/incomplete outcomes. */
  message?: string;
}

/**
 * Injected dependencies for {@link translateIssue} (composition, not
 * inheritance): the engine adapter, the archive location + write root, a clock
 * for provenance timestamps, the resumability/`--force` flag, an optional
 * pinned model, a log sink, and a preflight thunk.
 *
 * `preflight` is a thunk so the caller decides what "check the engine" means:
 * the CLI passes `() => assertClaudeAvailable()`; tests inject a spy. It fires
 * only AFTER the rights gate passes and BEFORE the first `claude` call, never
 * earlier (FR-009). `dryRun` (T027) short-circuits before it -- see
 * {@link translateIssue}'s DRY-RUN note.
 */
export interface TranslateIssueCtx {
  /** Engine adapter used for the cleanup + translation passes. */
  engine: TranslationEngine;
  /** Registered source id, e.g. `PB-P001`. */
  sourceId: string;
  /** Absolute private-archive root (all writes are guarded inside it). */
  archiveRoot: string;
  /** Clock for the `retrieved` provenance timestamp (determinism/testability). */
  clock: () => Date;
  /** Re-translate pages/issue that already have recorded artifacts (FR-011). */
  force: boolean;
  /**
   * Model alias/id for the run, resolved ONCE by the caller (CLI flag >
   * config > engine default; see `resolveModel`) so it is always the exact
   * value sent to the engine AND recorded in provenance -- never an
   * engine-specific fallback picked here.
   */
  model: string;
  /** Line-oriented progress sink. */
  log: (message: string) => void;
  /** Engine preflight (FR-009); fired once after the rights gate passes. */
  preflight: () => Promise<void>;
  /**
   * Report the intended work instead of performing it (FR-010/SC-007):
   * classify rights + skip/translate/refuse and RETURN, never calling
   * `preflight`, never calling `claude`, never writing anything. Defaults to
   * `false` (the normal, executing path) when omitted.
   */
  dryRun?: boolean;
  /**
   * Fired once per page AFTER its artifacts are on disk -- for the written,
   * blank, AND skip branches, so a resumed run still advances the checkpoint
   * cadence. Mirrors the acquisition pipeline's `FetchDeps.onPageStored`
   * (`@/cli/archive-checkpoint`): the translate core stays git-free and only
   * knows the hook TYPE; the CLI wires the real per-N-pages commit+push via
   * `buildMonographPageCheckpointHook` only under `--checkpoint`. Omitted (the
   * default) means no checkpointing, so tests/dry-runs never touch git.
   */
  onPageStored?: (stored: PageStored) => Promise<void>;
}

/** UTF-8 text -> bytes, for {@link storeAsset} (which re-derives the checksum). */
function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * Representative source-page provenance used as the base for every derived
 * translation artifact's `.yml` (citation, rights, ids). Reuses
 * {@link firstPageProvenanceYaml} -- the SAME first-page-companion scan the
 * rights gate uses -- so both stay object-store-robust (the migration removes
 * the local `f###.jpg` while keeping the `f###.yml` companion). Fails loud with
 * no fallback when no page provenance companion is present.
 */
async function firstPageProvenance(issueDir: string): Promise<ProvenanceFields> {
  return readProvenance(await firstPageProvenanceYaml(issueDir));
}

/**
 * Minimum "real word" character count for a page to be treated as having
 * translatable content -- measured as {@link translatableLength} (the summed
 * length of >=3-letter runs), NOT raw alphanumeric count.
 *
 * A genuine text page has hundreds. Two kinds of page fall far below and MUST
 * be recorded as blank rather than sent to the engine:
 *  - truly blank / scan-condition pages (e.g. "Contraste insuffisant\nNF Z
 *    43-120-14");
 *  - illustration/map/plate pages whose OCR is dense NON-WORD noise (rotated
 *    engraving text mangled into fragments like "31 3HAVH  ZOPuŒŒ  % ANV").
 *    These clear a raw-alnum threshold (dozens of stray letters) yet contain no
 *    translatable words; the engine correctly returns an EMPTY result for them,
 *    which -- with no fallback -- would otherwise fail the whole document.
 * Using word-content (not raw alnum) as the measure catches BOTH.
 */
const BLANK_PAGE_MIN_WORD_CHARS = 40;

/**
 * True when a source page has no translatable WORD content -- empty,
 * whitespace, scan-condition artifacts, OR an illustration/plate page whose OCR
 * is dense non-word noise. Measured by {@link translatableLength} (>=3-letter
 * runs) so scattered single/double-character OCR garbage does not masquerade as
 * content and reach the engine (see {@link BLANK_PAGE_MIN_WORD_CHARS}).
 */
function isBlankPage(rawPage: string): boolean {
  return translatableLength(rawPage) < BLANK_PAGE_MIN_WORD_CHARS;
}

/**
 * Persist one translation artifact through the guarded store path. `model` is
 * the run's already-resolved model id (the exact value passed to the engine),
 * so the recorded provenance can never disagree with what actually ran.
 */
async function persist(
  text: string,
  targetPath: string,
  base: ProvenanceFields,
  kind: TranslationKind,
  model: string,
  ctx: TranslateIssueCtx,
): Promise<void> {
  const provenance = buildTranslationProvenance(
    base,
    kind,
    ctx.engine.name,
    model,
    ctx.clock().toISOString(),
  );
  await storeAsset(encode(text), targetPath, provenance, ctx.archiveRoot, {
    force: ctx.force,
  });
}

/**
 * Classify a dry-run's intended per-issue work (FR-010/SC-007) with no engine
 * call, no preflight, and no write. Called by {@link translateIssue} in place
 * of its normal rights-gate-then-pipeline flow when `ctx.dryRun` is true.
 *
 * Deliberately reads `issue.txt` + splits pages BEFORE deciding refused vs.
 * translated/skipped (unlike the normal path, which returns on a rights
 * refusal before ever touching `issue.txt`): a dry-run refusal still reports
 * the issue's real `pagesTotal`, so the caller sees the full shape of the
 * work it is choosing not to do. This does mean a dry-run on a refused issue
 * whose `issue.txt` is missing/empty THROWS (a hard precondition -- can't
 * classify what isn't fetched/OCR'd), same as the normal path would once it
 * got that far.
 */
async function classifyDryRun(
  issueArk: string,
  dir: string,
  ctx: TranslateIssueCtx,
): Promise<TranslateIssueResult> {
  const rights = await readIssueRights(ctx.sourceId, issueArk, ctx.archiveRoot);

  const issueTextPath = path.join(dir, 'issue.txt');
  if (!existsSync(issueTextPath)) {
    throw new Error(
      `translateIssue: missing issue.txt in ${dir} -- OCR the issue first`,
    );
  }
  const issueText = await readFile(issueTextPath, 'utf-8');
  if (issueText.trim().length === 0) {
    throw new Error(`translateIssue: issue.txt is empty in ${dir}`);
  }
  const pagesTotal = splitPages(issueText).length;

  if (rights.rights_status !== 'public-domain') {
    return {
      ark: issueArk,
      outcome: 'refused',
      pagesDone: 0,
      pagesTotal,
      message:
        `dry-run: would refuse -- rights_status is "${rights.rights_status}", ` +
        'not "public-domain" -- no translation would be written',
    };
  }

  let pagesDone = 0;
  for (let i = 1; i <= pagesTotal; i += 1) {
    const recorded =
      (await isAssetRecorded(pageArtifactPath(dir, i, 'fr'))) &&
      (await isAssetRecorded(pageArtifactPath(dir, i, 'en')));
    if (recorded) {
      pagesDone += 1;
    }
  }

  const wouldSkip = !ctx.force && pagesDone === pagesTotal;
  return {
    ark: issueArk,
    outcome: wouldSkip ? 'skipped' : 'translated',
    pagesDone,
    pagesTotal,
    message:
      `dry-run: rights_status is "${rights.rights_status}" -- ` +
      (wouldSkip ? 'would skip (already translated)' : 'would translate'),
  };
}

/**
 * Translate one already-fetched, OCR'd issue: cleanup -> translate per page,
 * persisted idempotently, then assemble the completed pages into whole-issue
 * `issue.fr.txt`/`issue.en.txt` (T016/T017, FR-002/008/009/011/012/013).
 *
 * GUARD-FIRST ORDER:
 *  1. Locate the issue/document dir offline (`resolveFetchedDir`, which
 *     branches periodical -> `findIssueDir`, monograph -> `monographDir`) --
 *     a missing fetched issue
 *     is a hard precondition, so its throw propagates.
 *  1a. DRY-RUN (FR-010): when `ctx.dryRun` is true, classify and RETURN right
 *     here via {@link classifyDryRun} -- before the rights-refusal
 *     early-return below, before `ctx.preflight()`, before any `claude` call,
 *     before any write. A dry-run therefore never requires the engine to be
 *     present (contract 1) and reports rather than hard-refuses on rights
 *     (contract 2).
 *  2. Rights gate (FR-008): refuse (write nothing) unless the source page
 *     provenance is `public-domain`. Returns `refused` -- never throws -- so
 *     `translateSource` can record it and carry on; the single-issue CLI turns
 *     `refused` into a non-zero exit.
 *  3. Read `issue.txt` (fail loud if missing/empty, FR-002); derive the base
 *     provenance and the page chunks.
 *  4. Preflight the engine (FR-009): after the rights gate, before any call.
 *  5. Per page, idempotent-skip already-recorded intermediates (FR-011/012);
 *     otherwise run BOTH passes and persist BOTH only after both succeed -- a
 *     failed page never leaves a partial/fabricated artifact (FR-013).
 *  6. Assemble the completed pages (read back from disk, so a resumed run
 *     includes previously-done pages) into the whole-issue artifacts.
 *  7. Classify the outcome. Page/engine failures are returned as
 *     failed/incomplete (never thrown); only hard precondition errors throw.
 */
export async function translateIssue(
  issueArk: string,
  ctx: TranslateIssueCtx,
): Promise<TranslateIssueResult> {
  // 1. Locate (hard precondition -- let a missing issue throw).
  const dir = resolveFetchedDir(ctx.sourceId, issueArk, ctx.archiveRoot);

  // 1a. DRY-RUN (FR-010): classify + return, never reaching the rights
  //     early-return, `ctx.preflight()`, the engine, or any write.
  if (ctx.dryRun === true) {
    return classifyDryRun(issueArk, dir, ctx);
  }

  // 2. Rights gate (FR-008): write nothing, return `refused`.
  const rights = await readIssueRights(ctx.sourceId, issueArk, ctx.archiveRoot);
  if (rights.rights_status !== 'public-domain') {
    return {
      ark: issueArk,
      outcome: 'refused',
      pagesDone: 0,
      pagesTotal: 0,
      message:
        `refused: rights_status is "${rights.rights_status}", not ` +
        `"public-domain" -- no translation written`,
    };
  }

  // 3. Input (FR-002) + base provenance + page chunks.
  const issueTextPath = path.join(dir, 'issue.txt');
  if (!existsSync(issueTextPath)) {
    throw new Error(
      `translateIssue: missing issue.txt in ${dir} -- OCR the issue first`,
    );
  }
  const issueText = await readFile(issueTextPath, 'utf-8');
  if (issueText.trim().length === 0) {
    throw new Error(`translateIssue: issue.txt is empty in ${dir}`);
  }
  const base = await firstPageProvenance(dir);
  const pages = splitPages(issueText);
  const pagesTotal = pages.length;

  // `ctx.model` is already the run's fully-resolved model (required on the
  // ctx; see its doc comment), so the value sent to the engine and the value
  // recorded in provenance can never disagree.
  const model = ctx.model;

  // Plan the work up front: a page needs work when forced, or when either of
  // its fr/en intermediates is not yet recorded (FR-011/012). This decides
  // BOTH whether to preflight and whether the loop below (re)translates it.
  const needsWork: boolean[] = [];
  for (let i = 1; i <= pagesTotal; i += 1) {
    if (ctx.force) {
      needsWork.push(true);
      continue;
    }
    const recorded =
      (await isAssetRecorded(pageArtifactPath(dir, i, 'fr'))) &&
      (await isAssetRecorded(pageArtifactPath(dir, i, 'en')));
    needsWork.push(!recorded);
  }
  const anyNeedsWork = needsWork.some((w) => w);

  // 4. Preflight the engine (FR-009) ONLY when a real translation will run --
  //    a full skip touches neither the preflight nor the engine (contract 1).
  if (anyNeedsWork) {
    await ctx.preflight();
  }

  // 5. Per-page cleanup -> translate, idempotent + fail-loud-per-issue.
  let pagesDone = 0;
  let workDone = false;
  let pageError: Error | undefined;

  // Checkpoint hook (no-op unless the CLI wired `--checkpoint`): fired after a
  // page's artifacts are on disk so the commit stages a consistent snapshot.
  const firePageStored = async (page: number, skipped: boolean): Promise<void> => {
    await ctx.onPageStored?.({
      sourceId: ctx.sourceId,
      ark: issueArk,
      dir,
      page,
      pageCount: pagesTotal,
      skipped,
    });
  };

  for (let i = 1; i <= pagesTotal; i += 1) {
    const frPath = pageArtifactPath(dir, i, 'fr');
    const enPath = pageArtifactPath(dir, i, 'en');

    if (!needsWork[i - 1]) {
      ctx.log(`  skip  page ${i}/${pagesTotal} (already translated)`);
      pagesDone += 1;
      await firePageStored(i, true);
      continue;
    }

    if (isBlankPage(pages[i - 1])) {
      // A blank / scan-artifact-only page has nothing to translate. Persist
      // empty artifacts and count it done rather than sending it to the engine
      // (whose empty output would fail the whole issue). Empty artifacts keep
      // the page idempotent-skippable on a re-run and let the whole-issue
      // assembly reflect the blank page faithfully (data-model.md: an empty
      // page chunk is reported, never fabricated).
      await persist('', frPath, base, 'corrected-french', model, ctx);
      await persist('', enPath, base, 'english', model, ctx);
      workDone = true;
      pagesDone += 1;
      ctx.log(`  blank page ${i}/${pagesTotal} (no translatable content)`);
      await firePageStored(i, false);
      continue;
    }

    try {
      // Both passes must succeed before either artifact is written (FR-013).
      const corrected = await cleanupPage(ctx.engine, pages[i - 1], model);
      const english = await translatePage(ctx.engine, corrected, model);
      await persist(corrected, frPath, base, 'corrected-french', model, ctx);
      await persist(english, enPath, base, 'english', model, ctx);
      workDone = true;
      pagesDone += 1;
      ctx.log(`  ok    page ${i}/${pagesTotal}`);
      await firePageStored(i, false);
    } catch (error) {
      // A page pipeline error stops THIS issue without throwing, so
      // translateSource can record the outcome and continue (FR-015/017).
      pageError = error instanceof Error ? error : new Error(String(error));
      ctx.log(`  fail  page ${i}/${pagesTotal}: ${pageError.message}`);
      break;
    }
  }

  // 6. Assemble the COMPLETED (contiguous) pages into whole-issue artifacts.
  //    Reading back from disk means a resumed run includes prior pages, and the
  //    whole-issue text reflects only completed pages (data-model.md).
  const frPages: string[] = [];
  const enPages: string[] = [];
  for (let i = 1; i <= pagesTotal; i += 1) {
    const frPath = pageArtifactPath(dir, i, 'fr');
    const enPath = pageArtifactPath(dir, i, 'en');
    if (!existsSync(frPath) || !existsSync(enPath)) {
      break;
    }
    frPages.push(await readFile(frPath, 'utf-8'));
    enPages.push(await readFile(enPath, 'utf-8'));
  }
  if (frPages.length > 0) {
    await persist(
      assemble(frPages),
      issueArtifactPath(dir, 'fr'),
      base,
      'corrected-french',
      model,
      ctx,
    );
    await persist(
      assemble(enPages),
      issueArtifactPath(dir, 'en'),
      base,
      'english',
      model,
      ctx,
    );
  }

  // 7. Classify the outcome.
  if (pageError !== undefined) {
    return {
      ark: issueArk,
      outcome: pagesDone > 0 ? 'incomplete' : 'failed',
      pagesDone,
      pagesTotal,
      message: pageError.message,
    };
  }
  return {
    ark: issueArk,
    // All pages present: `translated` if this run produced any, else the issue
    // was already fully translated and left untouched (`skipped`, no calls).
    outcome: workDone ? 'translated' : 'skipped',
    pagesDone,
    pagesTotal,
  };
}
