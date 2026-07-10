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

function writeSnapshotFile(dir: string, sourceId: string, snapshot: CorpusSnapshot): void {
  writeFileSync(snapshotFilePath(dir, sourceId), serializeSnapshot(snapshot), 'utf-8');
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
      writeFileSync(snapshotFilePath(dir, 'PB-P001'), '{ not json', 'utf-8');
      expect(() => readSnapshotCorpus(dir, ['PB-P001'])).toThrow(/not valid JSON/);
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
