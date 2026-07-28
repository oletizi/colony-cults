import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { CorpusManifest } from '@/corpus/manifest';
import { readSourceIdentityIndex } from '@/corpus/source-index';
import { validateRepositoryWide } from '@/corpus/validate-repository';
import {
  validateCapabilitySubset,
  validateCorpora,
  assertCorporaValid,
  type InstalledCapabilities,
} from '@/corpus/validate';
import type { CorpusValidationFinding, CorpusValidationResult } from '@/corpus/validate-types';

const FIXTURES = join(__dirname, '..', '..', 'tests', 'fixtures');
const CORPORA = join(FIXTURES, 'corpora');
const SOURCES = join(FIXTURES, 'sources');

/** Capabilities the fixture corpora legitimately name. */
const INSTALLED: InstalledCapabilities = {
  repositories: ['gallica', 'papers-past'],
  sourceQueries: ['papers-past'],
};

function rules(result: CorpusValidationResult): string[] {
  return result.findings.map((finding) => finding.rule);
}

function findingFor(
  result: CorpusValidationResult,
  rule: string,
  subject?: string,
): CorpusValidationFinding {
  const match = result.findings.find(
    (finding) => finding.rule === rule && (subject === undefined || finding.subject === subject),
  );
  if (match === undefined) {
    throw new Error(
      `expected a ${rule} finding${subject === undefined ? '' : ` for ${subject}`}; got: ` +
        JSON.stringify(result.findings, null, 2),
    );
  }
  return match;
}

describe('validateCorpora — the valid set', () => {
  it('accepts a valid repository with zero findings', () => {
    const result = validateCorpora(
      join(CORPORA, 'validate-valid'),
      join(SOURCES, 'validate-valid'),
      INSTALLED,
    );

    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('accepts an empty corpora root against an empty sources dir', () => {
    const result = validateCorpora(join(CORPORA, 'empty-root'), join(SOURCES, 'empty'), INSTALLED);

    expect(result.ok).toBe(true);
  });

  it('assertCorporaValid does not throw for the valid set', () => {
    expect(() =>
      assertCorporaValid(
        join(CORPORA, 'validate-valid'),
        join(SOURCES, 'validate-valid'),
        INSTALLED,
      ),
    ).not.toThrow();
  });
});

describe('validateCorpora — repository-wide rules (INV-7, INV-11)', () => {
  it('rejects a prefix EQUAL to another corpus prefix', () => {
    const result = validateCorpora(
      join(CORPORA, 'validate-prefix-equal'),
      join(SOURCES, 'empty'),
      INSTALLED,
    );

    const finding = findingFor(result, 'prefix-not-disjoint');
    expect(finding.message).toContain('PB-P');
    expect(finding.message).toContain('alpha');
    expect(finding.message).toContain('beta');
    expect(result.ok).toBe(false);
  });

  it('rejects a prefix that is a LEADING SUBSTRING of another prefix', () => {
    const result = validateCorpora(
      join(CORPORA, 'validate-prefix-substring'),
      join(SOURCES, 'empty'),
      INSTALLED,
    );

    const finding = findingFor(result, 'prefix-not-disjoint');
    expect(finding.message).toContain('PB-P');
    expect(finding.message).toContain('PB-PX');
    expect(finding.message).toMatch(/leading substring/i);
  });

  it('rejects a case id shared across two manifests', () => {
    const result = validateCorpora(
      join(CORPORA, 'validate-duplicate-case'),
      join(SOURCES, 'empty'),
      INSTALLED,
    );

    const finding = findingFor(result, 'duplicate-case-id', 'shared-case');
    expect(finding.message).toContain('alpha');
    expect(finding.message).toContain('beta');
  });

  it('rejects a duplicate corpus id (pure repository-wide rule)', () => {
    const twin = (prefix: string): CorpusManifest => ({
      schemaVersion: 1,
      id: 'alpha',
      cases: [`case-${prefix.toLowerCase()}`],
      sourceIds: { prefix, padWidth: 3 },
      requiredCapabilities: { repositories: [], sourceQueries: [] },
      archiveLayoutOverrides: null,
    });

    const findings = validateRepositoryWide([twin('AL'), twin('BE')], []);

    const duplicate = findings.find((finding) => finding.rule === 'duplicate-corpus-id');
    expect(duplicate).toBeDefined();
    expect(duplicate?.subject).toBe('alpha');
  });

  it('rejects a padWidth outside 1..8 (delegated to the manifest loader)', () => {
    const result = validateCorpora(
      join(CORPORA, 'validate-bad-padwidth'),
      join(SOURCES, 'empty'),
      INSTALLED,
    );

    const finding = findingFor(result, 'manifest-unreadable', 'alpha');
    expect(finding.message).toContain('padWidth');
    expect(finding.message).toContain('between 1 and 8');
  });

  it('rejects a browser profile referencing an unknown corpus', () => {
    const result = validateCorpora(
      join(CORPORA, 'validate-profile-unknown-corpus'),
      join(SOURCES, 'empty'),
      INSTALLED,
    );

    const finding = findingFor(result, 'profile-unknown-corpus');
    expect(finding.message).toContain('no-such-corpus');
    expect(finding.message).toContain('alpha-browser');
  });

  it('rejects two browser profiles sharing one profile id', () => {
    const result = validateCorpora(
      join(CORPORA, 'validate-duplicate-profile-id'),
      join(SOURCES, 'empty'),
      INSTALLED,
    );

    const finding = findingFor(result, 'duplicate-profile-id', 'shared-profile-id');
    expect(finding.message).toContain('alpha.browser.yml');
    expect(finding.message).toContain('beta.browser.yml');
  });
});

describe('validateCorpora — archive-layout overrides (INV-10, FR-007)', () => {
  const result = validateCorpora(
    join(CORPORA, 'validate-overrides'),
    join(SOURCES, 'validate-overrides'),
    INSTALLED,
  );

  it('rejects an override referencing an unknown Source', () => {
    const finding = findingFor(result, 'override-unknown-source', 'alpha/AL999');
    expect(finding.message).toContain('AL999');
    expect(finding.message).toMatch(/no such Source/i);
  });

  it('rejects an override for a Source belonging to another corpus', () => {
    const finding = findingFor(result, 'override-source-not-in-corpus', 'alpha/BE001');
    expect(finding.message).toContain('beta-case');
    expect(finding.message).toContain('alpha');
  });

  it('rejects an absolute override path', () => {
    const finding = findingFor(result, 'override-path-not-relative', 'alpha/AL001');
    expect(finding.message).toContain('/absolute/escape/hatch');
    expect(finding.message).toMatch(/must be relative/i);
  });

  it('rejects an override path that escapes the archive root', () => {
    const finding = findingFor(result, 'override-path-escapes-archive-root', 'alpha/AL002');
    expect(finding.message).toContain('../../outside-the-archive');
    expect(finding.message).toMatch(/escapes the archive root/i);
  });

  it('rejects two Sources resolving to the same archive location', () => {
    const finding = findingFor(result, 'override-duplicate-location');
    expect(finding.message).toContain('cases/alpha-case/shared-location');
    expect(finding.message).toContain('AL003');
    expect(finding.message).toContain('AL004');
  });

  it('rejects an override missing a reason (delegated to the manifest loader)', () => {
    const missingReason = validateCorpora(
      join(CORPORA, 'validate-override-missing-reason'),
      join(SOURCES, 'empty'),
      INSTALLED,
    );

    const finding = findingFor(missingReason, 'manifest-unreadable', 'alpha');
    expect(finding.message).toContain('reason');
    expect(finding.message).toContain('non-empty string');
  });
});

describe('validateCorpora — existing data (INV-12, FR-002a)', () => {
  it('rejects a Source ID that does not conform to its corpus ID policy', () => {
    const result = validateCorpora(
      join(CORPORA, 'validate-existing-data'),
      join(SOURCES, 'validate-nonconforming'),
      INSTALLED,
    );

    const wrongWidth = findingFor(result, 'source-id-nonconforming', 'AL0099');
    expect(wrongWidth.message).toContain('AL');
    expect(wrongWidth.message).toContain('padWidth 3');

    const wrongPrefix = findingFor(result, 'source-id-nonconforming', 'XX001');
    expect(wrongPrefix.message).toContain('alpha');

    expect(rules(result)).toContain('source-case-not-in-any-corpus');
    expect(findingFor(result, 'source-case-not-in-any-corpus', 'ZZ001').message).toContain(
      'nowhere-case',
    );
  });

  it('rejects a duplicated existing Source ID', () => {
    const result = validateCorpora(
      join(CORPORA, 'validate-existing-data'),
      join(SOURCES, 'validate-duplicate-source-id'),
      INSTALLED,
    );

    const finding = findingFor(result, 'duplicate-source-id', 'AL001');
    expect(finding.message).toContain('AL001-stray-copy.yml');
  });

  it('rejects a next-allocated ID that would collide with an existing ID', () => {
    const result = validateCorpora(
      join(CORPORA, 'validate-existing-data'),
      join(SOURCES, 'validate-next-id-collision'),
      INSTALLED,
    );

    const finding = findingFor(result, 'next-source-id-collision', 'alpha');
    expect(finding.message).toContain('AL003');
    expect(finding.message).toMatch(/next allocated/i);
  });

  it('reads an identity index straight from a sources dir', () => {
    const index = readSourceIdentityIndex(join(SOURCES, 'validate-valid'));

    expect(index.problems).toEqual([]);
    expect(index.entries.map((entry) => entry.sourceId)).toEqual(['AL001', 'AL002', 'BE001']);
    expect(index.entries[0].caseId).toBe('alpha-case');
  });

  it('throws when the sources dir does not exist (no silent empty index)', () => {
    expect(() => readSourceIdentityIndex(join(SOURCES, 'no-such-dir'))).toThrow(
      /does not exist/,
    );
  });
});

describe('validateCorpora — capability subset (INV-9, FR-008)', () => {
  it('rejects requiredCapabilities that are not a subset of installed', () => {
    const result = validateCorpora(
      join(CORPORA, 'validate-capabilities'),
      join(SOURCES, 'empty'),
      INSTALLED,
    );

    const repository = findingFor(result, 'capability-not-installed', 'alpha/repositories/unobtainium');
    expect(repository.message).toContain('unobtainium');
    expect(repository.message).toContain('gallica');

    const query = findingFor(result, 'capability-not-installed', 'alpha/sourceQueries/nonesuch');
    expect(query.message).toContain('nonesuch');
  });

  it('validateCapabilitySubset is usable on its own at selection time', () => {
    const manifest: CorpusManifest = {
      schemaVersion: 1,
      id: 'alpha',
      cases: ['alpha-case'],
      sourceIds: { prefix: 'AL', padWidth: 3 },
      requiredCapabilities: { repositories: ['gallica'], sourceQueries: ['missing-query'] },
      archiveLayoutOverrides: null,
    };

    const findings = validateCapabilitySubset(manifest, INSTALLED);

    expect(findings).toHaveLength(1);
    expect(findings[0].subject).toBe('alpha/sourceQueries/missing-query');
  });
});

describe('assertCorporaValid — fail loud (FR-015 strict policy)', () => {
  it('throws listing EVERY finding, not just the first', () => {
    let message = '';
    try {
      assertCorporaValid(
        join(CORPORA, 'validate-overrides'),
        join(SOURCES, 'validate-overrides'),
        INSTALLED,
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('override-unknown-source');
    expect(message).toContain('override-path-not-relative');
    expect(message).toContain('override-path-escapes-archive-root');
    expect(message).toContain('override-duplicate-location');
  });

  it('names the injected roots so a fixture run is diagnosable (FR-016)', () => {
    expect(() =>
      assertCorporaValid(
        join(CORPORA, 'validate-prefix-equal'),
        join(SOURCES, 'empty'),
        INSTALLED,
      ),
    ).toThrow(/validate-prefix-equal/);
  });
});
