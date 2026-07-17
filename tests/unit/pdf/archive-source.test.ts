import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveArchiveSource } from '@/pdf/load/archive-source';

import { writeFixtureArchive } from './archive-fixture';

// Sources already registered in `@/archive/location`'s static SOURCE_LAYOUTS,
// reused here so `resolveArchiveSource` resolves them without any test-only
// registry mutation. Each test builds its own temp `archiveRoot`, so reusing a
// sourceId across tests never collides on disk.
const FULL_SOURCE_ID = 'PB-P002';
const FULL_SOURCE_CASE = 'port-breton';
const FULL_SOURCE_SLUG = 'nouvelle-france-colonie-libre-port-breton';

const EXTRACT_SOURCE_ID = 'PB-P054';
const EXTRACT_SOURCE_CASE = 'port-breton';
const EXTRACT_SOURCE_SLUG =
  'cour-de-cassation-chambre-criminelle-arret-de-rejet-du-pourvoi-de-charles';

describe('resolveArchiveSource', () => {
  it('enumerates a full monograph source: 5 folios, positions 1..5, correct key/sha256', async () => {
    const fixture = await writeFixtureArchive({
      case: FULL_SOURCE_CASE,
      slug: FULL_SOURCE_SLUG,
      pageCount: 5,
    });
    try {
      const resolution = await resolveArchiveSource({
        sourceId: FULL_SOURCE_ID,
        archiveRoot: fixture.archiveRoot,
      });

      expect(resolution.kind).toBe('monograph');
      if (resolution.kind !== 'monograph') {
        throw new Error('expected monograph resolution');
      }
      expect(resolution.sourceId).toBe(FULL_SOURCE_ID);
      expect(resolution.pageDir).toBe(fixture.sourceDir);
      expect(resolution.folios).toHaveLength(5);

      resolution.folios.forEach((folio, index) => {
        const folioNum = String(index + 1).padStart(3, '0');
        expect(folio.folioId).toBe(`f${folioNum}`);
        expect(folio.position).toBe(index + 1);
        expect(folio.pageDir).toBe(fixture.sourceDir);
        expect(folio.objectStoreKey).toBe(
          `archive/cases/${FULL_SOURCE_CASE}/books/${FULL_SOURCE_SLUG}/f${folioNum}.jpg`,
        );
        expect(folio.imageSha256).toMatch(/^[0-9a-f]{64}$/);
      });
    } finally {
      fixture.cleanup();
    }
  });

  it('enumerates a page-range extract (f048-f050) with positions 1..3, not folio-numbered', async () => {
    const fixture = await writeFixtureArchive({
      case: EXTRACT_SOURCE_CASE,
      slug: EXTRACT_SOURCE_SLUG,
      pageCount: 3,
      startFolio: 48,
    });
    try {
      const resolution = await resolveArchiveSource({
        sourceId: EXTRACT_SOURCE_ID,
        archiveRoot: fixture.archiveRoot,
      });

      expect(resolution.kind).toBe('monograph');
      if (resolution.kind !== 'monograph') {
        throw new Error('expected monograph resolution');
      }
      expect(resolution.folios).toHaveLength(3);
      expect(resolution.folios.map((f) => f.folioId)).toEqual(['f048', 'f049', 'f050']);
      expect(resolution.folios.map((f) => f.position)).toEqual([1, 2, 3]);
    } finally {
      fixture.cleanup();
    }
  });

  it('fails loud naming the folio when object_store.key is missing', async () => {
    const fixture = await writeFixtureArchive({
      case: FULL_SOURCE_CASE,
      slug: FULL_SOURCE_SLUG,
      pageCount: 2,
    });
    try {
      const brokenSidecarPath = path.join(fixture.sourceDir, 'f002.yml');
      const original = await readFile(brokenSidecarPath, 'utf-8');
      const broken = original.replace(
        /object_store:\n(?:  .*\n)*/,
        'object_store:\n  provider: "backblaze-b2"\n  bucket: "colony-cults"\n  key: ""\n  endpoint: "s3.us-west-000.backblazeb2.com"\n',
      );
      expect(broken).not.toBe(original);
      await writeFile(brokenSidecarPath, broken);

      await expect(
        resolveArchiveSource({
          sourceId: FULL_SOURCE_ID,
          archiveRoot: fixture.archiveRoot,
        }),
      ).rejects.toThrow(/f002/);
    } finally {
      fixture.cleanup();
    }
  });

  it('fails loud naming the folio when sha256 is missing', async () => {
    const fixture = await writeFixtureArchive({
      case: FULL_SOURCE_CASE,
      slug: FULL_SOURCE_SLUG,
      pageCount: 2,
    });
    try {
      const brokenSidecarPath = path.join(fixture.sourceDir, 'f001.yml');
      const original = await readFile(brokenSidecarPath, 'utf-8');
      const broken = original.replace(/sha256: "[0-9a-f]{64}"/, 'sha256: ""');
      expect(broken).not.toBe(original);
      await writeFile(brokenSidecarPath, broken);

      await expect(
        resolveArchiveSource({
          sourceId: FULL_SOURCE_ID,
          archiveRoot: fixture.archiveRoot,
        }),
      ).rejects.toThrow(/f001/);
    } finally {
      fixture.cleanup();
    }
  });

  it('fails loud when the source directory does not exist', async () => {
    const fixture = await writeFixtureArchive({
      case: FULL_SOURCE_CASE,
      slug: FULL_SOURCE_SLUG,
      pageCount: 1,
    });
    try {
      await expect(
        resolveArchiveSource({
          sourceId: EXTRACT_SOURCE_ID,
          archiveRoot: fixture.archiveRoot,
        }),
      ).rejects.toThrow();
    } finally {
      fixture.cleanup();
    }
  });

  it('fails loud for an unregistered source id', async () => {
    const fixture = await writeFixtureArchive({
      case: FULL_SOURCE_CASE,
      slug: FULL_SOURCE_SLUG,
      pageCount: 1,
    });
    try {
      await expect(
        resolveArchiveSource({
          sourceId: 'PB-NOT-REGISTERED',
          archiveRoot: fixture.archiveRoot,
        }),
      ).rejects.toThrow(/PB-NOT-REGISTERED/);
    } finally {
      fixture.cleanup();
    }
  });
});
