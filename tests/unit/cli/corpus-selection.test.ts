import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  composeCorpus,
  corporaRootFor,
  resolveCorporaRoot,
  resolveRepoRootUpward,
  requireCorpus,
} from '@/cli/composition-root';
import { bibExceptionSubactions } from '@/cli/corpus-exceptions';
import { runCli } from '@/cli/dispatch';
import { runTranslateCli } from '@/cli/translate-dispatch';

/**
 * Corpus selection at the CLI composition root (T009) — spec.md FR-003,
 * FR-009, FR-014, FR-016 and SC-002.
 *
 * Every `runCli` call here passes `{ envCorpus: ... }` EXPLICITLY. The
 * composition root distinguishes an absent field (read the real
 * `process.env.COLONY_CORPUS`) from a present-but-`undefined` one (there is no
 * `COLONY_CORPUS`), so these assertions hold regardless of what the developer
 * running the suite has exported.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const PRODUCTION_CORPORA_ROOT = resolveCorporaRoot(REPO_ROOT);

describe('corpus selection at the CLI composition root', () => {
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

  const errors = (): string => errorSpy.mock.calls.map((c) => String(c[0])).join('\n');

  describe('no corpus selected (FR-009, SC-002)', () => {
    it('a corpus-dependent bib subaction exits non-zero and does no work', async () => {
      const code = await runCli(['coverage', '--json'], { envCorpus: undefined });
      expect(code).toBe(2);
      expect(errors()).toContain('no corpus selected');
      expect(errors()).toContain('--corpus');
      expect(errors()).toContain('COLONY_CORPUS');
      // `bib coverage` prints its report with a single console.log; nothing was
      // printed, so the command never ran (never partially, SC-002).
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('names the failing subaction in the error', async () => {
      const code = await runCli(['regenerate'], { envCorpus: undefined });
      expect(code).toBe(2);
      expect(errors()).toContain('bib regenerate:');
      // `bib regenerate` (write mode) logs a line per written view; nothing was
      // written.
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('a corpus-dependent flat verb exits non-zero and does no work', async () => {
      const code = await runCli(['census', 'ark:/12148/cb32798952c', '--source-id', 'PB-P001', '--slug', 'x'], {
        envCorpus: undefined,
      });
      expect(code).toBe(2);
      expect(errors()).toContain('bib census:');
      expect(errors()).toContain('no corpus selected');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('the separate translate bin fails loud too', async () => {
      await expect(
        runTranslateCli(['translate', 'ark:/12148/bpt6k123'], { envCorpus: undefined }),
      ).rejects.toThrow(/no corpus selected/);
    });
  });

  describe('unknown corpus (FR-009)', () => {
    it('names the missing manifest path for an unknown --corpus id', async () => {
      const code = await runCli(['--corpus', 'no-such-corpus', 'coverage'], {
        envCorpus: undefined,
      });
      expect(code).toBe(2);
      expect(errors()).toContain('unknown corpus');
      expect(errors()).toContain(path.join(PRODUCTION_CORPORA_ROOT, 'no-such-corpus.yml'));
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('names the missing manifest path for an unknown COLONY_CORPUS value', async () => {
      const code = await runCli(['coverage'], { envCorpus: 'no-such-corpus' });
      expect(code).toBe(2);
      expect(errors()).toContain('unknown corpus');
      expect(errors()).toContain('no-such-corpus.yml');
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('precedence (FR-003)', () => {
    it('--corpus overrides COLONY_CORPUS', async () => {
      // Env names a corpus that does not exist; the flag names the real one.
      // Reaching `census`'s own usage error proves selection SUCCEEDED with
      // the flag's value rather than failing on the env's.
      const code = await runCli(['--corpus', 'port-breton', 'census'], {
        envCorpus: 'no-such-corpus',
      });
      expect(code).toBe(2);
      expect(errors()).toContain('missing required argument <periodicalArk>');
      expect(errors()).not.toContain('unknown corpus');
    });

    it('composeCorpus resolves the flag ahead of the environment', () => {
      const composed = composeCorpus({
        corporaRoot: PRODUCTION_CORPORA_ROOT,
        cliCorpus: 'port-breton',
        envCorpus: 'no-such-corpus',
      });
      expect(composed.selected.manifest.id).toBe('port-breton');
    });

    it('falls back to COLONY_CORPUS when no flag is given', () => {
      const composed = composeCorpus({
        corporaRoot: PRODUCTION_CORPORA_ROOT,
        envCorpus: 'port-breton',
      });
      expect(composed.selected.manifest.id).toBe('port-breton');
    });

    it('rejects a present-but-blank selector instead of treating it as unset', () => {
      expect(() =>
        composeCorpus({ corporaRoot: PRODUCTION_CORPORA_ROOT, envCorpus: '  ' }),
      ).toThrow(/COLONY_CORPUS is set but empty/);
      expect(() =>
        composeCorpus({ corporaRoot: PRODUCTION_CORPORA_ROOT, cliCorpus: ' ' }),
      ).toThrow(/--corpus is set but empty/);
    });
  });

  describe('exception commands run with NO corpus selected (FR-014, SC-002)', () => {
    it('bib --help', async () => {
      const code = await runCli(['--help'], {
        envCorpus: undefined,
        corporaRoot: path.join(REPO_ROOT, 'no-such-corpora-root'),
      });
      expect(code).toBe(0);
      expect(logSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('--corpus <id>');
    });

    it('bib --version', async () => {
      const code = await runCli(['--version'], { envCorpus: undefined });
      expect(code).toBe(0);
      expect(logSpy.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/\d+\.\d+\.\d+/);
    });

    it('bib discover reaches its own usage error, not the selection gate', async () => {
      const code = await runCli(['discover'], { envCorpus: undefined });
      expect(code).toBe(2);
      expect(errors()).toContain('bib discover: missing required argument <query>');
      expect(errors()).not.toContain('no corpus selected');
    });

    it('bib query-source reaches its own usage error, not the selection gate', async () => {
      const code = await runCli(['query-source'], { envCorpus: undefined });
      expect(code).toBe(2);
      expect(errors()).toContain('source-id');
      expect(errors()).not.toContain('no corpus selected');
    });

    it('translate --help', async () => {
      await expect(
        runTranslateCli(['--help'], { envCorpus: undefined }),
      ).resolves.toBeUndefined();
      expect(logSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('--corpus <id>');
    });

    it('the exception list is exactly the FR-014 table resolution', () => {
      expect([...bibExceptionSubactions()].sort()).toEqual([
        'discover',
        'query-source',
        'validate-config',
      ]);
    });
  });

  describe('--corpus port-breton against the real committed manifest (FR-010)', () => {
    it('derives the narrow policies from the shipped manifest', () => {
      const composed = composeCorpus({
        corporaRoot: PRODUCTION_CORPORA_ROOT,
        cliCorpus: 'port-breton',
      });
      expect(composed.selected.corporaRoot).toBe(PRODUCTION_CORPORA_ROOT);
      expect(composed.scope.validCaseIds.has('port-breton')).toBe(true);
      // Behavior-preserving: the shipped allocator namespace is PB-P + pad 3.
      expect(composed.sourceIds).toEqual({ prefix: 'PB-P', padWidth: 3 });
    });

    it('runs a corpus-dependent command end to end, unchanged', async () => {
      const code = await runCli(['--corpus', 'port-breton', 'coverage', '--json'], {
        envCorpus: undefined,
      });
      expect(code).toBe(0);
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(() => JSON.parse(String(logSpy.mock.calls[0]?.[0]))).not.toThrow();
    });
  });

  describe('composition-root plumbing (FR-016)', () => {
    it('resolves the production corpora root under the repo root, and nowhere else', () => {
      expect(resolveCorporaRoot(REPO_ROOT)).toBe(path.join(REPO_ROOT, 'corpora'));
      expect(resolveRepoRootUpward()).toBe(REPO_ROOT);
      expect(corporaRootFor({})).toBe(PRODUCTION_CORPORA_ROOT);
    });

    it('an injected corpora root wins over the production one', () => {
      const fixtureRoot = path.join(REPO_ROOT, 'tests', 'fixtures', 'corpora');
      expect(corporaRootFor({ corporaRoot: fixtureRoot })).toBe(fixtureRoot);
    });

    it('requireCorpus fails loud when a corpus-dependent path got no composition', () => {
      expect(() => requireCorpus(null, 'coverage')).toThrow(/corpus-dependent/);
      const composed = composeCorpus({
        corporaRoot: PRODUCTION_CORPORA_ROOT,
        cliCorpus: 'port-breton',
      });
      expect(requireCorpus(composed, 'coverage')).toBe(composed);
    });
  });
});
