/**
 * Tests for {@link recordItemSnapshot} (`@/repository/internet-archive/snapshot`),
 * T020's IA metadata-snapshot recorder for the archive.org acquisition
 * adapter (specs/013-archiveorg-acquisition-path).
 *
 * Real-fixture coverage: builds the `ItemMetadata` under test via
 * `fetchItemMetadata` against the captured de Groote "Nouvelle-France"
 * archive.org `/metadata/<id>` response
 * (`__fixtures__/metadata-nouvellefrancec00groogoog.json`), then verifies
 * `recordItemSnapshot` delegates to the shipped `writeSnapshot` store
 * (`@/sourcegroup/snapshot`) with the exact field mapping T020 specifies.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchItemMetadata } from '@/repository/internet-archive/metadata';
import type { ArchiveHttpClient } from '@/repository/internet-archive/metadata';
import { recordItemSnapshot, IA_NORMALIZATION_VERSION } from '@/repository/internet-archive/snapshot';

const fixturesDir = join(
  process.cwd(),
  'src',
  'repository',
  'internet-archive',
  '__fixtures__',
);

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf-8');
}

const ITEM_ID = 'nouvellefrancec00groogoog';
const FIXTURE_TEXT = readFixture(`metadata-${ITEM_ID}.json`);
const SOURCE_ID = 'IA-P001';
const RETRIEVED_AT = '2026-07-16T00:00:00.000Z';
const STAMP = '2026-07-16T00-00-00-000Z';

/** A fake {@link ArchiveHttpClient} whose `getText` returns a fixed response, never touching the network. */
function fakeClient(responseText: string): ArchiveHttpClient {
  return {
    getText: async (_url: string) => responseText,
    getBytes: async (_url: string) => {
      throw new Error('fakeClient: getBytes is not used by fetchItemMetadata.');
    },
  };
}

let baseDir: string | undefined;

afterEach(async () => {
  if (baseDir !== undefined) {
    await rm(baseDir, { recursive: true, force: true });
    baseDir = undefined;
  }
});

describe('recordItemSnapshot -- real fixture metadata-nouvellefrancec00groogoog.json', () => {
  it('writes the snapshot under bibliography/repository-responses/<sourceId>/ via the shipped store', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'ia-snapshot-'));
    const item = await fetchItemMetadata(ITEM_ID, fakeClient(FIXTURE_TEXT));

    const ref = await recordItemSnapshot(baseDir, SOURCE_ID, item, RETRIEVED_AT, STAMP);

    expect(ref.path).toMatch(
      new RegExp(`^bibliography/repository-responses/${SOURCE_ID}/${ITEM_ID}-.+\\.json$`),
    );
    expect(ref.retrievedAt).toBe(RETRIEVED_AT);
    expect(ref.endpoint).toBe(item.metadataEndpoint);
    expect(ref.normalizationVersion).toBe(IA_NORMALIZATION_VERSION);
  });

  it('persists the exact raw response body and mapped fields on disk', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'ia-snapshot-'));
    const item = await fetchItemMetadata(ITEM_ID, fakeClient(FIXTURE_TEXT));

    const ref = await recordItemSnapshot(baseDir, SOURCE_ID, item, RETRIEVED_AT, STAMP);
    const onDisk: unknown = JSON.parse(await readFile(join(baseDir, ref.path), 'utf8'));

    expect(onDisk).toMatchObject({
      raw: item.raw,
      retrievedAt: RETRIEVED_AT,
      endpoint: item.metadataEndpoint,
      normalizationVersion: IA_NORMALIZATION_VERSION,
    });
  });

  it('is write-once: reusing an existing stamp for the same item throws instead of overwriting', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'ia-snapshot-'));
    const item = await fetchItemMetadata(ITEM_ID, fakeClient(FIXTURE_TEXT));

    await recordItemSnapshot(baseDir, SOURCE_ID, item, RETRIEVED_AT, STAMP);

    await expect(
      recordItemSnapshot(baseDir, SOURCE_ID, item, RETRIEVED_AT, STAMP),
    ).rejects.toThrow(/snapshot already exists/);
  });

  it('a re-inventory that supplies a new stamp lands at a distinct path, leaving the original untouched', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'ia-snapshot-'));
    const item = await fetchItemMetadata(ITEM_ID, fakeClient(FIXTURE_TEXT));

    const first = await recordItemSnapshot(baseDir, SOURCE_ID, item, RETRIEVED_AT, STAMP);
    const secondStamp = '2026-07-17T00-00-00-000Z';
    const second = await recordItemSnapshot(
      baseDir,
      SOURCE_ID,
      item,
      '2026-07-17T00:00:00.000Z',
      secondStamp,
    );

    expect(second.path).not.toBe(first.path);
    const firstOnDisk: unknown = JSON.parse(await readFile(join(baseDir, first.path), 'utf8'));
    expect(firstOnDisk).toMatchObject({ retrievedAt: RETRIEVED_AT });
  });
});
