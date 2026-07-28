import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadCorpusManifest, listCorpusManifests } from '@/corpus/manifest';

const FIXTURES_ROOT = join(__dirname, '..', '..', 'tests', 'fixtures', 'corpora');
const MANIFEST_CASES_ROOT = join(FIXTURES_ROOT, 'manifest-cases');
const LIST_CASES_ROOT = join(FIXTURES_ROOT, 'list-cases');
const EMPTY_ROOT = join(FIXTURES_ROOT, 'empty-root');
const ARBITRARY_ROOT = join(FIXTURES_ROOT, 'an-arbitrary-place');

describe('loadCorpusManifest', () => {
  it('accepts a valid manifest', () => {
    const manifest = loadCorpusManifest(MANIFEST_CASES_ROOT, 'valid');

    expect(manifest).toEqual({
      schemaVersion: 1,
      id: 'valid',
      cases: ['alpha-case'],
      sourceIds: [{ prefix: 'AL', padWidth: 3, allocatable: true }],
      requiredCapabilities: { repositories: ['gallica'], sourceQueries: [] },
      archiveLayoutOverrides: null,
    });
  });

  it('accepts a manifest with archiveLayoutOverrides populated', () => {
    const manifest = loadCorpusManifest(MANIFEST_CASES_ROOT, 'with-overrides');

    expect(manifest.archiveLayoutOverrides).toEqual({
      'AL-001': {
        relativePath: 'cases/alpha-case/AL-001/legacy',
        reason: 'legacy path predates the generic layout rule',
      },
    });
  });

  it('loads correctly from an arbitrary injected corporaRoot (FR-016 proof)', () => {
    const manifest = loadCorpusManifest(ARBITRARY_ROOT, 'zzz-custom');

    expect(manifest.id).toBe('zzz-custom');
    expect(manifest.sourceIds).toEqual([{ prefix: 'ZZ', padWidth: 5, allocatable: true }]);
  });

  it('rejects an unsupported schemaVersion', () => {
    expect(() => loadCorpusManifest(MANIFEST_CASES_ROOT, 'unsupported-version')).toThrow(
      /unsupported schemaVersion/,
    );
  });

  it('rejects malformed YAML', () => {
    expect(() => loadCorpusManifest(MANIFEST_CASES_ROOT, 'malformed')).toThrow(/malformed YAML/);
  });

  it('rejects a manifest whose id does not equal its basename', () => {
    expect(() => loadCorpusManifest(MANIFEST_CASES_ROOT, 'id-mismatch')).toThrow(
      /does not match the file's basename/,
    );
  });

  it('rejects a bad case-id', () => {
    expect(() => loadCorpusManifest(MANIFEST_CASES_ROOT, 'bad-case')).toThrow(
      /"cases\[0\]".*must match/,
    );
  });

  it('rejects zero cases', () => {
    expect(() => loadCorpusManifest(MANIFEST_CASES_ROOT, 'zero-cases')).toThrow(
      /"cases" must contain at least one case id/,
    );
  });

  it('rejects a duplicate case id within one manifest', () => {
    expect(() => loadCorpusManifest(MANIFEST_CASES_ROOT, 'duplicate-case')).toThrow(
      /duplicate case id/,
    );
  });

  it('rejects a bad source-id prefix (lowercase start)', () => {
    expect(() => loadCorpusManifest(MANIFEST_CASES_ROOT, 'bad-prefix')).toThrow(
      /"sourceIds\[0\]"\.prefix.*must match/,
    );
  });

  it('rejects a bad source-id prefix (leading digit)', () => {
    expect(() => loadCorpusManifest(MANIFEST_CASES_ROOT, 'bad-prefix-leading-digit')).toThrow(
      /"sourceIds\[0\]"\.prefix.*must match/,
    );
  });

  it('rejects a bad source-id prefix (illegal character)', () => {
    expect(() => loadCorpusManifest(MANIFEST_CASES_ROOT, 'bad-prefix-illegal-char')).toThrow(
      /"sourceIds\[0\]"\.prefix.*must match/,
    );
  });

  it('rejects a bad source-id prefix (empty string)', () => {
    expect(() => loadCorpusManifest(MANIFEST_CASES_ROOT, 'bad-prefix-empty')).toThrow(
      /"sourceIds\[0\]"\.prefix.*must match/,
    );
  });

  it('accepts the shipped Port Breton prefix "PB-P" with no trailing delimiter (regression guard, FR-002a)', () => {
    const manifest = loadCorpusManifest(MANIFEST_CASES_ROOT, 'shipped-prefix');
    expect(manifest.sourceIds).toEqual([{ prefix: 'PB-P', padWidth: 3, allocatable: true }]);
  });

  it('rejects a padWidth outside 1..8', () => {
    expect(() => loadCorpusManifest(MANIFEST_CASES_ROOT, 'bad-padwidth')).toThrow(
      /"sourceIds\[0\]"\.padWidth.*must be an integer between 1 and 8/,
    );
  });

  it('rejects an archive-override entry carrying an unknown key', () => {
    expect(() => loadCorpusManifest(MANIFEST_CASES_ROOT, 'bad-override-unknown-key')).toThrow(
      /unknown key "extraField"/,
    );
  });

  it('rejects an unknown top-level key (guards against spec-2 fields, FR-012)', () => {
    expect(() => loadCorpusManifest(MANIFEST_CASES_ROOT, 'unknown-top-level-key')).toThrow(
      /unknown key "discoveryMechanism"/,
    );
  });

  it('rejects a missing file with a descriptive, locating error', () => {
    expect(() => loadCorpusManifest(MANIFEST_CASES_ROOT, 'does-not-exist')).toThrow(
      /cannot read file/,
    );
  });

  it('never accepts spec-2 fields discoveryMechanism / dateNormalizer (FR-012, INV-8)', () => {
    const manifest = loadCorpusManifest(MANIFEST_CASES_ROOT, 'valid');
    expect(manifest).not.toHaveProperty('discoveryMechanism');
    expect(manifest).not.toHaveProperty('dateNormalizer');
  });
});

describe('loadCorpusManifest — multiple source-ID policies (FR-002b, INV-15)', () => {
  it('accepts a corpus declaring TWO policies, one allocatable (the Port Breton shape)', () => {
    const manifest = loadCorpusManifest(MANIFEST_CASES_ROOT, 'two-policies');

    expect(manifest.sourceIds).toEqual([
      { prefix: 'PB-P', padWidth: 3, allocatable: true },
      { prefix: 'PB-S', padWidth: 3, allocatable: false },
    ]);
  });

  it('rejects an EMPTY sourceIds list', () => {
    expect(() => loadCorpusManifest(MANIFEST_CASES_ROOT, 'empty-source-ids')).toThrow(
      /"sourceIds" must declare at least one ID policy/,
    );
  });

  it('rejects ZERO allocatable policies', () => {
    expect(() => loadCorpusManifest(MANIFEST_CASES_ROOT, 'zero-allocatable')).toThrow(
      /"sourceIds" declares 0 policies with "allocatable: true".*EXACTLY ONE/s,
    );
  });

  it('rejects TWO allocatable policies', () => {
    expect(() => loadCorpusManifest(MANIFEST_CASES_ROOT, 'two-allocatable')).toThrow(
      /"sourceIds" declares 2 policies with "allocatable: true".*EXACTLY ONE/s,
    );
  });

  it('names the offending prefixes when the allocatable count is wrong', () => {
    expect(() => loadCorpusManifest(MANIFEST_CASES_ROOT, 'two-allocatable')).toThrow(
      /"AL-P", "AL-S"/,
    );
  });

  it('rejects a policy entry with no "allocatable" field (no defaulting)', () => {
    expect(() => loadCorpusManifest(MANIFEST_CASES_ROOT, 'missing-allocatable')).toThrow(
      /"sourceIds\[0\]"\.allocatable undefined must be a boolean/,
    );
  });

  it('rejects the RETIRED singular object shape rather than coercing it', () => {
    expect(() => loadCorpusManifest(MANIFEST_CASES_ROOT, 'source-ids-retired-object')).toThrow(
      /"sourceIds" must be a non-empty list.*retired schema shape/s,
    );
  });
});

describe('listCorpusManifests', () => {
  it('enumerates every manifest under an injected root', () => {
    const manifests = listCorpusManifests(LIST_CASES_ROOT);

    expect(manifests.map((manifest) => manifest.id).sort()).toEqual(['alpha', 'beta']);
  });

  it('excludes browser-profile files (<id>.browser.yml) from manifest enumeration', () => {
    const manifests = listCorpusManifests(LIST_CASES_ROOT);

    expect(manifests.some((manifest) => manifest.id === 'alpha-browser')).toBe(false);
  });

  it('returns an empty array for a root with no committed manifests', () => {
    expect(listCorpusManifests(EMPTY_ROOT)).toEqual([]);
  });

  it('throws a descriptive error when corporaRoot does not exist', () => {
    expect(() => listCorpusManifests(join(FIXTURES_ROOT, 'does-not-exist'))).toThrow(
      /directory does not exist/,
    );
  });

  it('loads from an arbitrary injected corporaRoot, not a hardcoded convention (FR-016 proof)', () => {
    const manifests = listCorpusManifests(ARBITRARY_ROOT);

    expect(manifests.map((manifest) => manifest.id)).toEqual(['zzz-custom']);
  });
});
