/**
 * Page-range extract alignment (spec 014, SC-002, T011/T012): a fixture
 * EXTRACT (folios `f048..f050`, starting mid-source) must resolve to
 * POSITIONS `1..3`, and each position's `loadArchivePage` must read its
 * extract-relative `translation/pNNN.*` (e.g. `f048` reads `p001`, NOT a
 * `p048` that doesn't exist) -- the alignment bug this feature removes.
 *
 * Also guards folio<->translation COUNT coverage (T012): the under-count
 * case (a folio with no translation) is already fail-loud per-folio in
 * `loadArchivePage` (T004/FR-008); this file asserts that existing fail-loud
 * directly, and separately proves the over-count guard added to
 * `resolveArchiveSource` (extra translation artifacts with no folio at all,
 * which the per-folio check can never see since it only iterates folios).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { splitIssueOcr } from '@/browser/load/ocr-pages';
import type { ArchivePageSource } from '@/pdf/load/archive-source';
import { resolveArchiveSource } from '@/pdf/load/archive-source';
import { loadArchivePage } from '@/pdf/load/archive-page';

import { writeFixtureArchive } from './archive-fixture';

// A monograph source already registered in `@/archive/location`'s static
// SOURCE_LAYOUTS, reused here so `resolveArchiveSource` resolves it without
// any test-only registry mutation. Each test builds its own temp
// `archiveRoot`, so this is collision-free across tests.
const EXTRACT_SOURCE_ID = 'PB-P054';
const EXTRACT_SOURCE_CASE = 'port-breton';
const EXTRACT_SOURCE_SLUG =
  'cour-de-cassation-chambre-criminelle-arret-de-rejet-du-pourvoi-de-charles';

/** Split the fixture's `issue.txt` into the per-position OCR-French segments. */
async function readSegments(pageDir: string): Promise<string[]> {
  const issueText = await readFile(path.join(pageDir, 'issue.txt'), 'utf-8');
  return splitIssueOcr(issueText).map((page) => page.ocrFrench);
}

/** Resolve a monograph fixture source into its ordered folio page-sources. */
async function foliosOf(sourceId: string, archiveRoot: string): Promise<ArchivePageSource[]> {
  const resolution = await resolveArchiveSource({ sourceId, archiveRoot });
  if (resolution.kind !== 'monograph') {
    throw new Error('expected monograph resolution');
  }
  return resolution.folios;
}

describe('page-range extract alignment (SC-002)', () => {
  it('resolves a f048-f050 extract to positions 1,2,3, not folio numbers', async () => {
    const fixture = await writeFixtureArchive({
      case: EXTRACT_SOURCE_CASE,
      slug: EXTRACT_SOURCE_SLUG,
      pageCount: 3,
      startFolio: 48,
    });
    try {
      const folios = await foliosOf(EXTRACT_SOURCE_ID, fixture.archiveRoot);

      expect(folios.map((f) => f.folioId)).toEqual(['f048', 'f049', 'f050']);
      expect(folios.map((f) => f.position)).toEqual([1, 2, 3]);
    } finally {
      fixture.cleanup();
    }
  });

  it('maps each extract folio to its extract-relative translation, not the folio number', async () => {
    const fixture = await writeFixtureArchive({
      case: EXTRACT_SOURCE_CASE,
      slug: EXTRACT_SOURCE_SLUG,
      pageCount: 3,
      startFolio: 48,
    });
    try {
      const folios = await foliosOf(EXTRACT_SOURCE_ID, fixture.archiveRoot);
      const segments = await readSegments(fixture.sourceDir);

      const [f048, f049, f050] = folios;

      const p001 = await loadArchivePage(f048, segments, 'french');
      expect(f048.folioId).toBe('f048');
      expect(f048.position).toBe(1);
      expect(p001.pageId).toBe('p001');
      expect(p001.folioId).toBe('f048');
      // Reads translation/p001.*, NOT a nonexistent translation/p048.* --
      // the fixture names the English text with both the extract-relative
      // page number and the absolute folio, so this pins the alignment.
      expect(p001.english).toBe('English translation for page 001 (folio f048)');

      const p002 = await loadArchivePage(f049, segments, 'french');
      expect(f049.folioId).toBe('f049');
      expect(f049.position).toBe(2);
      expect(p002.pageId).toBe('p002');
      expect(p002.folioId).toBe('f049');
      expect(p002.english).toBe('English translation for page 002 (folio f049)');

      const p003 = await loadArchivePage(f050, segments, 'french');
      expect(f050.folioId).toBe('f050');
      expect(f050.position).toBe(3);
      expect(p003.pageId).toBe('p003');
      expect(p003.folioId).toBe('f050');
      expect(p003.english).toBe('English translation for page 003 (folio f050)');
    } finally {
      fixture.cleanup();
    }
  });
});

describe('folio<->translation coverage guard (T012)', () => {
  it('under-count: a folio with no translation fails loud naming the page (existing T004 fail-loud)', async () => {
    // This is the per-folio absent-translation fail-loud already implemented
    // in `loadArchivePage` (T004, FR-008) -- asserted here directly per the
    // task instruction, rather than duplicating new coverage-guard code for
    // a case that already fails loud.
    const fixture = await writeFixtureArchive({
      case: EXTRACT_SOURCE_CASE,
      slug: EXTRACT_SOURCE_SLUG,
      pageCount: 3,
      startFolio: 48,
      pages: [{}, { omitTranslationArtifact: true }, {}],
    });
    try {
      const folios = await foliosOf(EXTRACT_SOURCE_ID, fixture.archiveRoot);
      const segments = await readSegments(fixture.sourceDir);

      // f049 (position 2) has no translation artifact at all.
      await expect(loadArchivePage(folios[1], segments, 'french')).rejects.toThrow(/p002/);
    } finally {
      fixture.cleanup();
    }
  });

  it('over-count: an extra translation with no matching folio fails loud naming the source (new guard)', async () => {
    // The per-folio check in `loadArchivePage` only ever iterates the
    // resolved folios, so it can never see a translation artifact whose
    // position has NO folio at all -- an orphaned p004.en.txt over a 3-folio
    // extract would otherwise be silently ignored. This is the genuine gap
    // T012 asks the guard to close, added to `resolveArchiveSource`.
    const fixture = await writeFixtureArchive({
      case: EXTRACT_SOURCE_CASE,
      slug: EXTRACT_SOURCE_SLUG,
      pageCount: 3,
      startFolio: 48,
    });
    try {
      const translationDir = path.join(fixture.sourceDir, 'translation');
      await mkdir(translationDir, { recursive: true });
      await writeFile(
        path.join(translationDir, 'p004.en.txt'),
        'orphaned translation with no corresponding folio',
      );

      await expect(
        resolveArchiveSource({
          sourceId: EXTRACT_SOURCE_ID,
          archiveRoot: fixture.archiveRoot,
        }),
      ).rejects.toThrow(/p004/);
    } finally {
      fixture.cleanup();
    }
  });

  it('an English source builds unaffected by an extra file in translation/ (AUDIT-16: French-only guard)', async () => {
    // The over-count guard is a FRENCH-path concern (translation/pNNN.en.txt
    // pairs with FR-OCR); it must not run at all for an English source. This
    // is deliberately unrealistic (an English source has no translation/ dir
    // in practice, and `checkTranslationCoverage` already no-ops when the dir
    // is absent) -- it pins that the guard is now gated on readingLanguage
    // === 'french' rather than merely happening to no-op today.
    const fixture = await writeFixtureArchive({
      case: EXTRACT_SOURCE_CASE,
      slug: EXTRACT_SOURCE_SLUG,
      pageCount: 3,
      startFolio: 48,
      language: 'English',
      omitTranslationDir: true,
    });
    try {
      const translationDir = path.join(fixture.sourceDir, 'translation');
      await mkdir(translationDir, { recursive: true });
      await writeFile(
        path.join(translationDir, 'p004.en.txt'),
        'stray file with no corresponding folio -- must not throw for English',
      );

      const resolution = await resolveArchiveSource({
        sourceId: EXTRACT_SOURCE_ID,
        archiveRoot: fixture.archiveRoot,
      });

      expect(resolution.kind).toBe('monograph');
      if (resolution.kind !== 'monograph') {
        throw new Error('expected monograph resolution');
      }
      expect(resolution.readingLanguage).toBe('english');
      expect(resolution.folios).toHaveLength(3);
    } finally {
      fixture.cleanup();
    }
  });
});
