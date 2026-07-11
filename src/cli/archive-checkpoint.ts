import { execFile } from 'node:child_process';
import path from 'node:path';

/**
 * Per-issue git checkpoint adapter (`--checkpoint`).
 *
 * This is the ONLY place in the codebase that invokes `git`. The fetch core
 * (`src/fetch/*`, `src/archive/*`) stays git-free; it only knows about the
 * `FetchDeps.onIssueComplete` hook (`src/cli/fetch-shared.ts`). The CLI
 * orchestration layer (`fetch-issue.ts`/`fetch-source.ts`) calls that hook
 * once per issue; `defaultFetchDeps` wires THIS module's
 * {@link commitAndPushIssueCheckpoint} into the hook only when `--checkpoint`
 * is set.
 *
 * Every `git` invocation uses `execFile` with an argv array (never a shell
 * string), so no argument is ever shell-interpreted. `--no-verify` is never
 * passed -- a failing hook is a real failure, surfaced as a thrown Error.
 */

/** Everything needed to describe one issue's checkpoint commit. */
export interface IssueCheckpoint {
  /** Colony Cults source ID, e.g. `PB-P001`. */
  sourceId: string;
  /** The (bare) issue or document ark. */
  ark: string;
  /**
   * Normalized issue date `YYYY-MM-DD`. Absent for a monograph document,
   * which has no per-issue date -- its commit message omits the date segment
   * entirely (see {@link commitAndPushIssueCheckpoint}) rather than inventing
   * a stand-in.
   */
  date?: string;
  /** Absolute issue directory path (must be inside `archiveRoot`). */
  dir: string;
  /** Page count reported by the host. */
  pageCount: number;
  /** Pages newly written/uploaded this run. */
  written: number;
  /** Pages skipped (already recorded). */
  skipped: number;
  /**
   * Page-cadence progress (MONOGRAPH page-level checkpointing only, see
   * `--checkpoint-every`): the page number reached when this intermediate
   * checkpoint fired. When present, the commit message appends a
   * `through page <page>/<pageCount>` segment so consecutive per-page
   * commits for the same document are distinguishable from one another.
   * Absent for a per-issue (periodical) checkpoint and for a monograph's
   * final end-of-document flush, whose message is unchanged from before.
   */
  page?: number;
}

/**
 * Fired once per page by the shared per-page fetch pipeline
 * (`fetchDocumentPages` in `src/fetch/issue.ts`), for BOTH the write and the
 * skip branch, so a resumed run still checkpoints. Defined here (not in the
 * fetch core) so the core can depend on the TYPE without depending on git --
 * a `import type` of this interface is fully erased at compile time, so
 * `src/fetch/issue.ts` never pulls in this module's `git` runtime code.
 */
export interface PageStored {
  /** Colony Cults source ID, e.g. `PB-P002`. */
  sourceId: string;
  /** The (bare) issue or document ark. */
  ark: string;
  /** Absolute directory the page was written into. */
  dir: string;
  /** 1-based page ordinal just stored. */
  page: number;
  /** Total page count for the document. */
  pageCount: number;
  /** True when this page was skipped (already recorded), not freshly stored. */
  skipped: boolean;
}

/** Outcome of one `git` invocation: never throws, always resolves. */
interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run one `git` command to completion with `cwd` as the working directory.
 * Mirrors `src/ocr/exec.ts`'s `execCommand`: never rejects on a non-zero exit
 * -- that is reported via `exitCode` so callers can choose to fail loud (via
 * {@link git}) or treat it as an expected probe result (diff/upstream checks).
 */
function runGit(args: readonly string[], cwd: string): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args as string[],
      { cwd, maxBuffer: 1024 * 1024 * 64 },
      (error, stdout, stderr) => {
        if (error) {
          const exitCode = typeof error.code === 'number' ? error.code : 1;
          resolve({ stdout, stderr, exitCode });
          return;
        }
        resolve({ stdout, stderr, exitCode: 0 });
      },
    );
  });
}

/**
 * Run a `git` command that MUST succeed; throws a descriptive Error
 * (including the git stderr) on a non-zero exit. Used for every command
 * except the two intentional probes (`diff --cached --quiet` and the
 * `@{u}` upstream check), which inspect `exitCode` themselves instead.
 */
async function git(
  args: readonly string[],
  cwd: string,
  context: string,
): Promise<GitResult> {
  const result = await runGit(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(
      `commitAndPushIssueCheckpoint: ${context} failed ` +
        `(git ${args.join(' ')}, exit ${result.exitCode}): ` +
        `${result.stderr.trim() || result.stdout.trim() || '(no output)'}`,
    );
  }
  return result;
}

/**
 * Commit (and optionally push) one issue's checkpoint: the provenance `.yml`
 * sidecars and the integrity manifest under `archiveRoot` (page-image masters
 * themselves are gitignored). Fully idempotent -- a re-run of an
 * already-committed issue with nothing new staged is a clean no-op, not an
 * error and not an empty commit.
 *
 * Never passes `--no-verify`; any repo-level pre-commit/pre-push hook runs
 * normally and a hook failure surfaces as a thrown Error like any other git
 * failure.
 */
export async function commitAndPushIssueCheckpoint(
  archiveRoot: string,
  c: IssueCheckpoint,
  opts: { push: boolean },
): Promise<void> {
  const dirRel = path.relative(archiveRoot, c.dir);
  if (dirRel.startsWith('..') || path.isAbsolute(dirRel)) {
    throw new Error(
      `commitAndPushIssueCheckpoint: issue dir "${c.dir}" is not inside ` +
        `archive root "${archiveRoot}"`,
    );
  }
  const manifestRel = path.join('manifests', 'MANIFEST.sha256');

  await git(['add', '--', dirRel, manifestRel], archiveRoot, 'staging issue changes');

  // Probe: exit 0 means nothing staged relative to HEAD -- an idempotent
  // re-run of an already-committed issue. Any other exit code means either
  // "there is a staged diff" (1) or a real git error, which the subsequent
  // `commit` call below will surface loudly.
  const diffProbe = await runGit(['diff', '--cached', '--quiet'], archiveRoot);
  if (diffProbe.exitCode === 0) {
    return;
  }

  // A periodical issue carries a date (`archive(<id>): <date> <ark> — ...`);
  // a monograph document has none, so its message drops that segment
  // entirely (`archive(<id>): <ark> — ...`) rather than inventing a stand-in.
  // An intermediate monograph page-cadence checkpoint additionally carries
  // `c.page` (see `IssueCheckpoint.page`), appended as a distinguishing
  // "through page N/M" segment; absent for every other caller, so their
  // message shape is unchanged from before.
  const progress = c.page === undefined ? '' : ` (through page ${c.page}/${c.pageCount})`;
  const message =
    c.date === undefined
      ? `archive(${c.sourceId}): ${c.ark} — ${c.written} new, ${c.skipped} skipped${progress}`
      : `archive(${c.sourceId}): ${c.date} ${c.ark} — ` +
        `${c.written} new, ${c.skipped} skipped${progress}`;
  await git(['commit', '-m', message], archiveRoot, 'committing issue checkpoint');

  if (!opts.push) {
    return;
  }

  // Probe: does the current branch already track an upstream? A non-zero
  // exit (typically "fatal: no upstream configured") means it does not, so
  // the first push must set one with `-u origin <branch>`.
  const upstreamProbe = await runGit(
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
    archiveRoot,
  );
  if (upstreamProbe.exitCode !== 0) {
    const branchResult = await git(
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      archiveRoot,
      'resolving current branch',
    );
    const branch = branchResult.stdout.trim();
    await git(
      ['push', '-u', 'origin', branch],
      archiveRoot,
      'pushing (setting upstream)',
    );
    return;
  }

  await git(['push'], archiveRoot, 'pushing');
}

/**
 * Shape of {@link commitAndPushIssueCheckpoint}, injected into {@link
 * buildMonographPageCheckpointHook} so the page-cadence logic itself can be
 * unit tested with a fake commit function -- no real git required.
 */
export type CommitCheckpointFn = (
  archiveRoot: string,
  checkpoint: IssueCheckpoint,
  opts: { push: boolean },
) => Promise<void>;

/**
 * Build a STATEFUL per-page checkpoint hook for a MONOGRAPH-shaped document
 * (`--checkpoint` + `--checkpoint-every <N>`): commits+pushes (via `commit`)
 * every `checkpointEvery` pages, closing over running written/skipped counters
 * so each checkpoint's commit message reflects only the pages stored since the
 * LAST checkpoint (or document start).
 *
 * This state is scoped to ONE closure instance -- callers must build a fresh
 * hook per run (never share one across documents/runs). Shared by BOTH the
 * fetch pipeline (`defaultFetchDeps`) and the translate pipeline
 * (`runTranslate`), which each build one per invocation.
 *
 * A periodical issue never uses this -- it stays bounded by the existing
 * per-issue checkpoint hook; only a monograph document (unbounded page count)
 * needs page-level cadence.
 */
export function buildMonographPageCheckpointHook(
  archiveRoot: string,
  checkpointEvery: number,
  commit: CommitCheckpointFn,
): (stored: PageStored) => Promise<void> {
  if (!Number.isInteger(checkpointEvery) || checkpointEvery < 1) {
    throw new Error(
      `buildMonographPageCheckpointHook: checkpointEvery must be a positive ` +
        `integer (got ${checkpointEvery})`,
    );
  }

  let pagesSinceCheckpoint = 0;
  let writtenSinceCheckpoint = 0;
  let skippedSinceCheckpoint = 0;

  return async (stored: PageStored): Promise<void> => {
    if (stored.skipped) {
      skippedSinceCheckpoint += 1;
    } else {
      writtenSinceCheckpoint += 1;
    }
    pagesSinceCheckpoint += 1;

    if (pagesSinceCheckpoint < checkpointEvery) {
      return;
    }

    const checkpoint: IssueCheckpoint = {
      sourceId: stored.sourceId,
      ark: stored.ark,
      dir: stored.dir,
      pageCount: stored.pageCount,
      written: writtenSinceCheckpoint,
      skipped: skippedSinceCheckpoint,
      page: stored.page,
    };

    pagesSinceCheckpoint = 0;
    writtenSinceCheckpoint = 0;
    skippedSinceCheckpoint = 0;

    await commit(archiveRoot, checkpoint, { push: true });
  };
}
