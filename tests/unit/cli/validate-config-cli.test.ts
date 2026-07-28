import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { composeCorpus, resolveCorporaRoot } from '@/cli/composition-root';
import { installedCapabilities } from '@/cli/installed-capabilities';
import { assertSelectedCorpusValid, validateSelectedCorpus } from '@/cli/startup-validation';
import { runCli } from '@/cli/dispatch';
import { selectCorpus } from '@/corpus/select';
import { validateCorpora, validateCorporaConfig } from '@/corpus/validate';
import type { CorpusValidationFinding } from '@/corpus/validate-types';
import { REPOSITORY_NAMES } from '@/repository/adapter';
import { registeredSourceQueryIds } from '@/sourcequery/source-config';

/**
 * `bib validate-config` + startup validation (T018) — spec.md User Story 4,
 * FR-002a/FR-002b, FR-007, FR-008, FR-009, FR-015; SC-005; INV-2/7/9/10/11/
 * 12/15.
 *
 * Every failure case runs against a FIXTURE corpora root. No invalid manifest
 * is ever added under the production `corpora/`, which the strict policy
 * (FR-015) would make block every corpus.
 *
 * `runCli(...)` calls pass `envCorpus` EXPLICITLY wherever selection could
 * matter, so the assertions hold whatever the developer's shell exported.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const FIXTURES = path.join(REPO_ROOT, 'tests', 'fixtures');
const CORPORA = path.join(FIXTURES, 'corpora');
const SOURCES = path.join(FIXTURES, 'sources');

describe('bib validate-config (T018)', () => {
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

  const out = (): string => logSpy.mock.calls.map((c) => String(c[0])).join('\n');
  const errors = (): string => errorSpy.mock.calls.map((c) => String(c[0])).join('\n');

  /** The `--json` payload of the last run, parsed. */
  function jsonResult(): {
    ok: boolean;
    corporaRoot: string;
    sourcesDir: string;
    manifests: string[];
    browserProfiles: string[];
    findings: CorpusValidationFinding[];
  } {
    const parsed: unknown = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0]));
    if (typeof parsed !== 'object' || parsed === null || !('findings' in parsed)) {
      throw new Error(`expected a validate-config JSON payload, got: ${String(parsed)}`);
    }
    // A test-only structural read of the verb's own JSON contract.
    return JSON.parse(String(logSpy.mock.calls.at(-1)?.[0]));
  }

  /** Run the verb with injected roots, returning its exit code. */
  async function run(corporaFixture: string, sourcesFixture: string, ...flags: string[]) {
    return runCli(['validate-config', ...flags], {
      envCorpus: undefined,
      corporaRoot: path.join(CORPORA, corporaFixture),
      sourcesDir: path.join(SOURCES, sourcesFixture),
    });
  }

  describe('the exception path (FR-014, US1.5, INV-3)', () => {
    it('runs with NO corpus selected', async () => {
      const code = await run('validate-valid', 'validate-valid');
      expect(code).toBe(0);
      // Never reached the selection gate.
      expect(errors()).not.toContain('no corpus selected');
      expect(out()).toContain('clean -- no findings');
    });

    it('runs with an unknown COLONY_CORPUS exported — selection is never attempted', async () => {
      const code = await runCli(['validate-config'], {
        envCorpus: 'no-such-corpus',
        corporaRoot: path.join(CORPORA, 'validate-valid'),
        sourcesDir: path.join(SOURCES, 'validate-valid'),
      });
      expect(code).toBe(0);
      expect(errors()).not.toContain('unknown corpus');
    });

    it('names what it checked, so a vacuous pass over an empty root is visible', async () => {
      const code = await run('empty-root', 'empty');
      expect(code).toBe(0);
      expect(out()).toContain('checked 0 manifest(s)');
    });
  });

  describe('exit codes (SC-005)', () => {
    it('exits 0 when clean', async () => {
      expect(await run('validate-valid', 'validate-valid')).toBe(0);
    });

    it('exits 1 when any finding exists', async () => {
      expect(await run('validate-prefix-equal', 'validate-duplicate-source-id')).toBe(1);
    });

    it('exits 2 — not 0 — when a root is missing, never "nothing to validate"', async () => {
      const code = await run('no-such-fixture-root', 'validate-valid');
      expect(code).toBe(2);
      expect(errors()).toContain('does not exist');
    });

    it('exits 2 on an unknown flag', async () => {
      const code = await run('validate-valid', 'validate-valid', '--nope');
      expect(code).toBe(2);
    });

    it('exits 2 on a stray positional (it validates every manifest, not one)', async () => {
      const code = await run('validate-valid', 'validate-valid', 'alpha');
      expect(code).toBe(2);
      expect(errors()).toContain('unexpected argument');
    });
  });

  describe('reports EVERY finding in one run, not just the first (SC-005)', () => {
    it('renders findings from more than one rule family in a single invocation', async () => {
      const code = await run('validate-prefix-equal', 'validate-duplicate-source-id');
      expect(code).toBe(1);

      const report = out();
      // Config-level (INV-7) AND existing-data-level (INV-12) failures, together.
      expect(report).toContain('[prefix-not-disjoint]');
      expect(report).toContain('[duplicate-source-id]');
      expect(report).toMatch(/bib validate-config: [2-9]\d* finding\(s\)/);
    });

    it('the JSON payload carries every finding with rule + subject + message', async () => {
      const code = await run('validate-overrides', 'validate-overrides', '--json');
      expect(code).toBe(1);

      const result = jsonResult();
      expect(result.ok).toBe(false);
      expect(result.findings.length).toBeGreaterThan(1);
      for (const finding of result.findings) {
        expect(finding.rule.length).toBeGreaterThan(0);
        expect(finding.subject.length).toBeGreaterThan(0);
        expect(finding.message.length).toBeGreaterThan(0);
      }
      expect(result.manifests).toEqual(['alpha', 'beta']);
      expect(result.corporaRoot).toBe(path.join(CORPORA, 'validate-overrides'));
    });
  });

  /**
   * Every FR-008 / FR-002a / FR-007 failure condition, asserted at the CLI
   * surface rather than only against the validator's own API — the surface
   * SC-005 grades. Each row is (corpora fixture, sources fixture, rule).
   */
  describe('every failure condition reaches the CLI surface (SC-005)', () => {
    const cases: readonly [string, string, string, string][] = [
      ['INV-2', 'manifest-cases', 'empty', 'manifest-unreadable'],
      ['INV-7', 'validate-prefix-equal', 'empty', 'prefix-not-disjoint'],
      ['INV-7', 'validate-prefix-substring', 'empty', 'prefix-not-disjoint'],
      ['INV-7 (intra-corpus, FR-002b)', 'validate-intra-corpus-prefix', 'empty', 'prefix-not-disjoint'],
      ['INV-7', 'validate-duplicate-case', 'empty', 'duplicate-case-id'],
      ['INV-7 (padWidth)', 'validate-bad-padwidth', 'empty', 'manifest-unreadable'],
      ['INV-10', 'validate-overrides', 'validate-overrides', 'override-unknown-source'],
      ['INV-10', 'validate-overrides', 'validate-overrides', 'override-source-not-in-corpus'],
      ['INV-10', 'validate-overrides', 'validate-overrides', 'override-path-not-relative'],
      ['INV-10', 'validate-overrides', 'validate-overrides', 'override-path-escapes-archive-root'],
      ['INV-10', 'validate-overrides', 'validate-overrides', 'override-duplicate-location'],
      ['INV-10 (reason)', 'validate-override-missing-reason', 'empty', 'manifest-unreadable'],
      ['INV-11', 'validate-profile-unknown-corpus', 'empty', 'profile-unknown-corpus'],
      ['INV-11', 'validate-duplicate-profile-id', 'empty', 'duplicate-profile-id'],
      ['INV-12', 'validate-existing-data', 'validate-duplicate-source-id', 'duplicate-source-id'],
      ['INV-12', 'validate-existing-data', 'validate-nonconforming', 'source-id-nonconforming'],
      ['INV-12', 'validate-existing-data', 'validate-nonconforming', 'source-case-not-in-any-corpus'],
      ['INV-12', 'validate-existing-data', 'validate-next-id-collision', 'next-source-id-collision'],
      ['INV-9', 'validate-capabilities', 'empty', 'capability-not-installed'],
    ];

    for (const [invariant, corporaFixture, sourcesFixture, rule] of cases) {
      it(`${invariant}: ${corporaFixture} → ${rule}`, async () => {
        const code = await run(corporaFixture, sourcesFixture, '--json');
        expect(code).toBe(1);
        const matching = jsonResult().findings.filter((finding) => finding.rule === rule);
        expect(matching.length).toBeGreaterThan(0);
        // SC-005 demands a SPECIFIC message, not a generic rejection: it must
        // name at least one component of the subject it located (a corpus id,
        // a Source id, a prefix, a case id) rather than restating the rule.
        const found = matching[0];
        if (found === undefined) {
          throw new Error(`no ${rule} finding`);
        }
        const parts = found.subject.split(/[/:]/).filter((part) => part.length > 0);
        expect(parts.some((part) => found.message.includes(part))).toBe(true);
      });
    }

    it('INV-15: a manifest with zero or two allocatable policies is rejected', async () => {
      // Both live in `manifest-cases` (zero-allocatable.yml / two-allocatable.yml),
      // where they fail to LOAD — the strict policy's coarsest rejection.
      const code = await run('manifest-cases', 'empty', '--json');
      expect(code).toBe(1);
      const unreadable = jsonResult().findings.filter((f) => f.rule === 'manifest-unreadable');
      expect(unreadable.map((f) => f.subject)).toEqual(
        expect.arrayContaining(['zero-allocatable', 'two-allocatable']),
      );
    });
  });

  describe('against the REAL committed config (FR-010, FR-015)', () => {
    it('is clean, with the production roots resolved and no injection', async () => {
      const code = await runCli(['validate-config'], {});
      expect(code).toBe(0);
      expect(out()).toContain(`corporaRoot=${resolveCorporaRoot(REPO_ROOT)}`);
      expect(out()).toContain('checked 1 manifest(s) [port-breton] + 1 browser profile(s)');
      expect(out()).toContain('clean -- no findings');
    });
  });
});

describe('startup validation for the selected corpus (T018)', () => {
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

  describe('capability subset (FR-008, INV-9)', () => {
    it('rejects a selected corpus whose requiredCapabilities are not installed', () => {
      expect(() =>
        composeCorpus({
          corporaRoot: path.join(CORPORA, 'validate-capabilities'),
          cliCorpus: 'alpha',
        }),
      ).toThrow(/unobtainium/);
    });

    it('names EVERY uninstalled capability, and what IS installed', () => {
      let message = '';
      try {
        composeCorpus({
          corporaRoot: path.join(CORPORA, 'validate-capabilities'),
          cliCorpus: 'alpha',
        });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toContain('capability-not-installed');
      expect(message).toContain('unobtainium');
      expect(message).toContain('nonesuch');
      // The installed set is derived, not asserted against a literal here.
      expect(message).toContain(REPOSITORY_NAMES[0]);
    });

    it('fails the corpus-dependent command at the CLI, before any work (FR-009, SC-002)', async () => {
      const code = await runCli(['coverage', '--json'], {
        envCorpus: 'alpha',
        corporaRoot: path.join(CORPORA, 'validate-capabilities'),
      });
      expect(code).toBe(2);
      expect(errors()).toContain('failed startup validation');
      expect(errors()).toContain('unobtainium');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('accepts the real committed corpus against the real installed set', () => {
      expect(() =>
        composeCorpus({
          corporaRoot: resolveCorporaRoot(REPO_ROOT),
          cliCorpus: 'port-breton',
        }),
      ).not.toThrow();
    });
  });

  describe('the strict policy binds at startup too (FR-015)', () => {
    it('a malformed UNRELATED committed manifest blocks the selected corpus', () => {
      // `manifest-cases` holds a valid.yml beside many deliberately broken
      // manifests. Selecting the valid one still fails: under FR-015 a
      // malformed committed manifest blocks ALL corpora.
      expect(() =>
        composeCorpus({ corporaRoot: path.join(CORPORA, 'manifest-cases'), cliCorpus: 'valid' }),
      ).toThrow(/manifest-unreadable/);
    });

    it('reports every config violation in one message, not the first', () => {
      let message = '';
      try {
        composeCorpus({ corporaRoot: path.join(CORPORA, 'manifest-cases'), cliCorpus: 'valid' });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message.split('\n').length).toBeGreaterThan(3);
    });
  });

  /**
   * THE SPLIT (see `@/cli/startup-validation`): startup validation runs the
   * CONFIG-ONLY rules plus the selected corpus's capability subset, and reads
   * NO bibliography SSOT record. These assertions are what keeps that
   * property from silently regressing into "every command loads the whole
   * SSOT" (FR-010).
   */
  describe('startup does NOT run the existing-data sweep (FR-010)', () => {
    const dataRoot = path.join(CORPORA, 'validate-existing-data');
    const selected = () => selectCorpus({ corporaRoot: dataRoot, cliCorpus: 'alpha' });

    it('startup is clean where the FULL sweep reports existing-data findings', () => {
      // Same config, same installed set — the ONLY difference is whether the
      // SSOT is read.
      const full = validateCorpora(
        dataRoot,
        path.join(SOURCES, 'validate-nonconforming'),
        installedCapabilities(),
      );
      expect(full.ok).toBe(false);
      expect(full.findings.some((f) => f.rule === 'source-id-nonconforming')).toBe(true);

      expect(validateSelectedCorpus(selected())).toEqual([]);
      expect(() => assertSelectedCorpusValid(selected())).not.toThrow();
    });

    it('a corpus-dependent command still composes when the SSOT would fail the full sweep', () => {
      expect(() => composeCorpus({ corporaRoot: dataRoot, cliCorpus: 'alpha' })).not.toThrow();
    });

    it('startup succeeds where the full sweep cannot even reach a sources dir', () => {
      // The full sweep THROWS on an unreachable sources dir (it must never be
      // collapsed into "zero Sources"). Startup validation over the identical
      // root is clean — decisive proof it never opens the SSOT at all.
      expect(() =>
        validateCorpora(dataRoot, path.join(SOURCES, 'no-such-sources-dir'), installedCapabilities()),
      ).toThrow(/does not exist/);
      expect(validateSelectedCorpus(selected())).toEqual([]);
    });

    it('validateCorporaConfig takes no sources dir — the exclusion is structural', () => {
      expect(validateCorporaConfig.length).toBe(1);
      expect(validateCorporaConfig(dataRoot).ok).toBe(true);
    });
  });

  describe('installed capabilities are DERIVED from the registries', () => {
    it('repositories come from the runtime list the RepositoryName union derives from', () => {
      expect(installedCapabilities().repositories).toEqual([...REPOSITORY_NAMES]);
      expect(REPOSITORY_NAMES).toContain('gallica');
    });

    it('sourceQueries come from the live source registry', () => {
      expect(installedCapabilities().sourceQueries).toEqual(registeredSourceQueryIds());
      // What the shipped manifest names must actually be registered.
      expect(installedCapabilities().sourceQueries).toEqual(
        expect.arrayContaining(['papers-past', 'papers-past-article']),
      );
    });
  });
});
