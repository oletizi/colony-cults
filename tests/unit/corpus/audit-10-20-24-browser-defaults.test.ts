import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveBrowserSources } from '@/browser/config';
import { deriveBrowserProfile } from '@/corpus/policies';
import { selectCorpus } from '@/corpus/select';
import { validateCorpora, validateCorporaConfig, type InstalledCapabilities } from '@/corpus/validate';
import type { CorpusValidationFinding } from '@/corpus/validate-types';

/**
 * AUDIT-10 / AUDIT-20 / AUDIT-24 — ONE root cause, three symptoms: the
 * browser-defaults surface applied NO cross-check between the defaults it
 * handed out and the corpus they belong to.
 *
 * Before this suite:
 *   - AUDIT-10: `defaultSources` were type-checked (non-empty strings) and
 *     nothing else. A committed profile could list ids no `sourceIds` policy
 *     of its corpus could ever allocate, and ids naming no SSOT record.
 *   - AUDIT-20: a profile's `corpus:` field was checked against "some
 *     committed manifest" but never against the corpus whose FILE it is.
 *     `loadBrowserProfile(root, id)` keys on the filename, so copying
 *     `X.browser.yml` to `Y.browser.yml` silently gave Y a profile pointing
 *     at X.
 *   - AUDIT-24: `deriveBrowserProfile` returned the `CORPUS_SOURCES` override
 *     verbatim with ZERO validation.
 *
 * Fixture roots are used for every failure case — no invalid artifact is ever
 * added under the production `corpora/`, which FR-015's strict policy would
 * make block every corpus.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const FIXTURES = path.join(REPO_ROOT, 'tests', 'fixtures');
const CORPORA = path.join(FIXTURES, 'corpora');
const SOURCES = path.join(FIXTURES, 'sources');
/** The REAL committed config — the regression that matters (FR-010). */
const REAL_CORPORA_ROOT = path.join(REPO_ROOT, 'corpora');
const REAL_SOURCES_DIR = path.join(REPO_ROOT, 'bibliography', 'sources');

const NO_CAPABILITIES: InstalledCapabilities = { repositories: [], sourceQueries: [] };

function subjectsFor(findings: readonly CorpusValidationFinding[], rule: string): string[] {
  return findings.filter((finding) => finding.rule === rule).map((finding) => finding.subject);
}

function only(findings: readonly CorpusValidationFinding[], rule: string): CorpusValidationFinding {
  const matching = findings.filter((finding) => finding.rule === rule);
  if (matching.length !== 1) {
    throw new Error(
      `expected exactly one ${rule} finding, got ${matching.length}: ` +
        JSON.stringify(findings, null, 2),
    );
  }
  return matching[0];
}

describe('AUDIT-20 — a profile\'s `corpus:` must be the corpus whose FILE it is', () => {
  const root = path.join(CORPORA, 'validate-profile-corpus-mismatch');

  it('rejects beta.browser.yml declaring `corpus: alpha`', () => {
    const result = validateCorpora(root, path.join(SOURCES, 'empty'), NO_CAPABILITIES);

    const finding = only(result.findings, 'profile-corpus-filename-mismatch');
    expect(finding.subject).toBe('beta');
    expect(finding.message).toContain('beta.browser.yml');
    expect(finding.message).toContain('"alpha"');
    expect(finding.message).toContain('"beta"');
    expect(result.ok).toBe(false);
  });

  it('`profile-unknown-corpus` cannot catch it — alpha IS a committed corpus', () => {
    const result = validateCorpora(root, path.join(SOURCES, 'empty'), NO_CAPABILITIES);

    expect(subjectsFor(result.findings, 'profile-unknown-corpus')).toEqual([]);
    // The mismatch is the ONLY thing wrong with this root.
    expect(result.findings.map((f) => f.rule)).toEqual(['profile-corpus-filename-mismatch']);
  });

  it('is a CONFIG-ONLY rule, so startup validation catches it too (no SSOT read)', () => {
    const startup = validateCorporaConfig(root);

    expect(startup.ok).toBe(false);
    expect(subjectsFor(startup.findings, 'profile-corpus-filename-mismatch')).toEqual(['beta']);
  });
});

describe('AUDIT-10 — profile `defaultSources` must conform AND exist', () => {
  const root = path.join(CORPORA, 'validate-profile-default-sources');
  const result = validateCorpora(root, path.join(SOURCES, 'validate-valid'), NO_CAPABILITIES);

  it('rejects a default id sitting in ANOTHER corpus\'s namespace (BE001 in alpha)', () => {
    const finding = only(result.findings, 'profile-default-source-nonconforming');

    expect(finding.subject).toBe('alpha-browser/BE001');
    expect(finding.message).toContain('BE001');
    expect(finding.message).toContain('alpha');
    // SC-005: name every policy that was tried, as `source-id-nonconforming` does.
    expect(finding.message).toMatch(/conforms to NONE/);
    expect(finding.message).toContain('prefix "AL" + padWidth 3');
  });

  it('rejects a conforming default id that names no SSOT record (AL999)', () => {
    const finding = only(result.findings, 'profile-unknown-default-source');

    expect(finding.subject).toBe('alpha-browser/AL999');
    expect(finding.message).toContain('AL999');
    expect(finding.message).toMatch(/no such Source/i);
  });

  it('accepts the default that both conforms and exists (AL001) — the rules are targeted', () => {
    for (const rule of ['profile-default-source-nonconforming', 'profile-unknown-default-source']) {
      expect(result.findings.filter((f) => f.rule === rule && f.subject.endsWith('/AL001'))).toEqual(
        [],
      );
    }
  });

  it('EXISTENCE is full-sweep only — conformance still fires at startup (the FR-010 split)', () => {
    const startup = validateCorporaConfig(root);

    expect(subjectsFor(startup.findings, 'profile-default-source-nonconforming')).toEqual([
      'alpha-browser/BE001',
    ]);
    // Reading the SSOT at startup is exactly what FR-010 forbids, so the
    // existence rule must NOT appear here.
    expect(subjectsFor(startup.findings, 'profile-unknown-default-source')).toEqual([]);
  });
});

describe('AUDIT-24 — the CORPUS_SOURCES override is validated, not trusted', () => {
  it('rejects ids conforming to no policy of the selected corpus, naming every one', () => {
    let message = '';
    try {
      resolveBrowserSources({
        env: { COLONY_CORPUS: 'port-breton', CORPUS_SOURCES: 'ZZ-99999,QQ-1' },
        corporaRoot: REAL_CORPORA_ROOT,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('CORPUS_SOURCES');
    expect(message).toContain('ZZ-99999');
    expect(message).toContain('QQ-1');
    expect(message).toContain('port-breton');
    expect(message).toContain('PB-P');
  });

  it('names ONLY the offending ids when the override is partly valid', () => {
    let message = '';
    try {
      resolveBrowserSources({
        env: { COLONY_CORPUS: 'port-breton', CORPUS_SOURCES: 'PB-P001,ZZ-99999' },
        corporaRoot: REAL_CORPORA_ROOT,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('ZZ-99999');
    expect(message).not.toContain('PB-P001,');
    expect(message).not.toMatch(/"PB-P001"/);
  });

  it('still lets a CONFORMING override win outright over the committed defaults (FR-005)', () => {
    expect(
      resolveBrowserSources({
        env: { COLONY_CORPUS: 'port-breton', CORPUS_SOURCES: 'PB-P055, PB-P057' },
        corporaRoot: REAL_CORPORA_ROOT,
      }),
    ).toEqual(['PB-P055', 'PB-P057']);
  });

  it('applies the same check to the FILE-loaded defaults — the escape hatch is not stricter', () => {
    const selected = selectCorpus({
      corporaRoot: path.join(CORPORA, 'validate-profile-default-sources'),
      cliCorpus: 'alpha',
    });

    expect(() => deriveBrowserProfile(selected)).toThrow(/BE001/);
    expect(() => deriveBrowserProfile(selected)).toThrow(/deriveBrowserProfile/);
    // AL999 conforms — existence is the validator's job, not this pure derivation's.
    expect(() => deriveBrowserProfile(selected)).not.toThrow(/AL999/);
  });
});

describe('the REAL committed config stays clean (FR-010, the regression that matters)', () => {
  it('validateCorpora reports none of the three new rules against corpora/', () => {
    const result = validateCorpora(REAL_CORPORA_ROOT, REAL_SOURCES_DIR, {
      repositories: ['gallica', 'new-italy-museum', 'internet-archive', 'papers-past'],
      sourceQueries: ['papers-past', 'papers-past-article'],
    });

    expect(subjectsFor(result.findings, 'profile-corpus-filename-mismatch')).toEqual([]);
    expect(subjectsFor(result.findings, 'profile-default-source-nonconforming')).toEqual([]);
    expect(subjectsFor(result.findings, 'profile-unknown-default-source')).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it('all 44 committed PB-P defaults still resolve unchanged', () => {
    const sources = resolveBrowserSources({
      env: { COLONY_CORPUS: 'port-breton' },
      corporaRoot: REAL_CORPORA_ROOT,
    });

    expect(sources).toHaveLength(44);
    expect(sources.every((id) => /^PB-P\d{3}$/.test(id))).toBe(true);
  });
});
