import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * REAL-PROCESS coverage for corpus selection at the CLI composition root
 * (T010, spec.md User Story 1, SC-002; contracts/corpus-seam.md INV-1/INV-3).
 *
 * `tests/unit/cli/corpus-selection.test.ts` (T009) already covers the
 * selection logic by calling `runCli`/`runTranslateCli` IN-PROCESS with
 * `console.log`/`console.error` mocked. This suite adds what that cannot
 * give:
 *
 *   1. Real process exit codes -- `execFileSync`'s thrown `status` on a
 *      spawned child, not a function's return value asserted in the same
 *      process.
 *   2. "Never runs partially" (SC-002, INV-3) proven on the real filesystem:
 *      `bib census` would write `data/census/<sourceId>-<slug>.json` on
 *      success (`src/cli/census.ts`'s `censusPath`, resolved against
 *      `process.cwd()`); run with no corpus selected, the target file is
 *      absent both before AND after the run, and `git status --porcelain` of
 *      `data/census/` is byte-identical before and after (mirroring the
 *      INV-4 git-status-diff invariant `tests/integration/bib-coverage-cli.test.ts`
 *      already uses for "writes nothing").
 *   3. Both bins gate -- `bib` (`src/index.ts`, exit code 2 on a composition
 *      failure per `src/cli/dispatch.ts`'s `runCli`) and the separate
 *      `translate` bin (`src/translate-index.ts`, exit code 1 -- its catch
 *      sets `process.exitCode = 1` on ANY thrown error, unlike `bib`'s
 *      typed exit-2 return).
 *   4. `--corpus` beating `COLONY_CORPUS` with the env var actually set in
 *      the CHILD PROCESS's environment (not injected as in-process test
 *      data via `CliEnvironment`, as T009 does).
 *   5. Exception commands (US1.5) getting PAST the gate with NO corpus
 *      selected and NO real network call: `bib discover` / `bib query-source`
 *      reach EXTERNAL sources on a real invocation, so each is driven with no
 *      arguments, asserting it fails on ITS OWN usage error (missing
 *      required argument) -- proving the corpus gate was passed (the error is
 *      not "no corpus selected") without ever constructing a network client.
 *
 * Invocation follows the project's own `npm run bib` / `npm run translate`
 * scripts: the local `tsx` binary directly against `src/index.ts` /
 * `src/translate-index.ts` (never `npx tsx`, never `ts-node`). This exercises
 * the same composition-root source `tests/integration/built-bin.test.ts`
 * exercises via the bundled `dist/` output, without paying that suite's
 * `npm run build` cost again here.
 */

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const tsxBin = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
const bibEntry = path.join(repoRoot, 'src', 'index.ts');
const translateEntry = path.join(repoRoot, 'src', 'translate-index.ts');

interface ProcessResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Narrow an `execFileSync` throw to its `status`/`stdout`/`stderr` fields.
 * Mirrors the narrowing already used in
 * `tests/unit/cli/no-stale-gallica-invocations.test.ts` -- no `as`, no `any`.
 */
function processResultFromError(error: unknown): ProcessResult {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    'stdout' in error &&
    'stderr' in error &&
    typeof error.status === 'number' &&
    (typeof error.stdout === 'string' || Buffer.isBuffer(error.stdout)) &&
    (typeof error.stderr === 'string' || Buffer.isBuffer(error.stderr))
  ) {
    return {
      status: error.status,
      stdout: String(error.stdout),
      stderr: String(error.stderr),
    };
  }
  throw error;
}

/**
 * Run a bin's entrypoint as a REAL child process (`tsx <entry> <args>`), cwd
 * pinned at the repo root (so `data/census/` resolves to the real, tracked
 * directory, and so `@/...` path-alias resolution -- which `tsx` resolves
 * relative to cwd, not the script's own location -- keeps working).
 *
 * `COLONY_CORPUS` is stripped from the inherited environment by default, so
 * every case is hermetic against whatever the developer running the suite
 * has exported; pass it via `envOverrides` to set it for a specific case.
 */
function runProcess(
  entry: string,
  args: readonly string[],
  envOverrides: Record<string, string | undefined> = {},
): ProcessResult {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.COLONY_CORPUS;
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  try {
    const stdout = execFileSync(tsxBin, [entry, ...args], {
      cwd: repoRoot,
      encoding: 'utf-8',
      env,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    return processResultFromError(error);
  }
}

const runBib = (args: readonly string[], envOverrides?: Record<string, string | undefined>) =>
  runProcess(bibEntry, args, envOverrides);
const runTranslate = (args: readonly string[], envOverrides?: Record<string, string | undefined>) =>
  runProcess(translateEntry, args, envOverrides);

function censusDirGitStatus(): string {
  return execFileSync('git', ['status', '--porcelain', 'data/census'], {
    cwd: repoRoot,
    encoding: 'utf-8',
  });
}

describe('bib gate at the real process boundary (SC-002)', () => {
  it('exits 2 and does no work when no corpus is selected (coverage)', () => {
    const result = runBib(['coverage', '--json']);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('no corpus selected');
    expect(result.stderr).toContain('--corpus');
    expect(result.stderr).toContain('COLONY_CORPUS');
  });

  it('never runs partially: census writes nothing to disk when no corpus is selected', () => {
    // A source-id/slug pair guaranteed not to already exist under the real,
    // tracked `data/census/` directory.
    const sourceId = 'ZZ-TEST999';
    const slug = 't010-corpus-gate-probe';
    const targetPath = path.join(repoRoot, 'data', 'census', `${sourceId}-${slug}.json`);

    expect(existsSync(targetPath)).toBe(false);
    const before = censusDirGitStatus();

    const result = runBib([
      'census',
      'ark:/12148/cb32798952c',
      '--source-id',
      sourceId,
      '--slug',
      slug,
    ]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('bib census:');
    expect(result.stderr).toContain('no corpus selected');
    // The command never ran (SC-002): the target file was never created, and
    // `data/census/` is byte-identical before and after (INV-4-style check).
    expect(existsSync(targetPath)).toBe(false);
    expect(censusDirGitStatus()).toBe(before);
  });

  it('exits 2 naming the missing manifest for an unknown --corpus id', () => {
    const result = runBib(['--corpus', 'no-such-corpus', 'coverage']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('unknown corpus');
    expect(result.stderr).toContain(path.join(repoRoot, 'corpora', 'no-such-corpus.yml'));
  });

  it('--corpus overrides COLONY_CORPUS end to end, with the env var set in the CHILD process', () => {
    const result = runBib(['--corpus', 'port-breton', 'coverage', '--json'], {
      // A real environment variable in the SPAWNED process, naming a corpus
      // that does not exist -- if the flag did not win, this would fail with
      // "unknown corpus", not succeed.
      COLONY_CORPUS: 'no-such-corpus',
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });
});

describe('translate gate at the real process boundary (SC-002)', () => {
  it('exits non-zero and never reaches archive-root resolution when no corpus is selected', () => {
    const result = runTranslate(['translate', 'ark:/12148/bpt6k999999z']);
    // `src/translate-index.ts` turns ANY thrown error into exit code 1 (its
    // catch always sets `process.exitCode = 1`), unlike `bib`'s typed exit 2.
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no corpus selected');
    // Proof the corpus gate fired FIRST: `runTranslate`'s default deps only
    // resolve `COLONY_ARCHIVE_ROOT`/`--archive-root` (`resolveArchiveRoot`,
    // `src/archive/location.ts`) once the handler actually runs. Reaching
    // "no archive root configured" instead would mean selection was
    // bypassed and the handler ran with no corpus -- exactly the partial run
    // SC-002 forbids.
    expect(result.stderr).not.toContain('archive root configured');
  });
});

describe('exception commands run with NO corpus selected, and reach no network (US1.5)', () => {
  it('bib --help exits 0 without a corpus', () => {
    const result = runBib(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--corpus <id>');
  });

  it('bib discover reaches its own usage error, not the corpus gate or a network call', () => {
    const result = runBib(['discover']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('bib discover: missing required argument <query>');
    expect(result.stderr).not.toContain('no corpus selected');
  });

  it('bib query-source reaches its own usage error, not the corpus gate or a network call', () => {
    const result = runBib(['query-source']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('bib query-source: missing required argument <source-id>');
    expect(result.stderr).not.toContain('no corpus selected');
  });

  it('translate --help exits 0 without a corpus', () => {
    const result = runTranslate(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--corpus <id>');
  });
});
