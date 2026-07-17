import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runQuerySourceCli } from '@/cli/bib-query-source';

/**
 * `bib query-source` CLI arg-parsing paths (T015,
 * specs/014-source-query-client/contracts/cli-query-source.md, US1 subset).
 * Only the usage-error paths are exercised here: `parseQuerySourceArgs()`
 * runs BEFORE any `SourceQueryClient`/`PlaywrightBrowserSession` construction
 * in `runQuerySourceCli`, so these cases never launch a real browser. The
 * happy path needs a real browser and is covered by the env-gated
 * integration test (T018).
 */
describe('bib query-source CLI (arg parsing)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('fails loud (exit 2) when --query is missing', async () => {
    const exitCode = await runQuerySourceCli(['papers-past']);
    expect(exitCode).toBe(2);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('bib query-source:');
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('--query');
  });

  it('fails loud (exit 2) when the <source-id> positional is missing', async () => {
    const exitCode = await runQuerySourceCli(['--query', 'some text']);
    expect(exitCode).toBe(2);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('source-id');
  });

  it('fails loud (exit 2) on an unknown flag', async () => {
    const exitCode = await runQuerySourceCli(['papers-past', '--query', 'x', '--bogus']);
    expect(exitCode).toBe(2);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('fails loud (exit 2) on a non-integer --pages', async () => {
    const exitCode = await runQuerySourceCli([
      'papers-past',
      '--query',
      'x',
      '--pages',
      'not-a-number',
    ]);
    expect(exitCode).toBe(2);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('--pages');
  });

  it('never writes to stdout on a usage error', async () => {
    await runQuerySourceCli(['papers-past']);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
