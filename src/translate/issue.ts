import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { findIssueDir } from '@/archive/location';
import { readProvenance, type ProvenanceFields } from '@/archive/provenance';
import { companionYamlPath, isAssetRecorded, storeAsset } from '@/archive/store';
import type { TranslationEngine } from '@/engine/types';
import {
  buildTranslationProvenance,
  issueArtifactPath,
  pageArtifactPath,
  type TranslationKind,
} from '@/translate/artifacts';
import { cleanupPage } from '@/translate/cleanup';
import { assemble, splitPages } from '@/translate/pages';
import { readIssueRights } from '@/translate/rights';
import { translatePage } from '@/translate/translate-page';

/**
 * Model id recorded in a translation artifact's provenance when the run does
 * not pin one via `--model`. It is a provenance LABEL, not a guarantee of what
 * the `claude` CLI resolved: when `ctx.model` is undefined the per-page calls
 * let the engine pick its own default (see {@link TranslationEngine.run}), while the
 * artifact records this constant so every derived `.yml` names a model. A
 * `--model` value always overrides it, for both the calls and the record.
 *
 * The exact model-id spelling the installed `claude` CLI accepts is
 * re-confirmed against the running binary in T032.
 */
export const DEFAULT_MODEL = 'claude-opus-4-8';

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
  /** Model alias/id to pin for the run; recorded in provenance when set. */
  model?: string;
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
}

/** UTF-8 text -> bytes, for {@link storeAsset} (which re-derives the checksum). */
function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * Representative source-page provenance used as the base for every derived
 * translation artifact's `.yml` (citation, rights, ids). Mirrors how
 * `readIssueRights`/`ocr/run` pick "the first page": the lowest-numbered
 * `f###.jpg`, then its companion via {@link companionYamlPath}. Fails loud with
 * no fallback when the images or the companion are absent.
 */
async function firstPageProvenance(issueDir: string): Promise<ProvenanceFields> {
  const entries = await readdir(issueDir);
  const pages = entries.filter((name) => /^f\d{3}\.jpg$/.test(name)).sort();
  if (pages.length === 0) {
    throw new Error(
      `translateIssue: no page images (f###.jpg) found in ${issueDir} -- fetch its images first`,
    );
  }
  const yamlPath = companionYamlPath(path.join(issueDir, pages[0]));
  if (!existsSync(yamlPath)) {
    throw new Error(
      `translateIssue: no page provenance at "${yamlPath}" -- fetch its images first`,
    );
  }
  return readProvenance(yamlPath);
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
 *  1. Locate the issue dir offline (`findIssueDir`) -- a missing fetched issue
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
  const dir = findIssueDir(ctx.sourceId, issueArk, ctx.archiveRoot);

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

  // Resolve the run's model ONCE so the value sent to the engine and the value
  // recorded in provenance can never disagree (an omitted `--model` records
  // and "runs" DEFAULT_MODEL, not `undefined`).
  const model = ctx.model ?? DEFAULT_MODEL;

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

  for (let i = 1; i <= pagesTotal; i += 1) {
    const frPath = pageArtifactPath(dir, i, 'fr');
    const enPath = pageArtifactPath(dir, i, 'en');

    if (!needsWork[i - 1]) {
      ctx.log(`  skip  page ${i}/${pagesTotal} (already translated)`);
      pagesDone += 1;
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
