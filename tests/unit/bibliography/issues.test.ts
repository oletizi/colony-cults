import { describe, expect, it } from 'vitest';

import { censusKey, deriveModel } from '@/bibliography/derive';
import type { RollupProvenance } from '@/bibliography/derive';
import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import type { LoadedSource } from '@/bibliography/load';
import type { Census } from '@/model/census';
import type { Source } from '@/model/source';

/**
 * Unit tests for the Issue layer (US4/T024): a `kind === 'periodical'`
 * Repository Record that declares a `census` pointer enumerates its issues
 * from the census, in census order, attaching each issue's mirrored assets by
 * their `<date>_<ark>` issue-dir segment. Every fixture here is in-memory --
 * `censusByKey` is built directly (no `loadCensus`/disk I/O), and
 * `RollupProvenance` entries stand in for the archive's per-asset provenance
 * (no real archive object store required).
 */

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    sourceId: 'PB-P001',
    kind: 'periodical',
    titles: [{ text: 'La Nouvelle France', role: 'canonical' }],
    identifiers: [],
    ...overrides,
  };
}

function makeLoaded(overrides: Partial<LoadedSource> = {}): LoadedSource {
  return {
    source: makeSource(),
    records: [],
    identifierLeaks: [],
    ...overrides,
  };
}

function makeRollup(overrides: Partial<RollupProvenance> = {}): RollupProvenance {
  return {
    source_archive: 'Gallica / BnF',
    local_path:
      'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k5603637g/f001.jpg',
    object_store: null,
    type: 'page-image',
    sha256: 'a'.repeat(64),
    format: 'image/jpeg',
    original_url: 'https://gallica.bnf.fr/iiif/ark:/12148/bpt6k5603637g/f1/full/full/0/native.jpg',
    ...overrides,
  };
}

/** Three real-shaped PB-P001 census issues (a slice of the real 78-issue census). */
const CENSUS: Census = {
  sourceId: 'PB-P001',
  gallicaArk: 'ark:/12148/cb328261098/date',
  builtAt: '2026-07-08',
  totalIssues: 3,
  issues: [
    { ark: 'bpt6k5603637g', date: '1879-07-15', label: '15 juillet 1879', pageCount: 12 },
    { ark: 'bpt6k56068358', date: '1879-08-15', label: '15 août 1879', pageCount: 8 },
    { ark: 'bpt6k5606840k', date: '1879-09-15', label: '15 septembre 1879', pageCount: 8 },
  ],
};

const GALLICA_WITH_CENSUS: AuthoredRepositoryRecord = {
  sourceArchive: 'Gallica / BnF',
  status: 'collecting',
  census: 'data/census/PB-P001-la-nouvelle-france.json',
};

describe('deriveModel: Issue layer (US4/T024)', () => {
  it('derives issues.length === census.totalIssues, in census order, with matching ark/date/label/pageCount', () => {
    const authored: LoadedSource[] = [makeLoaded({ records: [GALLICA_WITH_CENSUS] })];
    const censusByKey = new Map([[censusKey('PB-P001', 'Gallica / BnF'), CENSUS]]);

    const model = deriveModel(authored, new Map(), censusByKey);
    const record = model.repositoryRecords.find((r) => r.sourceArchive === 'Gallica / BnF');

    expect(record?.issues).toHaveLength(CENSUS.totalIssues);
    expect(record?.issues?.map((issue) => issue.ark)).toEqual(CENSUS.issues.map((issue) => issue.ark));
    CENSUS.issues.forEach((issue, index) => {
      expect(record?.issues?.[index]).toMatchObject({
        ark: issue.ark,
        date: issue.date,
        label: issue.label,
        pageCount: issue.pageCount,
      });
    });
  });

  it('attaches mirrored assets to their issue by the <date>_<ark> issue-dir segment; a matchless issue gets assets: [] (known-but-unacquired, no throw)', () => {
    const authored: LoadedSource[] = [makeLoaded({ records: [GALLICA_WITH_CENSUS] })];
    const provenance: RollupProvenance[] = [
      makeRollup({
        local_path:
          'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k5603637g/f001.jpg',
      }),
      makeRollup({
        local_path:
          'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k5603637g/f002.jpg',
      }),
    ];
    const censusByKey = new Map([[censusKey('PB-P001', 'Gallica / BnF'), CENSUS]]);

    const model = deriveModel(authored, new Map([['PB-P001', provenance]]), censusByKey);
    const record = model.repositoryRecords.find((r) => r.sourceArchive === 'Gallica / BnF');
    expect(record?.issues).toBeDefined();

    const acquiredIssue = record?.issues?.find((issue) => issue.ark === 'bpt6k5603637g');
    expect(acquiredIssue?.assets).toHaveLength(2);
    expect(acquiredIssue?.assets[0]).toMatchObject({
      type: 'page-image',
      sha256: 'a'.repeat(64),
      format: 'image/jpeg',
      sourceUrl: 'https://gallica.bnf.fr/iiif/ark:/12148/bpt6k5603637g/f1/full/full/0/native.jpg',
      pageOrdinal: null,
    });

    // A different census issue with no mirrored assets is a VALID
    // known-but-unacquired state (edge case per spec) -- assets: [], no throw.
    const unacquiredIssue = record?.issues?.find((issue) => issue.ark === 'bpt6k56068358');
    expect(unacquiredIssue?.assets).toEqual([]);
  });

  it('exposes an AssetManifestRef -- not a scalar checksum -- on every Repository Record (FR-006)', () => {
    const authored: LoadedSource[] = [makeLoaded({ records: [GALLICA_WITH_CENSUS] })];
    const provenance: RollupProvenance[] = [
      makeRollup({
        local_path:
          'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k5603637g/f001.jpg',
      }),
      makeRollup({
        local_path:
          'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k5603637g/f002.jpg',
      }),
    ];
    const censusByKey = new Map([[censusKey('PB-P001', 'Gallica / BnF'), CENSUS]]);

    const model = deriveModel(authored, new Map([['PB-P001', provenance]]), censusByKey);
    const record = model.repositoryRecords.find((r) => r.sourceArchive === 'Gallica / BnF');

    // `RepositoryRecord` (src/model/repository-record.ts) has no scalar
    // `checksum` field at all -- `manifest: AssetManifestRef` is the only
    // storage-axis representation (FR-006/FR-011), asserted here by shape.
    expect(record?.manifest).toBeDefined();
    expect(record?.manifest?.assetCount).toBe(2);
    expect(record?.manifest?.objectStore).toBeNull();
    expect(record?.manifest?.localPath).toBe(
      'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k5603637g',
    );
  });

  it('a monograph record has NO issues field (Issue layer absent)', () => {
    const monographSource = makeSource({ sourceId: 'PB-P002', kind: 'monograph' });
    const monographRecord: AuthoredRepositoryRecord = {
      sourceArchive: 'Gallica / BnF',
      status: 'collected',
    };
    const authored: LoadedSource[] = [
      makeLoaded({ source: monographSource, records: [monographRecord] }),
    ];

    const model = deriveModel(authored, new Map(), new Map());
    const record = model.repositoryRecords.find((r) => r.sourceId === 'PB-P002');

    expect(record).toBeDefined();
    expect(record?.issues).toBeUndefined();
  });

  it('an authored-only periodical record with no census pointer (e.g. SLQ) has no issues field', () => {
    const slq: AuthoredRepositoryRecord = {
      sourceArchive: 'State Library of Queensland',
      status: 'to-collect',
    };
    const authored: LoadedSource[] = [makeLoaded({ records: [slq] })];

    const model = deriveModel(authored, new Map(), new Map());
    const record = model.repositoryRecords.find(
      (r) => r.sourceArchive === 'State Library of Queensland',
    );

    expect(record).toBeDefined();
    expect(record?.issues).toBeUndefined();
  });

  it('fails loud when a record declares a census pointer but no matching census data was supplied', () => {
    const authored: LoadedSource[] = [makeLoaded({ records: [GALLICA_WITH_CENSUS] })];

    expect(() => deriveModel(authored, new Map(), new Map())).toThrow(/census/i);
  });
});
