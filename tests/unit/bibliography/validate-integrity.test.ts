import { describe, expect, it } from 'vitest';

import type { CanonicalModel } from '@/bibliography/model';
import { validate } from '@/bibliography/validate';
import type { Asset } from '@/model/asset';
import type { AssetManifestRef, IssueRef, RepositoryRecord } from '@/model/repository-record';
import type { Source } from '@/model/source';

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

/** A minimal, valid source-group {@link Source} fixture. */
function makeSourceGroup(overrides: Partial<Source> = {}): Source {
  return {
    sourceId: 'PB-P004',
    kind: 'source-group',
    titles: [{ text: 'Port-Breton Group', role: 'canonical' }],
    identifiers: [],
    ...overrides,
  };
}

/** A minimal, valid {@link RepositoryRecord} fixture. */
function makeRecord(overrides: Partial<RepositoryRecord> = {}): RepositoryRecord {
  return {
    sourceId: 'PB-P001',
    sourceArchive: 'Gallica / BnF',
    status: 'archived',
    ...overrides,
  };
}

function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    type: 'page-image',
    localPath: 'archive/cases/port-breton/monograph/la-nouvelle-france/f001.jpg',
    sourceUrl: 'https://example.org/f001.jpg',
    sha256: 'a'.repeat(64),
    format: 'image/jpeg',
    pageOrdinal: 1,
    ...overrides,
  };
}

function makeIssue(overrides: Partial<IssueRef> = {}): IssueRef {
  return {
    ark: 'ark:/12148/bpt6k1234',
    date: '1880-01-01',
    label: '1 janvier 1880',
    pageCount: 4,
    assets: [makeAsset()],
    ...overrides,
  };
}

function makeManifest(overrides: Partial<AssetManifestRef> = {}): AssetManifestRef {
  return {
    assetCount: 1,
    objectStore: {
      provider: 'backblaze-b2',
      bucket: 'colony-cults',
      key: 'archive/cases/port-breton/monograph/la-nouvelle-france',
      endpoint: 'https://s3.us-west-002.backblazeb2.com',
    },
    ...overrides,
  };
}

describe('validateOrphanRecords / validateOrphanAssets (FR-017)', () => {
  it('reports orphan-record for a Repository Record whose sourceId matches no Source, naming the record', () => {
    const record = makeRecord({ sourceId: 'PB-P999' });
    const model = makeModel({ sources: [], repositoryRecords: [record] });

    const findings = validate(model);

    const orphanRecord = findings.find((f) => f.kind === 'orphan-record');
    expect(orphanRecord).toBeDefined();
    expect(orphanRecord?.sourceId).toBe('PB-P999');
    expect(orphanRecord?.detail).toContain('PB-P999');
    expect(orphanRecord?.detail).toContain('Gallica / BnF');
  });

  it('reports orphan-asset for each per-issue asset owned by an orphaned Repository Record, naming the asset path', () => {
    const asset = makeAsset({ localPath: 'archive/cases/port-breton/periodical/le-courrier/1880-01-01_ark_12148_bpt6k1234/f001.jpg' });
    const issue = makeIssue({ assets: [asset] });
    const record = makeRecord({ sourceId: 'PB-P999', issues: [issue] });
    const model = makeModel({ sources: [], repositoryRecords: [record] });

    const findings = validate(model);

    const orphanAssets = findings.filter((f) => f.kind === 'orphan-asset');
    expect(orphanAssets).toHaveLength(1);
    expect(orphanAssets[0].path).toBe(asset.localPath);
    expect(orphanAssets[0].sourceId).toBe('PB-P999');
    expect(orphanAssets[0].detail).toContain(asset.localPath);
  });

  it('reports orphan-asset for a manifest roll-up (no per-issue breakdown) owned by an orphaned Repository Record', () => {
    const manifest = makeManifest();
    const record = makeRecord({ sourceId: 'PB-P999', manifest });
    const model = makeModel({ sources: [], repositoryRecords: [record] });

    const findings = validate(model);

    const orphanAssets = findings.filter((f) => f.kind === 'orphan-asset');
    expect(orphanAssets).toHaveLength(1);
    expect(orphanAssets[0].path).toBe(manifest.objectStore?.key);
    expect(orphanAssets[0].detail).toContain('PB-P999');
  });

  it('reports neither orphan-record nor orphan-asset when the record resolves to a real Source', () => {
    const source = makeSource();
    const record = makeRecord({ manifest: makeManifest(), issues: [makeIssue()] });
    const model = makeModel({ sources: [source], repositoryRecords: [record] });

    const findings = validate(model);

    expect(findings.filter((f) => f.kind === 'orphan-record')).toEqual([]);
    expect(findings.filter((f) => f.kind === 'orphan-asset')).toEqual([]);
  });
});

describe('validateVocab (FR-019)', () => {
  it("reports a vocab finding for status 'acquired' (not in the closed set), naming the field and value", () => {
    const source = makeSource();
    const record = makeRecord({ status: 'acquired' });
    const model = makeModel({ sources: [source], repositoryRecords: [record] });

    const findings = validate(model);

    const vocabFindings = findings.filter((f) => f.kind === 'vocab');
    expect(vocabFindings).toHaveLength(1);
    expect(vocabFindings[0].sourceId).toBe('PB-P001');
    expect(vocabFindings[0].detail).toContain('status');
    expect(vocabFindings[0].detail).toContain('acquired');
  });

  it('reports a vocab finding for an out-of-set object-store provider', () => {
    // `ObjectStoreLocation.provider` is typed as plain `string` (unlike
    // `Rights.status`, which is a closed TS union and so cannot be seeded
    // with an invalid value without an `as`-cast this house's rules forbid)
    // -- so a bad provider is representable directly, no cast needed.
    const source = makeSource();
    const record = makeRecord({
      manifest: makeManifest({
        objectStore: {
          provider: 'dropbox',
          bucket: 'colony-cults',
          key: 'archive/cases/port-breton/monograph/la-nouvelle-france',
          endpoint: 'https://example.org',
        },
      }),
    });
    const model = makeModel({ sources: [source], repositoryRecords: [record] });

    const findings = validate(model);

    const vocabFindings = findings.filter((f) => f.kind === 'vocab' && f.detail.includes('provider'));
    expect(vocabFindings).toHaveLength(1);
    expect(vocabFindings[0].detail).toContain('dropbox');
  });

  it('reports no vocab finding for a valid status/rights/provider combination', () => {
    const source = makeSource();
    const record = makeRecord({
      status: 'archived',
      rights: { ark: 'ark:/12148/bpt6k1234', status: 'public-domain', rawResponse: '', dcRights: [] },
      manifest: makeManifest(),
    });
    const model = makeModel({ sources: [source], repositoryRecords: [record] });

    expect(validate(model).filter((f) => f.kind === 'vocab')).toEqual([]);
  });

  it("does not report a vocab finding for the loader's status: '' unset sentinel (missing-required covers it instead)", () => {
    const source = makeSource();
    const record = makeRecord({ status: '' });
    const model = makeModel({ sources: [source], repositoryRecords: [record] });

    expect(validate(model).filter((f) => f.kind === 'vocab')).toEqual([]);
  });
});

describe('validateMissingRequired (FR-019)', () => {
  it('reports missing-required for a Repository Record missing status (the empty-string sentinel), naming the record', () => {
    const source = makeSource();
    const record = makeRecord({ status: '' });
    const model = makeModel({ sources: [source], repositoryRecords: [record] });

    const findings = validate(model);

    const missing = findings.filter((f) => f.kind === 'missing-required');
    expect(missing).toHaveLength(1);
    expect(missing[0].sourceId).toBe('PB-P001');
    expect(missing[0].detail).toContain('status');
    expect(missing[0].detail).toContain('PB-P001');
  });

  it('reports missing-required for a Source missing titles', () => {
    const source = makeSource({ titles: [] });
    const model = makeModel({ sources: [source] });

    const findings = validate(model);

    const missing = findings.filter((f) => f.kind === 'missing-required');
    expect(missing).toHaveLength(1);
    expect(missing[0].detail).toContain('titles');
  });

  it('reports no missing-required finding for a fully-populated Source + Repository Record', () => {
    const source = makeSource();
    const record = makeRecord();
    const model = makeModel({ sources: [source], repositoryRecords: [record] });

    expect(validate(model).filter((f) => f.kind === 'missing-required')).toEqual([]);
  });
});

describe('validateDuplicateCopies (data-model)', () => {
  it('reports duplicate-copy for a second Repository Record sharing (sourceId, sourceArchive) with the first', () => {
    const source = makeSource();
    const recordA = makeRecord();
    const recordB = makeRecord();
    const model = makeModel({ sources: [source], repositoryRecords: [recordA, recordB] });

    const findings = validate(model);

    const duplicates = findings.filter((f) => f.kind === 'duplicate-copy');
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].sourceId).toBe('PB-P001');
    expect(duplicates[0].detail).toContain('PB-P001');
    expect(duplicates[0].detail).toContain('Gallica / BnF');
  });

  it('reports no duplicate-copy finding when every (sourceId, sourceArchive) pair is unique', () => {
    const source = makeSource();
    const recordA = makeRecord({ sourceArchive: 'Gallica / BnF' });
    const recordB = makeRecord({ sourceArchive: 'State Library of Queensland' });
    const model = makeModel({ sources: [source], repositoryRecords: [recordA, recordB] });

    expect(validate(model).filter((f) => f.kind === 'duplicate-copy')).toEqual([]);
  });
});

describe('validateSingleChecksum (FR-006)', () => {
  // `RepositoryRecord.manifest` is statically typed as `AssetManifestRef |
  // undefined` -- no code path in this codebase can produce a scalar
  // checksum there, and constructing one here would require an `as`-cast
  // this house's rules forbid. This check is therefore a runtime guard on
  // an invariant no fixture can currently violate; the "no false positive on
  // a well-formed manifest" guarantee is what IS representable, and is
  // covered by the "fully consistent model" test below.
  it('reports no single-checksum finding for a well-formed AssetManifestRef', () => {
    const source = makeSource();
    const record = makeRecord({ manifest: makeManifest() });
    const model = makeModel({ sources: [source], repositoryRecords: [record] });

    expect(validate(model).filter((f) => f.kind === 'single-checksum')).toEqual([]);
  });
});

describe('validate -- full consistency (SC-007)', () => {
  it('reports NO findings for a fully consistent model (no false positives)', () => {
    const source = makeSource();
    const record = makeRecord({
      manifest: makeManifest(),
      rights: { ark: 'ark:/12148/bpt6k1234', status: 'public-domain', rawResponse: '', dcRights: [] },
      identifiers: [{ type: 'ark', value: 'ark:/12148/bpt6k1234' }],
    });
    const model = makeModel({ sources: [source], repositoryRecords: [record] });

    expect(validate(model)).toEqual([]);
  });

  it('composes identifier-leak findings together with US5 integrity findings in one result', () => {
    const source = makeSource();
    const orphanRecord = makeRecord({ sourceId: 'PB-P999', sourceArchive: 'Somewhere' });
    const model = makeModel({
      sources: [source],
      repositoryRecords: [makeRecord({ status: '' }), orphanRecord],
      identifierLeaks: [
        {
          onLevel: 'source',
          sourceId: 'PB-P001',
          type: 'ark',
          value: 'ark:/12148/bpt6k1234',
          expectedLevel: 'copy',
        },
      ],
    });

    const findings = validate(model);

    expect(findings.some((f) => f.kind === 'identifier-leak')).toBe(true);
    expect(findings.some((f) => f.kind === 'orphan-record')).toBe(true);
    expect(findings.some((f) => f.kind === 'missing-required')).toBe(true);
  });
});

describe('validateSourceGroups wired into validate() aggregator', () => {
  it('surfaces a group-has-repository-records finding via validate() when a source-group carries a repository record', () => {
    const group = makeSourceGroup();
    const record = makeRecord({ sourceId: 'PB-P004', sourceArchive: 'Gallica / BnF' });
    const model = makeModel({ sources: [group], repositoryRecords: [record] });

    const findings = validate(model);

    const groupRecordFindings = findings.filter((f) => f.kind === 'group-has-repository-records');
    expect(groupRecordFindings).toHaveLength(1);
    expect(groupRecordFindings[0].sourceId).toBe('PB-P004');
    expect(groupRecordFindings[0].detail).toContain('PB-P004');
    expect(groupRecordFindings[0].detail).toMatch(/must not hold repository records/);
  });

  it('reports no source-group findings for a clean model with a valid group and members', () => {
    const group = makeSourceGroup({ sourceId: 'PB-P004' });
    const member1 = makeSource({ sourceId: 'PB-P005', partOf: 'PB-P004' });
    const member2 = makeSource({ sourceId: 'PB-P006', partOf: 'PB-P004' });
    const model = makeModel({ sources: [group, member1, member2] });

    const findings = validate(model);

    const sourceGroupFindings = findings.filter(
      (f) =>
        f.kind === 'group-has-repository-records' ||
        f.kind === 'dangling-part-of' ||
        f.kind === 'part-of-not-a-group',
    );
    expect(sourceGroupFindings).toHaveLength(0);
  });
});
