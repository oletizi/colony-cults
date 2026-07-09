import { describe, expect, it } from 'vitest';

import type { AuthoredRepositoryRecord, IdentifierLeak } from '@/bibliography/model';
import { deriveModel } from '@/bibliography/derive';
import type { LoadedSource } from '@/bibliography/load';
import type { ObjectStoreLocation, ProvenanceFields } from '@/archive/provenance';
import type { Source } from '@/model/source';

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    sourceId: 'PB-P001',
    kind: 'periodical',
    titles: [{ text: 'La Nouvelle France', role: 'canonical' }],
    identifiers: [],
    ...overrides,
  };
}

/** Build a {@link LoadedSource}; `identifierLeaks` defaults to none. */
function makeLoaded(overrides: Partial<LoadedSource> = {}): LoadedSource {
  return {
    source: makeSource(),
    records: [],
    identifierLeaks: [],
    ...overrides,
  };
}

function makeProvenance(overrides: Partial<ProvenanceFields> = {}): ProvenanceFields {
  return {
    id: 'PB-P001',
    title: 'La Nouvelle France',
    type: 'page-image',
    case: 'port-breton',
    language: 'French',
    source_archive: 'Gallica / BnF',
    catalog_url: 'https://gallica.bnf.fr/ark:/12148/cb328261098/date',
    original_url: 'https://gallica.bnf.fr/iiif/ark:/12148/whatever/f1/full/full/0/native.jpg',
    rights_status: 'public-domain',
    retrieved: '2026-07-08',
    local_path: 'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k1/f001.jpg',
    sha256: 'a'.repeat(64),
    format: 'image/jpeg',
    ocr_status: 'none',
    size: 12345,
    object_store: null,
    rights_raw: '<OAIRecord/>',
    notes: null,
    ...overrides,
  };
}

const OBJECT_STORE: ObjectStoreLocation = {
  provider: 'backblaze-b2',
  bucket: 'colony-cults',
  key: 'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k1/f001.jpg',
  endpoint: 'https://s3.us-west-002.backblazeb2.com',
};

describe('deriveModel', () => {
  it('(a) rolls up assets grouped by source_archive into a manifest with correct assetCount', () => {
    const authored: LoadedSource[] = [makeLoaded()];
    const provenance = [
      makeProvenance({ local_path: 'a/f001.jpg' }),
      makeProvenance({ local_path: 'a/f002.jpg' }),
      makeProvenance({ local_path: 'a/f003.jpg' }),
    ];
    const model = deriveModel(authored, new Map([['PB-P001', provenance]]));

    expect(model.repositoryRecords).toHaveLength(1);
    const record = model.repositoryRecords[0];
    expect(record.sourceArchive).toBe('Gallica / BnF');
    expect(record.manifest).toBeDefined();
    expect(record.manifest?.assetCount).toBe(3);
  });

  it('groups distinct source_archive values into separate manifests', () => {
    const authored: LoadedSource[] = [makeLoaded()];
    const provenance = [
      makeProvenance({ source_archive: 'Gallica / BnF', local_path: 'a/f001.jpg' }),
      makeProvenance({ source_archive: 'Gallica / BnF', local_path: 'a/f002.jpg' }),
      makeProvenance({ source_archive: 'State Library of Queensland', local_path: 'b/f001.jpg' }),
    ];
    const model = deriveModel(authored, new Map([['PB-P001', provenance]]));

    expect(model.repositoryRecords).toHaveLength(2);
    const gallica = model.repositoryRecords.find((r) => r.sourceArchive === 'Gallica / BnF');
    const slq = model.repositoryRecords.find(
      (r) => r.sourceArchive === 'State Library of Queensland',
    );
    expect(gallica?.manifest?.assetCount).toBe(2);
    expect(slq?.manifest?.assetCount).toBe(1);
  });

  it('sets objectStore on the manifest only when every asset in the group shares the exact same block', () => {
    const authored: LoadedSource[] = [makeLoaded()];

    const sharedProvenance = [
      makeProvenance({ local_path: 'a/f001.jpg', object_store: OBJECT_STORE }),
    ];
    const sharedModel = deriveModel(authored, new Map([['PB-P001', sharedProvenance]]));
    expect(sharedModel.repositoryRecords[0].manifest?.objectStore).toEqual(OBJECT_STORE);
    expect(sharedModel.repositoryRecords[0].manifest?.localPath).toBeUndefined();

    const differingProvenance = [
      makeProvenance({ local_path: 'a/f001.jpg', object_store: OBJECT_STORE }),
      makeProvenance({ local_path: 'a/f002.jpg', object_store: null }),
    ];
    const differingModel = deriveModel(authored, new Map([['PB-P001', differingProvenance]]));
    expect(differingModel.repositoryRecords[0].manifest?.objectStore).toBeNull();
    expect(differingModel.repositoryRecords[0].manifest?.localPath).toBe('a/f001.jpg');
  });

  it('(b) an authored-only record with no provenance SURVIVES the merge (the SLQ restoration case)', () => {
    const slqRecord: AuthoredRepositoryRecord = {
      sourceArchive: 'State Library of Queensland',
      status: 'collected',
      catalogUrl: 'https://onesearch.slq.qld.gov.au/...',
    };
    const authored: LoadedSource[] = [makeLoaded({ records: [slqRecord] })];

    // No provenance at all for this source -- assets were lost (the bug this
    // feature fixes). provenanceBySource has no entry for PB-P001.
    const model = deriveModel(authored, new Map());

    expect(model.repositoryRecords).toHaveLength(1);
    const record = model.repositoryRecords[0];
    expect(record.sourceId).toBe('PB-P001');
    expect(record.sourceArchive).toBe('State Library of Queensland');
    expect(record.status).toBe('collected');
    expect(record.catalogUrl).toBe('https://onesearch.slq.qld.gov.au/...');
    expect(record.manifest).toBeUndefined();
  });

  it('(b) an authored-only record survives alongside a different archive that DOES have provenance', () => {
    const gallicaAuthored: AuthoredRepositoryRecord = {
      sourceArchive: 'Gallica / BnF',
      status: 'collected',
    };
    const slqAuthored: AuthoredRepositoryRecord = {
      sourceArchive: 'State Library of Queensland',
      status: 'collected',
    };
    const authored: LoadedSource[] = [
      makeLoaded({ records: [gallicaAuthored, slqAuthored] }),
    ];
    const provenance = [makeProvenance({ source_archive: 'Gallica / BnF' })];
    const model = deriveModel(authored, new Map([['PB-P001', provenance]]));

    expect(model.repositoryRecords).toHaveLength(2);
    const gallica = model.repositoryRecords.find((r) => r.sourceArchive === 'Gallica / BnF');
    const slq = model.repositoryRecords.find(
      (r) => r.sourceArchive === 'State Library of Queensland',
    );
    expect(gallica?.manifest?.assetCount).toBe(1);
    expect(slq).toBeDefined();
    expect(slq?.manifest).toBeUndefined();
    expect(slq?.status).toBe('collected');
  });

  it('(c) an AUTHORED record OVERRIDES the derived one on the same (sourceId, sourceArchive) key', () => {
    const authoredRecord: AuthoredRepositoryRecord = {
      sourceArchive: 'Gallica / BnF',
      status: 'archived',
      catalogUrl: 'https://authored-catalog-url.example/',
      retrievedAt: '2026-01-01',
    };
    const authored: LoadedSource[] = [makeLoaded({ records: [authoredRecord] })];
    const provenance = [
      makeProvenance({
        source_archive: 'Gallica / BnF',
        catalog_url: 'https://derived-catalog-url.example/',
        retrieved: '2020-01-01',
        local_path: 'a/f001.jpg',
      }),
      makeProvenance({
        source_archive: 'Gallica / BnF',
        catalog_url: 'https://derived-catalog-url.example/',
        retrieved: '2020-01-01',
        local_path: 'a/f002.jpg',
      }),
    ];
    const model = deriveModel(authored, new Map([['PB-P001', provenance]]));

    expect(model.repositoryRecords).toHaveLength(1);
    const record = model.repositoryRecords[0];
    // Authored acquisition fields win.
    expect(record.status).toBe('archived');
    expect(record.catalogUrl).toBe('https://authored-catalog-url.example/');
    expect(record.retrievedAt).toBe('2026-01-01');
    // The derived manifest still attaches.
    expect(record.manifest).toBeDefined();
    expect(record.manifest?.assetCount).toBe(2);
  });

  it('a derived-only record (provenance but no authored entry) surfaces with an empty-string status sentinel', () => {
    const authored: LoadedSource[] = [makeLoaded()];
    const provenance = [
      makeProvenance({
        source_archive: 'Gallica / BnF',
        catalog_url: 'https://derived-only.example/',
        retrieved: '2021-05-05',
      }),
    ];
    const model = deriveModel(authored, new Map([['PB-P001', provenance]]));

    expect(model.repositoryRecords).toHaveLength(1);
    const record = model.repositoryRecords[0];
    expect(record.status).toBe('');
    expect(record.catalogUrl).toBe('https://derived-only.example/');
    expect(record.retrievedAt).toBe('2021-05-05');
    expect(record.manifest?.assetCount).toBe(1);
  });

  it('carries every authored Source through to CanonicalModel.sources unchanged', () => {
    const source = makeSource({ sourceId: 'PB-P002', kind: 'monograph' });
    const authored: LoadedSource[] = [makeLoaded({ source })];
    const model = deriveModel(authored, new Map());
    expect(model.sources).toEqual([source]);
  });

  it('produces no repository records for a source with neither authored records nor provenance', () => {
    const authored: LoadedSource[] = [makeLoaded()];
    const model = deriveModel(authored, new Map());
    expect(model.repositoryRecords).toEqual([]);
  });

  it('a source with no identifier leaks surfaces an empty identifierLeaks array', () => {
    const authored: LoadedSource[] = [makeLoaded()];
    const model = deriveModel(authored, new Map());
    expect(model.identifierLeaks).toEqual([]);
  });

  it('aggregates a seeded identifier leak from a loaded source into CanonicalModel.identifierLeaks', () => {
    const leak: IdentifierLeak = {
      onLevel: 'source',
      sourceId: 'PB-P001',
      type: 'ark',
      value: 'ark:/12148/whatever',
      expectedLevel: 'copy',
    };
    const authored: LoadedSource[] = [makeLoaded({ identifierLeaks: [leak] })];
    const model = deriveModel(authored, new Map());
    expect(model.identifierLeaks).toEqual([leak]);
  });

  it('aggregates identifier leaks across multiple loaded sources', () => {
    const sourceLeak: IdentifierLeak = {
      onLevel: 'source',
      sourceId: 'PB-P001',
      type: 'ark',
      value: 'ark:/12148/whatever',
      expectedLevel: 'copy',
    };
    const recordLeak: IdentifierLeak = {
      onLevel: 'record',
      sourceId: 'PB-P002',
      sourceArchive: 'Gallica / BnF',
      type: 'issn',
      value: '0000-0000',
      expectedLevel: 'work',
    };
    const authored: LoadedSource[] = [
      makeLoaded({ identifierLeaks: [sourceLeak] }),
      makeLoaded({
        source: makeSource({ sourceId: 'PB-P002' }),
        identifierLeaks: [recordLeak],
      }),
    ];
    const model = deriveModel(authored, new Map());
    expect(model.identifierLeaks).toEqual([sourceLeak, recordLeak]);
  });
});
