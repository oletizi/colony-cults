import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import type { TranslationEngine } from '@/engine/types';
import type {
  ObjectHead,
  ObjectStore,
  PutOptions,
} from '@/archive/object-store';
import type { AcquiredAsset } from '@/model/acquired-asset';
import type { RepositoryRecord } from '@/model/repository-record';
import type { RepositoryLocator } from '@/repository/adapter';
import type {
  MuseumItemFields,
  StructuredExtractor,
} from '@/extraction/structured-extractor';
import { sha256OfBytes } from '@/archive/checksum';
import { MusarchStructuredExtractor } from '@/repository/new-italy-museum/extractor';
import {
  NewItalyMuseumAdapter,
  type MusarchHttpClient,
} from '@/repository/new-italy-museum/adapter';

const FIXTURE_844 = readFileSync(
  new URL('./__fixtures__/musarch-000844.html', import.meta.url),
  'utf-8',
);

const PAGE_URL_844 = 'https://newitaly.org.au/CAT/000844.htm';
const MASTER_URL_844 =
  'https://newitaly.org.au/CAT/images/000844_nimi-0844-pioneers-1890-lr.jpg';

/** A synthetic minimal Musarch page with NO accession span (fail-loud target). */
const SYNTHETIC_NO_ACCESSION = [
  '<div id="objectdetails">',
  '<span class="data" id="objectid">000999</span>',
  '<span class="data" id="objectdesc">No accession item 1900</span>',
  '</div>',
].join('\n');

/** A synthetic minimal Musarch page WITHOUT an image_anchor (HTML-only item). */
const SYNTHETIC_HTML_ONLY = [
  '<div id="objectdetails">',
  '<span class="data" id="objectid">000999</span>',
  '<span class="data" id="objectaccession">NIMI-0999</span>',
  '<span class="data" id="objectdesc">Survivors arrival in Sydney 1881</span>',
  '</div>',
].join('\n');

/** A fake fetch client returning canned text/bytes and recording the URLs it saw. */
function fakeClient(opts: {
  text?: string;
  bytes?: Uint8Array;
}): { client: MusarchHttpClient; textUrls: string[]; byteUrls: string[] } {
  const textUrls: string[] = [];
  const byteUrls: string[] = [];
  const client: MusarchHttpClient = {
    async getText(url) {
      textUrls.push(url);
      if (opts.text === undefined) {
        throw new Error(`fakeClient.getText: no canned text (url=${url})`);
      }
      return opts.text;
    },
    async getBytes(url) {
      byteUrls.push(url);
      if (opts.bytes === undefined) {
        throw new Error(`fakeClient.getBytes: no canned bytes (url=${url})`);
      }
      return opts.bytes;
    },
  };
  return { client, textUrls, byteUrls };
}

/** A recorded PUT against the fake object store. */
interface RecordedPut {
  key: string;
  bytes: Uint8Array;
  options: PutOptions;
}

/** A fake ObjectStore that records every PUT; head/get serve from what was put. */
function fakeObjectStore(): { store: ObjectStore; puts: RecordedPut[] } {
  const puts: RecordedPut[] = [];
  const store: ObjectStore = {
    async head(key): Promise<ObjectHead> {
      const put = puts.find((p) => p.key === key);
      return put === undefined
        ? { exists: false }
        : { exists: true, sha256: put.options.sha256, size: put.bytes.length };
    },
    async put(key, bytes, options): Promise<void> {
      puts.push({ key, bytes, options });
    },
    async get(key): Promise<Uint8Array> {
      const put = puts.find((p) => p.key === key);
      if (put === undefined) {
        throw new Error(`fakeObjectStore.get: no object at "${key}"`);
      }
      return put.bytes;
    },
    async attachSha256Metadata(): Promise<void> {
      throw new Error('fakeObjectStore.attachSha256Metadata: not used in these tests');
    },
  };
  return { store, puts };
}

/**
 * A fake {@link TranslationEngine} that returns a canned grounded reply. Used to
 * drive the REAL {@link MusarchStructuredExtractor} against the fixture bytes,
 * so the full DOM-pull + grounded-extraction integration is exercised without a
 * real engine binary.
 */
function fakeEngine(reply: string): TranslationEngine {
  return {
    name: 'fake-engine',
    async run() {
      return reply;
    },
  };
}

/**
 * A fake {@link StructuredExtractor} returning a fixed grounded extraction,
 * used where the page content is a synthetic minimal fixture that would not
 * ground the real extractor's canned excerpt. Decouples the adapter test from
 * the extractor's grounding internals (those are covered in `extractor.test.ts`).
 */
function fakeExtractor(): StructuredExtractor<MuseumItemFields> {
  return {
    async extract() {
      return {
        date: {
          value: '1881',
          evidence: { excerpt: 'Survivors arrival in Sydney 1881' },
          interpretation: 'creation year',
          provenance: {
            modelAssisted: true,
            engine: 'fake',
            model: 'fake',
            promptVersion: 'fake-v1',
            at: '2026-07-14T00:00:00.000Z',
          },
        },
      };
    },
  };
}

/** The real extractor wired to a fake engine grounded against the 000844 fixture. */
function realExtractor(): MusarchStructuredExtractor {
  const reply = JSON.stringify({
    date: {
      value: '1890',
      evidence: { excerpt: 'Pioneers Group Photo 1890', selector: '#objectdesc' },
      interpretation: "the photograph's creation year, stated in the description",
    },
    statedCredit: {
      value: 'Pioneers Group Photo 1890',
      evidence: { excerpt: 'Pioneers Group Photo 1890' },
      interpretation: 'the credit line',
    },
  });
  return new MusarchStructuredExtractor({
    engine: fakeEngine(reply),
    engineName: 'codex',
    model: 'gpt-5.5',
    now: () => '2026-07-14T00:00:00.000Z',
  });
}

/** A minimal public-domain rights assessment. */
function publicDomainRecord(overrides: Partial<RepositoryRecord> = {}): RepositoryRecord {
  return {
    sourceId: 'NIMI-0844',
    sourceArchive: 'New Italy Museum',
    sourceUrl: PAGE_URL_844,
    identifiers: [{ type: 'accession', value: 'NIMI-0844' }],
    status: '',
    rightsAssessment: {
      rightsStatus: 'public-domain',
      rightsBasis: 'Photograph created 1890; Australian pre-1955 term expired.',
      assessedBy: 'operator',
      assessedAt: '2026-07-14T00:00:00.000Z',
    },
    ...overrides,
  };
}

describe('NewItalyMuseumAdapter.resolve', () => {
  it('resolves 000844 to accession NIMI-0844 with the full-res master locator and grounded metadata', async () => {
    const { client, textUrls } = fakeClient({ text: FIXTURE_844 });
    const { store } = fakeObjectStore();
    const adapter = new NewItalyMuseumAdapter({
      client,
      extractor: realExtractor(),
      objectStore: store,
    });

    const locator: RepositoryLocator = {
      repository: 'new-italy-museum',
      value: PAGE_URL_844,
    };
    const item = await adapter.resolve(locator, {});

    expect(item.repository).toBe('new-italy-museum');
    expect(item.identifiers).toEqual([{ type: 'accession', value: 'NIMI-0844' }]);
    expect(item.sourceUrl).toBe(PAGE_URL_844);
    // The deterministic DOM-direct title (`#objectdesc`), distinct from and
    // always present regardless of the optional LLM-grounded metadata below.
    expect(item.title).toBe('Pioneers Group Photo 1890');
    expect(item.assetLocators).toHaveLength(1);
    expect(item.assetLocators[0].url).toBe(MASTER_URL_844);
    // The selected locator is the full-res master, never the tn_ thumbnail.
    expect(item.assetLocators[0].url).not.toContain('tn_');
    // Grounded prose metadata came through the extractor.
    expect(item.metadata.date.value).toBe('1890');
    expect(item.metadata.date.evidence.excerpt).toBe('Pioneers Group Photo 1890');
    // The page HTML was fetched once via the injected client.
    expect(textUrls).toEqual([PAGE_URL_844]);
  });

  it('resolves without an injected ObjectStore -- resolve never touches object storage', async () => {
    const { client } = fakeClient({ text: FIXTURE_844 });
    const adapter = new NewItalyMuseumAdapter({
      client,
      extractor: realExtractor(),
    });

    const item = await adapter.resolve(
      { repository: 'new-italy-museum', value: PAGE_URL_844 },
      {},
    );

    expect(item.identifiers).toEqual([{ type: 'accession', value: 'NIMI-0844' }]);
  });

  it('throws (fail loud) when the accession is absent -- never fabricates an identifier', async () => {
    const { client } = fakeClient({ text: SYNTHETIC_NO_ACCESSION });
    const { store } = fakeObjectStore();
    const adapter = new NewItalyMuseumAdapter({
      client,
      extractor: realExtractor(),
      objectStore: store,
    });

    await expect(
      adapter.resolve(
        { repository: 'new-italy-museum', value: 'https://newitaly.org.au/CAT/000999.htm' },
        {},
      ),
    ).rejects.toThrow(/objectaccession/i);
  });

  it('returns an empty assetLocators array for an HTML-only item (no image_anchor)', async () => {
    const { client } = fakeClient({ text: SYNTHETIC_HTML_ONLY });
    const { store } = fakeObjectStore();
    const adapter = new NewItalyMuseumAdapter({
      client,
      extractor: fakeExtractor(),
      objectStore: store,
    });

    const item = await adapter.resolve(
      { repository: 'new-italy-museum', value: 'https://newitaly.org.au/CAT/000999.htm' },
      {},
    );
    expect(item.assetLocators).toEqual([]);
    expect(item.identifiers).toEqual([{ type: 'accession', value: 'NIMI-0999' }]);
    // The deterministic DOM-direct title is present even though the injected
    // `fakeExtractor` grounded no `metadata.description` at all -- this is the
    // exact scenario the required `title` field exists to cover: a valid item
    // must not depend on the optional LLM extraction for its title.
    expect(item.title).toBe('Survivors arrival in Sydney 1881');
    expect(item.metadata.description).toBeUndefined();
  });
});

describe('NewItalyMuseumAdapter.collectRightsEvidence', () => {
  it('proposes the grounded date (plus credit) and sets NO status', async () => {
    const { client } = fakeClient({ text: FIXTURE_844 });
    const { store } = fakeObjectStore();
    const adapter = new NewItalyMuseumAdapter({
      client,
      extractor: realExtractor(),
      objectStore: store,
    });

    const item = await adapter.resolve(
      { repository: 'new-italy-museum', value: PAGE_URL_844 },
      {},
    );
    const evidence = await adapter.collectRightsEvidence(item);

    expect(evidence.date?.value).toBe('1890');
    expect(evidence.rightsRaw).toBe('Pioneers Group Photo 1890');
    // Propose only: no status/publication/policy is ever authored here.
    expect(evidence.publicationStatus).toBeUndefined();
    expect(evidence.repositoryPolicy).toBeUndefined();
    expect(evidence.jurisdiction).toBeUndefined();
  });
});

describe('NewItalyMuseumAdapter.acquire', () => {
  const CANNED_BYTES = new TextEncoder().encode('fake-jpeg-master-bytes- ÿ');
  const EXPECTED_CHECKSUM = sha256OfBytes(CANNED_BYTES);

  it('downloads the master, checksums, PUTs to the object store, and returns a typed AcquiredAsset', async () => {
    const { client, byteUrls } = fakeClient({ text: FIXTURE_844, bytes: CANNED_BYTES });
    const { store, puts } = fakeObjectStore();
    const adapter = new NewItalyMuseumAdapter({
      client,
      extractor: realExtractor(),
      objectStore: store,
      now: () => '2026-07-14T00:00:00.000Z',
    });

    const result = await adapter.acquire(publicDomainRecord(), {});

    // Exactly one asset, built from the real downloaded bytes.
    expect(result.assets).toHaveLength(1);
    const asset = result.assets[0];
    expect(asset.checksum).toBe(EXPECTED_CHECKSUM);
    expect(asset.byteLength).toBe(CANNED_BYTES.length);
    expect(asset.mediaType).toBe('image/jpeg');
    expect(asset.role).toBe('primary');
    expect(asset.representationChoice).toBe('full-res-image-anchor');
    expect(asset.objectStoreKey).toBe(
      `archive/museum/new-italy-museum/nimi-0844/${EXPECTED_CHECKSUM}.jpg`,
    );
    // The mirrored asset is the full-res master, never a thumbnail.
    expect(asset.sourceUrl).toBe(MASTER_URL_844);
    expect(asset.sourceUrl).not.toContain('tn_');
    expect(asset.objectStoreKey).not.toContain('tn_');

    // The master (not the thumbnail) is the URL the bytes were fetched from.
    expect(byteUrls).toEqual([MASTER_URL_844]);

    // The bytes were actually PUT with the sha256 metadata + content type.
    expect(puts).toHaveLength(1);
    expect(puts[0].key).toBe(asset.objectStoreKey);
    expect(puts[0].bytes).toBe(CANNED_BYTES);
    expect(puts[0].options).toEqual({ sha256: EXPECTED_CHECKSUM, contentType: 'image/jpeg' });

    // Typed result shape.
    expect(result.repositoryRecordId).toBe('NIMI-0844 @ New Italy Museum');
    expect(result.complete).toBe(true);
    expect(result.reconciliationRequired).toBe(true);
    expect(result.metadataSnapshot.raw).toBe(FIXTURE_844);
    expect(result.metadataSnapshot.retrievedAt).toBe('2026-07-14T00:00:00.000Z');
  });

  it('throws (fail-closed) when the rightsAssessment is missing', async () => {
    const { client } = fakeClient({ text: FIXTURE_844, bytes: CANNED_BYTES });
    const { store, puts } = fakeObjectStore();
    const adapter = new NewItalyMuseumAdapter({
      client,
      extractor: realExtractor(),
      objectStore: store,
    });

    const record = publicDomainRecord({ rightsAssessment: undefined });
    await expect(adapter.acquire(record, {})).rejects.toThrow(/fail-closed|public-domain/i);
    // Nothing was fetched or stored.
    expect(puts).toHaveLength(0);
  });

  it('throws (fail-closed) when the rightsAssessment is not public-domain', async () => {
    const { client } = fakeClient({ text: FIXTURE_844, bytes: CANNED_BYTES });
    const { store, puts } = fakeObjectStore();
    const adapter = new NewItalyMuseumAdapter({
      client,
      extractor: realExtractor(),
      objectStore: store,
    });

    const record = publicDomainRecord({
      rightsAssessment: {
        rightsStatus: 'restricted',
        rightsBasis: 'Term not expired.',
        assessedBy: 'operator',
        assessedAt: '2026-07-14T00:00:00.000Z',
      },
    });
    await expect(adapter.acquire(record, {})).rejects.toThrow(/public-domain/i);
    expect(puts).toHaveLength(0);
  });

  it('mirrors nothing (empty assets) for an HTML-only item, without fabricating an asset', async () => {
    const { client, byteUrls } = fakeClient({ text: SYNTHETIC_HTML_ONLY, bytes: CANNED_BYTES });
    const { store, puts } = fakeObjectStore();
    const adapter = new NewItalyMuseumAdapter({
      client,
      extractor: realExtractor(),
      objectStore: store,
      now: () => '2026-07-14T00:00:00.000Z',
    });

    const record = publicDomainRecord({
      sourceId: 'NIMI-0999',
      sourceUrl: 'https://newitaly.org.au/CAT/000999.htm',
      identifiers: [{ type: 'accession', value: 'NIMI-0999' }],
    });
    const result = await adapter.acquire(record, {});

    expect(result.assets).toEqual([]);
    expect(result.complete).toBe(true);
    expect(result.reconciliationRequired).toBe(true);
    // Nothing was downloaded or stored for an image-less item.
    expect(byteUrls).toEqual([]);
    expect(puts).toHaveLength(0);
  });

  it('throws when sourceUrl is missing (nothing to fetch)', async () => {
    const { client } = fakeClient({ text: FIXTURE_844, bytes: CANNED_BYTES });
    const { store } = fakeObjectStore();
    const adapter = new NewItalyMuseumAdapter({
      client,
      extractor: realExtractor(),
      objectStore: store,
    });

    const record = publicDomainRecord({ sourceUrl: undefined });
    await expect(adapter.acquire(record, {})).rejects.toThrow(/sourceUrl/i);
  });

  it('throws a clear error when no ObjectStore was injected (resolve-only construction)', async () => {
    const { client } = fakeClient({ text: FIXTURE_844, bytes: CANNED_BYTES });
    const adapter = new NewItalyMuseumAdapter({
      client,
      extractor: realExtractor(),
    });

    await expect(adapter.acquire(publicDomainRecord(), {})).rejects.toThrow(
      /no ObjectStore was injected/,
    );
  });

  // ---------------------------------------------------------------------------
  // T019 (FR-020/FR-021): idempotent / convergent acquire + remote-change fail-loud.
  // ---------------------------------------------------------------------------

  const MASTER_KEY_844 = `archive/museum/new-italy-museum/nimi-0844/${EXPECTED_CHECKSUM}.jpg`;

  /** The `primary` master asset a prior acquire would have recorded on the record. */
  function recordedMaster(): AcquiredAsset {
    return {
      sourceUrl: MASTER_URL_844,
      mediaType: 'image/jpeg',
      objectStoreKey: MASTER_KEY_844,
      checksum: EXPECTED_CHECKSUM,
      byteLength: CANNED_BYTES.length,
      provenancePath: `archive/museum/new-italy-museum/nimi-0844/${EXPECTED_CHECKSUM}.yml`,
      role: 'primary',
      representationChoice: 'full-res-image-anchor',
    };
  }

  it('is idempotent: an already-recorded master present with the matching checksum is NOT re-downloaded or re-PUT', async () => {
    const { client, byteUrls } = fakeClient({ text: FIXTURE_844, bytes: CANNED_BYTES });
    const { store, puts } = fakeObjectStore();
    // Seed the store as if a prior acquire already mirrored the master.
    await store.put(MASTER_KEY_844, CANNED_BYTES, {
      sha256: EXPECTED_CHECKSUM,
      contentType: 'image/jpeg',
    });

    const adapter = new NewItalyMuseumAdapter({
      client,
      extractor: realExtractor(),
      objectStore: store,
      now: () => '2026-07-14T00:00:00.000Z',
    });

    const asset = recordedMaster();
    const result = await adapter.acquire(publicDomainRecord({ assets: [asset] }), {});

    // Returns the existing recorded asset, converged.
    expect(result.assets).toEqual([asset]);
    // The master was NOT re-downloaded (no getBytes) ...
    expect(byteUrls).toEqual([]);
    // ... and NO second PUT was issued (only the seed remains).
    expect(puts).toHaveLength(1);
  });

  it('is idempotent even without a recorded asset: an object already present at the derived key with the matching checksum skips the PUT', async () => {
    const { client } = fakeClient({ text: FIXTURE_844, bytes: CANNED_BYTES });
    const { store, puts } = fakeObjectStore();
    // The object already exists at the derived key (e.g. from a prior run whose
    // record was not persisted), with our sha256 metadata.
    await store.put(MASTER_KEY_844, CANNED_BYTES, {
      sha256: EXPECTED_CHECKSUM,
      contentType: 'image/jpeg',
    });

    const adapter = new NewItalyMuseumAdapter({
      client,
      extractor: realExtractor(),
      objectStore: store,
      now: () => '2026-07-14T00:00:00.000Z',
    });

    const result = await adapter.acquire(publicDomainRecord(), {});

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].objectStoreKey).toBe(MASTER_KEY_844);
    // The object was already present with the matching checksum -> no duplicate PUT.
    expect(puts).toHaveLength(1);
  });

  it('remote-change fail-loud: a re-fetch whose bytes differ from a recorded master checksum throws and writes nothing', async () => {
    const CHANGED_BYTES = new TextEncoder().encode('DIFFERENT-master-bytes-after-remote-change');
    const { client, byteUrls } = fakeClient({ text: FIXTURE_844, bytes: CHANGED_BYTES });
    const { store, puts } = fakeObjectStore();
    // Store does NOT already hold the recorded master (head miss forces a re-fetch).

    const adapter = new NewItalyMuseumAdapter({
      client,
      extractor: realExtractor(),
      objectStore: store,
      now: () => '2026-07-14T00:00:00.000Z',
    });

    // The record pins the ORIGINAL master's checksum; the remote now serves
    // different bytes.
    const record = publicDomainRecord({ assets: [recordedMaster()] });
    await expect(adapter.acquire(record, {})).rejects.toThrow(/changed|FR-021/i);

    // The bytes were fetched (to compare) but NOTHING was written.
    expect(byteUrls).toEqual([MASTER_URL_844]);
    expect(puts).toHaveLength(0);
  });

  it('first-time acquire (no recorded master) still downloads, PUTs, and records provenance', async () => {
    const { client, byteUrls } = fakeClient({ text: FIXTURE_844, bytes: CANNED_BYTES });
    const { store, puts } = fakeObjectStore();

    const adapter = new NewItalyMuseumAdapter({
      client,
      extractor: realExtractor(),
      objectStore: store,
      now: () => '2026-07-14T00:00:00.000Z',
    });

    const result = await adapter.acquire(publicDomainRecord(), {});

    expect(byteUrls).toEqual([MASTER_URL_844]);
    expect(puts).toHaveLength(1);
    expect(puts[0].key).toBe(MASTER_KEY_844);
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].provenancePath).toBe(
      `archive/museum/new-italy-museum/nimi-0844/${EXPECTED_CHECKSUM}.yml`,
    );
  });
});
