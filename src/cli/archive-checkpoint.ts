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
  const message =
    c.date === undefined
      ? `archive(${c.sourceId}): ${c.ark} — ${c.written} new, ${c.skipped} skipped`
      : `archive(${c.sourceId}): ${c.date} ${c.ark} — ` +
        `${c.written} new, ${c.skipped} skipped`;
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
