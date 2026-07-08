import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { sourceLayout } from '@/archive/location';
import type { ClaudeCli } from '@/claude/client';
import { assertValidArk } from '@/gallica/ark';
import {
  translateIssue,
  type IssueOutcome,
  type TranslateIssueCtx,
  type TranslateIssueResult,
} from '@/translate/issue';

/**
 * Enumerate a source's already-fetched issue arks purely from what is on disk
 * (T022) -- the reverse of `findIssueDir` (`@/archive/location`), fanned out
 * over every issue directory instead of locating one by ark. This is what
 * `translateSource` (T023) uses to discover which issues exist for a source
 * without a census lookup or any network call.
 *
 * Resolves the source directory the same way `findIssueDir` does (via
 * `sourceLayout` -> `archive/cases/<case>/<type>/<slug>`). `sourceLayout`
 * throws (fail loud) for an unregistered source id -- that throw propagates
 * uncaught, since the layout is authoritative metadata, not a default.
 *
 * If the source directory itself does not exist (nothing has ever been
 * fetched for this source), throws a descriptive Error -- there is no
 * fallback to an empty result; "nothing found" and "nothing fetched yet" are
 * different conditions and must not be conflated.
 *
 * Lists the source directory's immediate entries, keeps only subdirectories
 * whose name ends in `_<bareArk>` (the fetcher's on-disk convention, see
 * `issueDir` in `@/archive/location`: `<date>_<ark>`), and extracts the ark as
 * the segment after the FINAL `_` (a slug/date prefix may itself contain
 * `_`... in practice it never does, but taking the last segment is the
 * correct inverse of how `findIssueDir` matches with `endsWith`). Any entry
 * that is not a directory, or whose post-underscore segment is not a
 * well-formed bare ark (see `assertValidArk`), is silently ignored -- it is
 * not a fetched-issue directory (e.g. a stray file, a `.git`-style dir, or an
 * in-progress/partial write left with an unexpected name).
 *
 * Ordering: directory names carry a `YYYY-MM-DD` date prefix, so sorting the
 * directory NAMES lexically also sorts the issues chronologically -- no
 * separate date parse is needed, and the order is deterministic across runs.
 */
export function discoverIssueArks(sourceId: string, archiveRoot: string): string[] {
  const layout = sourceLayout(sourceId);
  const sourceDir = path.join(
    archiveRoot,
    'archive',
    'cases',
    layout.case,
    layout.type,
    layout.slug,
  );
  if (!existsSync(sourceDir)) {
    throw new Error(
      `discoverIssueArks: no fetched issues found for source "${sourceId}" ` +
        `(missing ${sourceDir}) -- run fetch-issue/fetch-source first`,
    );
  }

  const dirNames = readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const arks: string[] = [];
  for (const name of dirNames) {
    const underscoreIndex = name.lastIndexOf('_');
    if (underscoreIndex === -1) {
      continue;
    }
    const candidate = name.slice(underscoreIndex + 1);
    try {
      arks.push(assertValidArk(candidate));
    } catch {
      // Not a valid bare-ark suffix -- not a fetched-issue directory; skip.
    }
  }
  return arks;
}

/**
 * Consecutive-issue-failure abort threshold (FR-017): once this many issues in
 * a row end in a FAILURE (see the classification in {@link translateSource}),
 * a whole-source run stops rather than grinding through every remaining issue
 * against what is almost certainly a systemic fault (engine down, bad auth,
 * archive corrupt). It is a count of CONSECUTIVE failures, not total failures --
 * any non-failure outcome resets the streak.
 */
export const CONSECUTIVE_FAILURE_ABORT = 3;

/**
 * Per-run outcome surface for a whole-source translation (data-model.md
 * TranslateRunReport, FR-015): one entry per issue actually processed, in
 * discovery (date-ascending) order, plus whether the run stopped early on the
 * consecutive-failure rule. `issues.length` is therefore the number of issues
 * ATTEMPTED, not the number that exist -- an aborted run omits the issues it
 * never reached.
 */
export interface TranslateRunReport {
  /** One entry per attempted issue, in discovery order. */
  issues: Array<{
    ark: string;
    outcome: IssueOutcome;
    pagesDone: number;
    pagesTotal: number;
    message?: string;
  }>;
  /** True iff the FR-017 threshold tripped and the run stopped early. */
  abortedOnConsecutiveFailures: boolean;
}

/**
 * Injected dependencies for {@link translateSource} (composition, not
 * inheritance). Mirrors {@link TranslateIssueCtx} minus `sourceId` (passed as
 * the call's first argument, so one ctx can drive any source) and plus
 * `delay`, the polite-pacing thunk between engine-invoking issues.
 *
 * `preflight` is passed straight through to every {@link translateIssue} call;
 * translateIssue itself fires it only when a page actually needs work, so a
 * fully-skipped issue touches neither the preflight nor the engine.
 *
 * `delay` is injected (not a hard-coded sleep) so tests can supply a no-op spy
 * and production can supply a real small delay; see the pacing rule in
 * {@link translateSource}.
 */
export interface TranslateSourceCtx {
  /** Engine adapter, forwarded to each issue. */
  claude: ClaudeCli;
  /** Absolute private-archive root (all writes guarded inside it). */
  archiveRoot: string;
  /** Clock for provenance timestamps (determinism/testability). */
  clock: () => Date;
  /** Re-translate issues/pages that already have artifacts (FR-011). */
  force: boolean;
  /** Model alias/id to pin for the run; recorded in provenance when set. */
  model?: string;
  /** Line-oriented progress sink. */
  log: (message: string) => void;
  /** Engine preflight (FR-009), forwarded to each issue. */
  preflight: () => Promise<void>;
  /** Polite pacing between engine-invoking issues (injected; see pacing rule). */
  delay: () => Promise<void>;
}

/**
 * Translate every already-fetched issue of a source (whole-source iterator,
 * contracts/cli.md behavior 5, FR-015/FR-017). Discovery is offline via
 * {@link discoverIssueArks}; there is no census lookup or network call.
 *
 * FLOW:
 *  1. Enumerate the source's issue arks (date-ascending). An unregistered
 *     source or one with nothing fetched THROWS from `discoverIssueArks` --
 *     that is a hard precondition and propagates uncaught (fail loud).
 *  2. For each ark, build a per-issue {@link TranslateIssueCtx} from this ctx +
 *     `sourceId` and call {@link translateIssue} inside a try/catch. A THROWN
 *     error is a hard per-issue precondition (missing issue.txt, etc.); it is
 *     recorded as an `outcome:'failed'` entry carrying the error message and
 *     does NOT abort the whole run -- it is fed into the consecutive-failure
 *     rule like any other failure.
 *  3. Every result (returned or synthesized-from-throw) is appended to the
 *     report in order.
 *
 * FAILURE / RESET CLASSIFICATION (FR-017):
 *  - A FAILURE (increments the consecutive counter) is `outcome ∈
 *    {'failed','incomplete'}` OR a thrown hard precondition.
 *  - A RESET (zeroes the counter) is `outcome ∈ {'translated','skipped',
 *    'refused'}`. `refused` is an EXPECTED rights-policy outcome (FR-008), not
 *    a fault, so it must not count toward or trip the abort; a source of purely
 *    in-copyright issues reports every issue `refused` and completes normally.
 *  When the consecutive count reaches {@link CONSECUTIVE_FAILURE_ABORT}, the run
 *  sets `abortedOnConsecutiveFailures = true`, stops WITHOUT processing the
 *  remaining issues, and returns.
 *
 * PACING RULE:
 *  - `delay()` is awaited AFTER an issue that INVOKED THE ENGINE, and only when
 *    another issue will follow it in the loop.
 *  - "Invoked the engine" = a returned result whose outcome is NOT `skipped`
 *    (fully idempotent, zero calls) and NOT `refused` (rights gate, zero calls),
 *    and NOT a thrown hard precondition (fails before the engine). A returned
 *    `failed`/`incomplete` DID invoke the engine (preflight + at least one page
 *    call ran before the page pipeline broke), so it paces.
 *  - No delay after the final processed issue, and none after an abort (the
 *    abort returns before the pacing step).
 */
export async function translateSource(
  sourceId: string,
  ctx: TranslateSourceCtx,
): Promise<TranslateRunReport> {
  // 1. Offline discovery. An unregistered source / nothing-fetched THROWS here
  //    and propagates -- a hard precondition, not a per-issue failure.
  const arks = discoverIssueArks(sourceId, ctx.archiveRoot);

  const report: TranslateRunReport = {
    issues: [],
    abortedOnConsecutiveFailures: false,
  };
  let consecutiveFailures = 0;

  for (let i = 0; i < arks.length; i += 1) {
    const ark = arks[i];
    const issueCtx: TranslateIssueCtx = {
      claude: ctx.claude,
      sourceId,
      archiveRoot: ctx.archiveRoot,
      clock: ctx.clock,
      force: ctx.force,
      model: ctx.model,
      log: ctx.log,
      preflight: ctx.preflight,
    };

    // 2. Translate one issue. A thrown error is a hard per-issue precondition
    //    (missing issue.txt, etc.); record it as `failed` and carry on -- do
    //    NOT let it abort the run. It fails BEFORE the engine, so it never
    //    paces.
    let result: TranslateIssueResult;
    let engineRan: boolean;
    try {
      result = await translateIssue(ark, issueCtx);
      // A returned `skipped` (fully idempotent) or `refused` (rights gate) made
      // zero engine calls; every other returned outcome ran the engine.
      engineRan = result.outcome !== 'skipped' && result.outcome !== 'refused';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result = { ark, outcome: 'failed', pagesDone: 0, pagesTotal: 0, message };
      engineRan = false;
    }

    // 3. Record in discovery order.
    report.issues.push(result);

    // 4. Consecutive-failure rule (FR-017). `failed`/`incomplete` (and thrown
    //    preconditions, recorded above as `failed`) are FAILURES; everything
    //    else -- including the expected `refused` rights outcome -- RESETS.
    const failed =
      result.outcome === 'failed' || result.outcome === 'incomplete';
    consecutiveFailures = failed ? consecutiveFailures + 1 : 0;

    if (consecutiveFailures >= CONSECUTIVE_FAILURE_ABORT) {
      report.abortedOnConsecutiveFailures = true;
      ctx.log(
        `aborting: ${CONSECUTIVE_FAILURE_ABORT} consecutive issue failures ` +
          `(last: ${ark})`,
      );
      return report;
    }

    // 5. Pace after an engine-running issue when another issue will follow.
    //    No delay after the final issue, none after a skip/refuse (no engine),
    //    and none after an abort (returned above).
    if (engineRan && i < arks.length - 1) {
      await ctx.delay();
    }
  }

  return report;
}
