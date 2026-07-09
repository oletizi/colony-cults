import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AuthoredRepositoryRecord, IdentifierLeak } from '@/bibliography/model';
import { deriveModel, gatherProvenance } from '@/bibliography/derive';
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

  it('(BUG3) sets a SHARED provider/bucket/endpoint objectStore when any asset in the group is object-store-backed, even with differing per-asset keys', () => {
    const authored: LoadedSource[] = [makeLoaded()];

    // A single object-store-backed asset: its own key is NOT reused verbatim
    // -- the manifest's key is the copy's asset DIRECTORY, not one asset's path.
    const sharedProvenance = [
      makeProvenance({ local_path: 'a/f001.jpg', object_store: OBJECT_STORE }),
    ];
    const sharedModel = deriveModel(authored, new Map([['PB-P001', sharedProvenance]]));
    expect(sharedModel.repositoryRecords[0].manifest?.objectStore).toEqual({
      provider: OBJECT_STORE.provider,
      bucket: OBJECT_STORE.bucket,
      endpoint: OBJECT_STORE.endpoint,
      key: 'a',
    });
    expect(sharedModel.repositoryRecords[0].manifest?.localPath).toBeUndefined();

    // Two object-store-backed assets with DIFFERING per-asset keys (the real
    // shape -- each asset's key is its own path) must still yield a non-null
    // manifest objectStore carrying the shared provider/bucket/endpoint. This
    // is the regression case for the bug where "shared block" was computed by
    // exact-block equality (always false across >1 asset) and wrongly nulled
    // out every multi-asset copy.
    const multiAssetProvenance = [
      makeProvenance({ local_path: 'a/f001.jpg', object_store: OBJECT_STORE }),
      makeProvenance({
        local_path: 'a/f002.jpg',
        object_store: { ...OBJECT_STORE, key: 'a/f002.jpg' },
      }),
    ];
    const multiAssetModel = deriveModel(authored, new Map([['PB-P001', multiAssetProvenance]]));
    expect(multiAssetModel.repositoryRecords[0].manifest?.objectStore).toEqual({
      provider: OBJECT_STORE.provider,
      bucket: OBJECT_STORE.bucket,
      endpoint: OBJECT_STORE.endpoint,
      key: 'a',
    });
    expect(multiAssetModel.repositoryRecords[0].manifest?.localPath).toBeUndefined();
  });

  it('(BUG2) a legacy asset (object_store null) rolls up without throwing; manifest objectStore is null when NONE of the copy is object-store-backed', () => {
    const authored: LoadedSource[] = [makeLoaded()];
    const legacyProvenance = [
      makeProvenance({ local_path: 'a/f001.jpg', object_store: null }),
      makeProvenance({ local_path: 'a/f002.jpg', object_store: null }),
    ];
    const model = deriveModel(authored, new Map([['PB-P001', legacyProvenance]]));
    const record = model.repositoryRecords[0];
    expect(record.manifest?.assetCount).toBe(2);
    expect(record.manifest?.objectStore).toBeNull();
    expect(record.manifest?.localPath).toBe('a');
  });

  it('(BUG2) a mix of legacy (no object_store) and object-store-backed assets rolls up without throwing, contributing to assetCount, with a non-null manifest objectStore', () => {
    const authored: LoadedSource[] = [makeLoaded()];
    const mixedProvenance = [
      makeProvenance({ local_path: 'a/f001.jpg', object_store: OBJECT_STORE, type: 'page-image' }),
      makeProvenance({ local_path: 'a/issue.txt', object_store: null, type: 'ocr-text' }),
    ];
    const model = deriveModel(authored, new Map([['PB-P001', mixedProvenance]]));
    const record = model.repositoryRecords[0];
    expect(record.manifest?.assetCount).toBe(2);
    expect(record.manifest?.objectStore).not.toBeNull();
    expect(record.manifest?.objectStore?.provider).toBe(OBJECT_STORE.provider);
    expect(record.manifest?.objectStore?.bucket).toBe(OBJECT_STORE.bucket);
    expect(record.manifest?.objectStore?.endpoint).toBe(OBJECT_STORE.endpoint);
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

/** A real-shaped, object-store-backed page-image companion YAML (post-object-store). */
function pageImageYaml(localPath: string, objectStoreKey: string): string {
  return [
    'id: "PB-P001"',
    'title: "La Nouvelle France"',
    'type: "page-image"',
    'case: "port-breton"',
    'language: "French"',
    'source_archive: "Gallica / BnF"',
    'catalog_url: "https://gallica.bnf.fr/ark:/12148/bpt6k1"',
    'original_url: "https://gallica.bnf.fr/iiif/ark:/12148/bpt6k1/f1/full/full/0/native.jpg"',
    'rights_status: "public-domain"',
    'retrieved: "2026-07-08T00:00:00.000Z"',
    `local_path: "${localPath}"`,
    `sha256: "${'a'.repeat(64)}"`,
    'size: 12345',
    'format: "image/jpeg"',
    'ocr_status: "none"',
    'object_store:',
    '  provider: "backblaze-b2"',
    '  bucket: "colony-cults"',
    `  key: "${objectStoreKey}"`,
    '  endpoint: "https://s3.us-west-004.backblazeb2.com"',
    'notes: null',
    'rights_raw: |2',
    '  <OAIRecord/>',
    '',
  ].join('\n');
}

/** A real-shaped LEGACY companion YAML (predates `object_store`/`size` -- BUG 2). */
function legacyYaml(localPath: string): string {
  return [
    'id: "PB-P001"',
    'title: "La Nouvelle France"',
    'type: "ocr-text"',
    'case: "port-breton"',
    'language: "French"',
    'source_archive: "Gallica / BnF"',
    'catalog_url: "https://gallica.bnf.fr/ark:/12148/bpt6k1"',
    'original_url: ""',
    'rights_status: "public-domain"',
    'retrieved: "2026-07-08T00:00:00.000Z"',
    `local_path: "${localPath}"`,
    `sha256: "${'b'.repeat(64)}"`,
    'format: "text/plain"',
    'ocr_status: "searchable"',
    'notes: null',
    'rights_raw: |2',
    '  <OAIRecord/>',
    '',
  ].join('\n');
}

/** An asset YAML whose `object_store:` block IS present but missing `provider` (corruption). */
function malformedObjectStoreYaml(localPath: string): string {
  return [
    'id: "PB-P001"',
    'title: "La Nouvelle France"',
    'type: "page-image"',
    'case: "port-breton"',
    'language: "French"',
    'source_archive: "Gallica / BnF"',
    'catalog_url: "https://gallica.bnf.fr/ark:/12148/bpt6k1"',
    'original_url: "https://gallica.bnf.fr/iiif/ark:/12148/bpt6k1/f1/full/full/0/native.jpg"',
    'rights_status: "public-domain"',
    'retrieved: "2026-07-08T00:00:00.000Z"',
    `local_path: "${localPath}"`,
    `sha256: "${'c'.repeat(64)}"`,
    'size: 12345',
    'format: "image/jpeg"',
    'ocr_status: "none"',
    'object_store:',
    '  bucket: "colony-cults"',
    '  key: "whatever"',
    '  endpoint: "https://s3.us-west-004.backblazeb2.com"',
    'notes: null',
    'rights_raw: |2',
    '  <OAIRecord/>',
    '',
  ].join('\n');
}

/** The real archive's source-stub shape (`archive/cases/<case>/metadata/<id>.yml`) -- NOT asset provenance. */
const SOURCE_STUB_YAML = [
  'id: PB-P001',
  'title: "La Nouvelle France"',
  'type: newspaper',
  'case: port-breton',
  'language: French',
  'source_archive: Bibliotheque nationale de France (Gallica)',
  'catalog_url: "https://gallica.bnf.fr/ark:/12148/cb328261098/date"',
  'rights_status: public-domain',
  'mirror_status: in-progress',
  'local_path: archive/cases/port-breton/newspapers/la-nouvelle-france/',
  'retrieved: 2026-07-08',
  '',
].join('\n');

describe('gatherProvenance', () => {
  let archiveRoot: string;

  beforeEach(async () => {
    archiveRoot = await mkdtemp(path.join(os.tmpdir(), 'derive-gather-'));
  });

  afterEach(async () => {
    await rm(archiveRoot, { recursive: true, force: true });
  });

  /** PB-P001's registered slug directory (`@/archive/location`'s `sourceLayout`). */
  function slugDir(): string {
    return path.join(archiveRoot, 'archive', 'cases', 'port-breton', 'newspapers', 'la-nouvelle-france');
  }

  it('(BUG1) never reads the case-level metadata/ sibling (source stubs, acquisition-register.csv) as asset provenance', async () => {
    const issueDir = path.join(slugDir(), '1879-07-15_bpt6k1');
    await mkdir(issueDir, { recursive: true });
    await writeFile(
      path.join(issueDir, 'f001.yml'),
      pageImageYaml(
        'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k1/f001.jpg',
        'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k1/f001.jpg',
      ),
      'utf-8',
    );

    // A sibling metadata/ directory holding the source stub -- NOT under the
    // slug dir -- plus a non-.yml register file. If the walk were rooted at
    // the CASE dir instead of the slug dir, `collectYamlFiles` would pick up
    // PB-P001.yml and `readAssetProvenance` would throw on its missing
    // `sha256` (the stub has no such field) -- this is the regression case.
    const metadataDir = path.join(archiveRoot, 'archive', 'cases', 'port-breton', 'metadata');
    await mkdir(metadataDir, { recursive: true });
    await writeFile(path.join(metadataDir, 'PB-P001.yml'), SOURCE_STUB_YAML, 'utf-8');
    await writeFile(path.join(metadataDir, 'acquisition-register.csv'), 'id,mirror_status\n', 'utf-8');

    const result = await gatherProvenance('PB-P001', archiveRoot);
    expect(result).toHaveLength(1);
    expect(result[0].source_archive).toBe('Gallica / BnF');
  });

  it('(BUG2) a legacy asset sidecar (object_store + size ABSENT) rolls up without throwing', async () => {
    const issueDir = path.join(slugDir(), '1879-07-15_bpt6k1');
    await mkdir(issueDir, { recursive: true });
    await writeFile(
      path.join(issueDir, 'issue.txt.yml'),
      legacyYaml('archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k1/issue.txt'),
      'utf-8',
    );

    const result = await gatherProvenance('PB-P001', archiveRoot);
    expect(result).toHaveLength(1);
    expect(result[0].object_store).toBeNull();
    expect(result[0].type).toBe('ocr-text');
  });

  it('(BUG3, on-disk) page images that ARE object-store-backed roll up into a manifest with a shared, non-null objectStore despite differing per-asset keys', async () => {
    const issueDir = path.join(slugDir(), '1879-07-15_bpt6k1');
    await mkdir(issueDir, { recursive: true });
    await writeFile(
      path.join(issueDir, 'f001.yml'),
      pageImageYaml(
        'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k1/f001.jpg',
        'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k1/f001.jpg',
      ),
      'utf-8',
    );
    await writeFile(
      path.join(issueDir, 'f002.yml'),
      pageImageYaml(
        'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k1/f002.jpg',
        'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k1/f002.jpg',
      ),
      'utf-8',
    );

    const provenance = await gatherProvenance('PB-P001', archiveRoot);
    expect(provenance).toHaveLength(2);
    const authored: LoadedSource[] = [makeLoaded()];
    const model = deriveModel(authored, new Map([['PB-P001', provenance]]));
    const manifest = model.repositoryRecords[0].manifest;
    expect(manifest?.assetCount).toBe(2);
    expect(manifest?.objectStore).not.toBeNull();
    expect(manifest?.objectStore?.provider).toBe('backblaze-b2');
    expect(manifest?.objectStore?.bucket).toBe('colony-cults');
    expect(manifest?.objectStore?.endpoint).toBe('https://s3.us-west-004.backblazeb2.com');
  });

  it('(BUG2) a PRESENT-but-malformed object_store block still throws', async () => {
    const issueDir = path.join(slugDir(), '1879-07-15_bpt6k1');
    await mkdir(issueDir, { recursive: true });
    await writeFile(
      path.join(issueDir, 'f001.yml'),
      malformedObjectStoreYaml(
        'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k1/f001.jpg',
      ),
      'utf-8',
    );

    await expect(gatherProvenance('PB-P001', archiveRoot)).rejects.toThrow(/object_store block missing "provider"/);
  });
});
