import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runBibliography } from '@/cli/bibliography';
import { runCoverageCli } from '@/cli/bib-coverage';

/**
 * CLI-level coverage for `bib coverage` (T006,
 * specs/007-corpus-coverage-audit/contracts/bib-coverage.md): the new
 * subaction's arg parsing, path resolution (`resolveRepoRoot()`'s
 * `bibliography/sources` + `bibliography/search-log.yml`, the SAME
 * resolution `bib show`/`bib validate` use -- see `src/cli/bib-coverage.ts`),
 * dispatch wiring in `runBibliography`, and the "writes nothing" invariant
 * (INV-4). The pure `buildCoverageReport`/`renderCoverage` plumbing over the
 * `tests/fixtures/coverage` fixture is already proven directly in
 * `tests/unit/coverage/coverage-skeleton.test.ts`; `resolveRepoRoot()` always
 * resolves to this repo's own checkout (by construction, matching every
 * other `bib` subaction), so this suite exercises the CLI wiring against the
 * real, committed corpus rather than re-pointing it at the fixture.
 */

function repoRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

function gitStatus(): string {
  return execFileSync('git', ['status', '--porcelain'], {
    cwd: repoRoot(),
    encoding: 'utf-8',
  });
}

describe('bib coverage CLI', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('prints a non-empty human-readable report and exits 0', async () => {
    const exitCode = await runCoverageCli([]);
    expect(exitCode).toBe(0);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const printed = String(logSpy.mock.calls[0]?.[0]);
    expect(printed.length).toBeGreaterThan(0);
    expect(printed).toContain('Per-work-bundle counts:');
  });

  it('prints valid, non-empty JSON with --json and exits 0', async () => {
    const exitCode = await runCoverageCli(['--json']);
    expect(exitCode).toBe(0);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const printed = String(logSpy.mock.calls[0]?.[0]);
    const parsed: unknown = JSON.parse(printed);
    expect(parsed).toMatchObject({
      perWorkBundle: expect.any(Array),
      evidenceClassDistribution: expect.any(Array),
      register: expect.any(Object),
      searchHistory: expect.any(Object),
    });
  });

  it('dispatches through runBibliography(["coverage", ...]) the same way', async () => {
    const exitCode = await runBibliography(['coverage', '--json']);
    expect(exitCode).toBe(0);
    const printed = String(logSpy.mock.calls[0]?.[0]);
    expect(() => JSON.parse(printed)).not.toThrow();
  });

  it('fails loud (exit 2) on an unknown flag, without printing a report', async () => {
    const exitCode = await runCoverageCli(['--bogus']);
    expect(exitCode).toBe(2);
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('surfaces explicit unknown and never a headline percentage (INV-1/INV-2)', async () => {
    const exitCode = await runCoverageCli([]);
    expect(exitCode).toBe(0);
    const printed = String(logSpy.mock.calls[0]?.[0]);
    // The real corpus work-bundle (PB-P004) has no authored knownMemberCount -> unknown.
    expect(printed).toContain('unknown');
    expect(printed).toContain('gap: unknown');
    // INV-1: no coverage percentage anywhere in the human-readable report.
    expect(printed).not.toContain('%');
  });

  it('json carries the same section data with no percentage (INV-1/INV-5)', async () => {
    const exitCode = await runCoverageCli(['--json']);
    expect(exitCode).toBe(0);
    const printed = String(logSpy.mock.calls[0]?.[0]);
    expect(printed).not.toContain('%');
    const parsed = JSON.parse(printed) as {
      perWorkBundle: { workBundle: string; actualMemberCount: number; gap: number | 'unknown' }[];
    };
    // Real corpus source-group PB-P004 has five members (per-work), extent unknown.
    const pb004 = parsed.perWorkBundle.find((c) => c.workBundle === 'PB-P004');
    expect(pb004?.actualMemberCount).toBe(5);
    expect(pb004?.gap).toBe('unknown');
  });

  it('writes nothing to disk (INV-4: git status unchanged by the run)', async () => {
    const before = gitStatus();
    await runCoverageCli([]);
    await runCoverageCli(['--json']);
    const after = gitStatus();
    expect(after).toBe(before);
  });
});
