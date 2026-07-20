import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPackageVersion, runCli } from '@/cli/dispatch';

describe('runCli flat dispatch', () => {
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

  it('prints bib help (not gallica) on --help and on no args', async () => {
    expect(await runCli(['--help'])).toBe(0);
    const help = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(help).toContain('bib');
    expect(help).toContain('query-source');
    expect(help).toContain('census');
    expect(help).not.toContain('gallica <command>');
    logSpy.mockClear();
    expect(await runCli([])).toBe(0);
    expect(logSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('bib');
  });

  it('routes a bibliography SSOT verb to runBibliography (usage error, no side effects)', async () => {
    // `query-source` with no source-id is a deterministic usage error (exit 2),
    // parsed before any browser is constructed — proves it hit the bib path.
    const code = await runCli(['query-source']);
    expect(code).toBe(2);
    expect(errorSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('source-id');
  });

  it('routes a Gallica mirroring verb to the parse+HANDLERS path', async () => {
    // `census` with no periodicalArk throws in parse -> caught -> exit 2
    // (usage/parse errors dominate the catch path; deliberate change from
    // the old blanket exit 1).
    const code = await runCli(['census']);
    expect(code).toBe(2);
    expect(errorSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('census');
  });

  it('fails loud (exit 2) on an unknown verb', async () => {
    const code = await runCli(['no-such-verb']);
    expect(code).toBe(2);
    expect(errorSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('no-such-verb');
  });

  it('readPackageVersion resolves the real version on the tsx/source path (regression: was ENOENT on src/package.json)', () => {
    expect(readPackageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
