/**
 * Unit tests for the publishable corpus SNAPSHOT path: the raw archive read,
 * the deterministic serialize -> read round-trip, the fail-loud validation of a
 * missing/corrupt snapshot, and the archive-vs-snapshot precedence in
 * `loadCorpus`.
 *
 * Round-trip / parity cases use the real PB-P001 fixture (guarded by
 * `hasFixture`, so they skip cleanly when the archive clone is absent). The
 * pure fail-loud parse cases need no archive and always run.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import os from 'node:os';

import type { CorpusSnapshot } from '@/browser/model';
import type { LoadConfig } from '@/browser/config';
import { readRawCorpus } from '@/browser/load/raw-corpus';
import { resolveImages } from '@/browser/load/resolve-images';
import { resolveRepoRoot } from '@/browser/load/repo-root';
import {
  readSnapshotCorpus,
  serializeSnapshot,
  snapshotAvailable,
  snapshotFilePath,
  writeSnapshotFile,
} from '@/browser/load/snapshot';
import { parseCorpusSnapshot } from '@/browser/load/snapshot-guards';
import { loadCorpus } from '@/browser/load/corpus';

import { cleanupCopy, hasFixture, makeCleanArchive } from '../../integration/browser/fixtures';

/** Strips the advisory `generatedFrom` so raw reads compare on rendered fields. */
function core(snapshot: CorpusSnapshot): Pick<CorpusSnapshot, 'sources' | 'skipped'> {
  return { sources: snapshot.sources, skipped: snapshot.skipped };
}

function tmpSnapshotDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'corpus-snapshot-'));
}

describe('corpus snapshot round-trip (PB-P001 fixture)', () => {
  it('serialize -> read reproduces the raw corpus (deep-equal)', () => {
    if (!hasFixture()) {
      return;
    }
    const archive = makeCleanArchive();
    const dir = tmpSnapshotDir();
    try {
      const raw = readRawCorpus(archive, ['PB-P001'], resolveRepoRoot());
      writeSnapshotFile(dir, 'PB-P001', raw);

      const readBack = readSnapshotCorpus(dir, ['PB-P001']);
      expect(readBack).toEqual(core(raw));
    } finally {
      cleanupCopy(archive);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is deterministic: two serializations of the same raw are byte-identical', () => {
    if (!hasFixture()) {
      return;
    }
    const archive = makeCleanArchive();
    try {
      const raw = readRawCorpus(archive, ['PB-P001'], resolveRepoRoot());
      expect(serializeSnapshot(raw)).toBe(serializeSnapshot(raw));
    } finally {
      cleanupCopy(archive);
    }
  });

  it('archive-read and snapshot-read resolve to the same LoadResult (convergence)', () => {
    if (!hasFixture()) {
      return;
    }
    const archive = makeCleanArchive();
    const dir = tmpSnapshotDir();
    try {
      const raw = readRawCorpus(archive, ['PB-P001'], resolveRepoRoot());
      const fromArchive = resolveImages(raw, { kind: 'source-iiif' });

      writeSnapshotFile(dir, 'PB-P001', raw);
      const fromSnapshot = resolveImages(readSnapshotCorpus(dir, ['PB-P001']), {
        kind: 'source-iiif',
      });

      expect(fromSnapshot).toEqual(fromArchive);
    } finally {
      cleanupCopy(archive);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('re-resolves images from snapshot handles when the provider swaps (b2-cdn)', () => {
    if (!hasFixture()) {
      return;
    }
    const archive = makeCleanArchive();
    const dir = tmpSnapshotDir();
    try {
      const raw = readRawCorpus(archive, ['PB-P001'], resolveRepoRoot());
      writeSnapshotFile(dir, 'PB-P001', raw);

      const { corpus } = resolveImages(readSnapshotCorpus(dir, ['PB-P001']), {
        kind: 'b2-cdn',
        cdnBase: 'https://cdn.example/pb',
      });
      const firstPage = corpus.sources[0].issues[0].pages[0];
      expect(firstPage.image.kind).toBe('full-image');
      expect(firstPage.image.url.startsWith('https://cdn.example/pb/')).toBe(true);
    } finally {
      cleanupCopy(archive);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('snapshot reader fail-loud (no archive needed)', () => {
  it('throws naming the file when a source snapshot is absent', () => {
    const dir = tmpSnapshotDir();
    try {
      expect(() => readSnapshotCorpus(dir, ['PB-P001'])).toThrow(/PB-P001\.json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws when the snapshot file is not valid JSON', () => {
    const dir = tmpSnapshotDir();
    try {
      // Gzipped, but the decompressed payload is not JSON.
      writeFileSync(snapshotFilePath(dir, 'PB-P001'), gzipSync(Buffer.from('{ not json', 'utf-8')));
      expect(() => readSnapshotCorpus(dir, ['PB-P001'])).toThrow(/not valid JSON/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws when the snapshot file is not gzip', () => {
    const dir = tmpSnapshotDir();
    try {
      writeFileSync(snapshotFilePath(dir, 'PB-P001'), 'plain text, not gzip', 'utf-8');
      expect(() => readSnapshotCorpus(dir, ['PB-P001'])).toThrow(/gunzipped/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parseCorpusSnapshot throws naming the missing field', () => {
    // A structurally near-valid snapshot missing a required page field.
    const corrupt = {
      sources: [
        {
          sourceId: 'PB-P001',
          title: 'La Nouvelle France',
          kind: 'periodical',
          ark: 'ark:/12148/x',
          rights: 'public-domain',
          issues: [
            {
              issueId: 'i1',
              date: '1879-08-15',
              sequence: 1,
              pages: [{ pageId: 'p001', folioId: 'f001' }],
            },
          ],
        },
      ],
      skipped: [],
    };
    expect(() => parseCorpusSnapshot(corrupt, 'corrupt.json')).toThrow(/ark/);
  });

  it('parseCorpusSnapshot rejects a non-object root', () => {
    expect(() => parseCorpusSnapshot([], 'x.json')).toThrow(/expected an object/);
  });

  it('parseCorpusSnapshot accepts and preserves a monograph kind', () => {
    const snap = {
      sources: [
        {
          sourceId: 'PB-P002',
          title: 'A book',
          kind: 'monograph',
          ark: 'ark:/12148/x',
          rights: 'public-domain',
          issues: [],
        },
      ],
      skipped: [],
    };
    expect(parseCorpusSnapshot(snap, 'x.json').sources[0].kind).toBe('monograph');
  });

  it('parseCorpusSnapshot rejects an unknown source kind', () => {
    const snap = {
      sources: [
        { sourceId: 'X', title: 'X', kind: 'pamphlet', ark: 'a', rights: 'r', issues: [] },
      ],
      skipped: [],
    };
    expect(() => parseCorpusSnapshot(snap, 'x.json')).toThrow(/unsupported source kind/);
  });

  it('parseCorpusSnapshot preserves an English source language', () => {
    const snap = {
      sources: [
        {
          sourceId: 'PB-P057',
          title: 'The China Mail',
          kind: 'monograph',
          language: 'English',
          ark: 'https://archive.org/details/NPCM18801016',
          rights: 'public-domain',
          issues: [],
        },
      ],
      skipped: [],
    };
    expect(parseCorpusSnapshot(snap, 'x.json').sources[0].language).toBe('English');
  });

  it('parseCorpusSnapshot defaults a language-less (older) snapshot to French', () => {
    const snap = {
      sources: [
        {
          sourceId: 'PB-P001',
          title: 'La Nouvelle France',
          kind: 'periodical',
          ark: 'ark:/12148/x',
          rights: 'public-domain',
          issues: [],
        },
      ],
      skipped: [],
    };
    expect(parseCorpusSnapshot(snap, 'x.json').sources[0].language).toBe('French');
  });

  it('parseCorpusSnapshot rejects an unknown source language', () => {
    const snap = {
      sources: [
        {
          sourceId: 'X',
          title: 'X',
          kind: 'monograph',
          language: 'German',
          ark: 'a',
          rights: 'r',
          issues: [],
        },
      ],
      skipped: [],
    };
    expect(() => parseCorpusSnapshot(snap, 'x.json')).toThrow(/unsupported source language/);
  });

  it('serialize -> parse round-trips a clipping page carrying multi-strip handles', () => {
    const clipping: CorpusSnapshot = {
      sources: [
        {
          sourceId: 'PB-P061',
          title: 'CONVICTION OF MARQUIS DE RAYS',
          kind: 'periodical',
          language: 'English',
          ark: 'https://paperspast.natlib.govt.nz/newspapers/HNS18840103.2.19.3',
          rights: 'public-domain',
          issues: [
            {
              issueId: 'conviction-of-marquis-de-rays',
              date: '1884-01-03',
              sequence: 1,
              pages: [
                {
                  pageId: 'p001',
                  folioId: 'f001',
                  ark: 'https://paperspast.natlib.govt.nz/newspapers/HNS18840103.2.19.3',
                  objectStoreKey: 'archive/papers-past/x/aaa.gif',
                  imageSha256: 'aaa',
                  strips: [
                    { folioId: 'f001', objectStoreKey: 'archive/papers-past/x/aaa.gif' },
                    { folioId: 'f002', objectStoreKey: 'archive/papers-past/x/bbb.gif' },
                    { folioId: 'f003', objectStoreKey: null },
                  ],
                  ocrFrench: '',
                  correctedFrench: null,
                  english: 'CONVICTION OF MARQUIS DE RAYS.',
                  ocrCondition: null,
                  provenance: {
                    sourceId: 'PB-P061',
                    ark: 'https://paperspast.natlib.govt.nz/newspapers/HNS18840103.2.19.3',
                    date: '1884-01-03',
                    rights: 'public-domain',
                    page: 'p001',
                    sha256: 'ocr-text-sha',
                  },
                },
              ],
            },
          ],
        },
      ],
      skipped: [],
    };

    const readBack = parseCorpusSnapshot(JSON.parse(serializeSnapshot(clipping)), 'clip.json');
    expect(readBack).toEqual(clipping);
    expect(readBack.sources[0].issues[0].pages[0].strips).toEqual(clipping.sources[0].issues[0].pages[0].strips);
  });

  it('serialize omits an absent strips key (normal page round-trips without strips)', () => {
    const normal: CorpusSnapshot = {
      sources: [
        {
          sourceId: 'PB-P001',
          title: 'La Nouvelle France',
          kind: 'periodical',
          language: 'French',
          ark: 'ark:/12148/x',
          rights: 'public-domain',
          issues: [
            {
              issueId: '1879-08-15_x',
              date: '1879-08-15',
              sequence: 1,
              pages: [
                {
                  pageId: 'p001',
                  folioId: 'f001',
                  ark: 'ark:/12148/x',
                  objectStoreKey: null,
                  ocrFrench: 'OCR.',
                  correctedFrench: null,
                  english: 'English.',
                  ocrCondition: null,
                  provenance: {
                    sourceId: 'PB-P001',
                    ark: 'ark:/12148/x',
                    date: '1879-08-15',
                    rights: 'public-domain',
                    page: 'p001',
                    sha256: 'h',
                  },
                },
              ],
            },
          ],
        },
      ],
      skipped: [],
    };

    const json = serializeSnapshot(normal);
    expect(json).not.toContain('strips');
    const readBack = parseCorpusSnapshot(JSON.parse(json), 'normal.json');
    expect(readBack).toEqual(normal);
    expect('strips' in readBack.sources[0].issues[0].pages[0]).toBe(false);
  });
});

describe('loadCorpus archive-vs-snapshot precedence', () => {
  const baseConfig = (over: Partial<LoadConfig>): LoadConfig => ({
    snapshotDir: 'site/data',
    sources: ['PB-P001'],
    provider: { kind: 'source-iiif' },
    ...over,
  });

  it('reads the snapshot when no archive path is set', () => {
    if (!hasFixture()) {
      return;
    }
    const archive = makeCleanArchive();
    const dir = tmpSnapshotDir();
    try {
      const raw = readRawCorpus(archive, ['PB-P001'], resolveRepoRoot());
      writeSnapshotFile(dir, 'PB-P001', raw);

      expect(snapshotAvailable(dir, ['PB-P001'])).toBe(true);
      const { corpus } = loadCorpus(baseConfig({ archivePath: undefined, snapshotDir: dir }));
      expect(corpus.sources[0].sourceId).toBe('PB-P001');
      expect(corpus.sources[0].issues[0].pages.length).toBeGreaterThan(0);
    } finally {
      cleanupCopy(archive);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws naming BOTH the archive and the snapshot when neither is available', () => {
    const dir = tmpSnapshotDir();
    try {
      expect(() =>
        loadCorpus(baseConfig({ archivePath: undefined, snapshotDir: dir }))
      ).toThrow(/CORPUS_ARCHIVE_PATH[\s\S]*snapshot|snapshot[\s\S]*CORPUS_ARCHIVE_PATH/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
