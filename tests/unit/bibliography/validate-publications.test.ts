import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CanonicalModel } from '@/bibliography/model';
import { validate, validatePublicationManifests } from '@/bibliography/validate';
import { validateDuplicatePublications, validatePublicationRightsBasis } from '@/bibliography/validate-checks';
import type { Publication } from '@/model/publication';
import type { Source } from '@/model/source';

/**
 * T011: `Source.publications[]` validation checks --
 * specs/008-edition-publishing/contracts/ssot-publications.md § 2 and §
 * Invariants. Covers the two model-only checks
 * (`validateDuplicatePublications`, `validatePublicationRightsBasis`, both
 * in `@/bibliography/validate-checks`) and the one FS-touching check
 * (`validatePublicationManifests`, in `@/bibliography/validate`, sibling to
 * `validateViewDrift`).
 */

/** A minimal, otherwise-empty {@link CanonicalModel} fixture. */
function makeModel(overrides: Partial<CanonicalModel> = {}): CanonicalModel {
  return {
    sources: [],
    repositoryRecords: [],
    identifierLeaks: [],
    ...overrides,
  };
}

/** A minimal, valid {@link Source} fixture. */
function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    sourceId: 'PB-P001',
    kind: 'monograph',
    titles: [{ text: 'La Nouvelle France', role: 'canonical' }],
    identifiers: [],
    ...overrides,
  };
}

/** A minimal, valid {@link Publication} fixture. */
function makePublication(overrides: Partial<Publication> = {}): Publication {
  return {
    variant: 'english-only',
    publishedAt: '2026-07-12',
    snapshot: '3b8b1fd6a0d7f76f3c5f9a2b3da94252bbb5dd10',
    snapshotShort: '3b8b1fd6',
    cdnBase: 'https://colony-cults-cdn.oletizi.workers.dev',
    keyScheme: 'versioned',
    rightsBasis: '1881 imprint; French public domain',
    manifest: {
      manifestPath: 'bibliography/publications/PB-P001-english-only-3b8b1fd6.yml',
      issueCount: 71,
    },
    ...overrides,
  };
}

describe('validateDuplicatePublications', () => {
  it('reports duplicate-publication for a second entry sharing (variant, snapshotShort)', () => {
    const source = makeSource({
      publications: [makePublication(), makePublication({ publishedAt: '2026-07-13' })],
    });
    const model = makeModel({ sources: [source] });

    const findings = validateDuplicatePublications(model);

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('duplicate-publication');
    expect(findings[0].sourceId).toBe('PB-P001');
    expect(findings[0].detail).toContain('english-only');
    expect(findings[0].detail).toContain('3b8b1fd6');
  });

  it('reports no finding when (variant, snapshotShort) pairs are all unique', () => {
    const source = makeSource({
      publications: [
        makePublication(),
        makePublication({ variant: 'parallel', snapshotShort: 'a1b2c3d4', snapshot: 'a1b2c3d4' + '0'.repeat(32) }),
      ],
    });
    const model = makeModel({ sources: [source] });

    expect(validateDuplicatePublications(model)).toEqual([]);
  });

  it('reports no finding for a Source with no publications[] at all', () => {
    const source = makeSource();
    const model = makeModel({ sources: [source] });

    expect(validateDuplicatePublications(model)).toEqual([]);
  });
});

describe('validatePublicationRightsBasis', () => {
  it('reports missing-required for a publication with an empty rightsBasis', () => {
    const source = makeSource({ publications: [makePublication({ rightsBasis: '' })] });
    const model = makeModel({ sources: [source] });

    const findings = validatePublicationRightsBasis(model);

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('missing-required');
    expect(findings[0].sourceId).toBe('PB-P001');
    expect(findings[0].detail).toContain('rightsBasis');
    expect(findings[0].detail).toContain('PB-P001');
  });

  it('reports no finding when rightsBasis is present and non-empty', () => {
    const source = makeSource({ publications: [makePublication()] });
    const model = makeModel({ sources: [source] });

    expect(validatePublicationRightsBasis(model)).toEqual([]);
  });

  it('reports no finding for a Source with no publications[] at all', () => {
    const source = makeSource();
    const model = makeModel({ sources: [source] });

    expect(validatePublicationRightsBasis(model)).toEqual([]);
  });
});

describe('validatePublicationManifests (FS-touching, sibling to validateViewDrift)', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'validate-publications-test-'));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  function writeManifestFile(relativePath: string): void {
    const absPath = path.join(repoRoot, relativePath);
    mkdirSync(path.dirname(absPath), { recursive: true });
    writeFileSync(absPath, 'sourceId: PB-P001\nvariant: english-only\nissues: []\n', 'utf-8');
  }

  it('reports publication-manifest-missing when the referenced manifest file does not exist on disk', () => {
    const source = makeSource({ publications: [makePublication()] });
    const model = makeModel({ sources: [source] });

    const findings = validatePublicationManifests(model, { repoRoot });

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('publication-manifest-missing');
    expect(findings[0].sourceId).toBe('PB-P001');
    expect(findings[0].path).toBe('bibliography/publications/PB-P001-english-only-3b8b1fd6.yml');
    expect(findings[0].detail).toContain('PB-P001');
  });

  it('reports no finding when the referenced manifest file exists on disk', () => {
    const publication = makePublication();
    writeManifestFile(publication.manifest.manifestPath);
    const source = makeSource({ publications: [publication] });
    const model = makeModel({ sources: [source] });

    expect(validatePublicationManifests(model, { repoRoot })).toEqual([]);
  });

  it('reports no finding for a Source with no publications[] at all', () => {
    const source = makeSource();
    const model = makeModel({ sources: [source] });

    expect(validatePublicationManifests(model, { repoRoot })).toEqual([]);
  });
});

describe('publications checks wired into validate() aggregator', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'validate-publications-aggregator-test-'));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('reports no publication findings for a fully clean model (duplicate/rightsBasis run with no repoRoot)', () => {
    const source = makeSource({ publications: [makePublication()] });
    const model = makeModel({ sources: [source] });

    const findings = validate(model);

    expect(
      findings.filter(
        (f) => f.kind === 'duplicate-publication' || f.kind === 'missing-required' || f.kind === 'publication-manifest-missing',
      ),
    ).toEqual([]);
  });

  it('surfaces duplicate-publication and missing-required (rightsBasis) via validate() with no repoRoot supplied', () => {
    const source = makeSource({
      publications: [
        makePublication({ rightsBasis: '' }),
        makePublication({ rightsBasis: '', publishedAt: '2026-07-13' }),
      ],
    });
    const model = makeModel({ sources: [source] });

    const findings = validate(model);

    expect(findings.some((f) => f.kind === 'duplicate-publication')).toBe(true);
    expect(findings.some((f) => f.kind === 'missing-required' && f.detail.includes('rightsBasis'))).toBe(true);
    // The FS-touching manifest check never runs without repoRoot.
    expect(findings.some((f) => f.kind === 'publication-manifest-missing')).toBe(false);
  });

  it('surfaces publication-manifest-missing via validate() when repoRoot is supplied and the manifest is absent', () => {
    const source = makeSource({ publications: [makePublication()] });
    const model = makeModel({ sources: [source] });

    const findings = validate(model, { repoRoot });

    const manifestFindings = findings.filter((f) => f.kind === 'publication-manifest-missing');
    expect(manifestFindings).toHaveLength(1);
    expect(manifestFindings[0].sourceId).toBe('PB-P001');
  });

  it('reports NO publication findings for a fully consistent model with repoRoot supplied and manifest present', () => {
    const publication = makePublication();
    const absPath = path.join(repoRoot, publication.manifest.manifestPath);
    mkdirSync(path.dirname(absPath), { recursive: true });
    writeFileSync(absPath, 'sourceId: PB-P001\nvariant: english-only\nissues: []\n', 'utf-8');
    const source = makeSource({ publications: [publication] });
    const model = makeModel({ sources: [source] });

    const findings = validate(model, { repoRoot });

    expect(
      findings.filter(
        (f) => f.kind === 'duplicate-publication' || f.kind === 'missing-required' || f.kind === 'publication-manifest-missing',
      ),
    ).toEqual([]);
  });
});
