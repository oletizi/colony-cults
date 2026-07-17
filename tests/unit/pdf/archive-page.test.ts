import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { splitIssueOcr } from '@/browser/load/ocr-pages';
import type { ArchivePageSource } from '@/pdf/load/archive-source';
import { resolveArchiveSource } from '@/pdf/load/archive-source';
import { loadArchivePage } from '@/pdf/load/archive-page';

import { writeFixtureArchive } from './archive-fixture';

// Sources already registered in `@/archive/location`'s static SOURCE_LAYOUTS,
// reused so `resolveArchiveSource` resolves without any test-only registry
// mutation. Each test builds its own temp `archiveRoot`.
const FULL_SOURCE_ID = 'PB-P002';
const FULL_SOURCE_CASE = 'port-breton';
const FULL_SOURCE_SLUG = 'nouvelle-france-colonie-libre-port-breton';

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

describe('loadArchivePage', () => {
  it('assembles a machine-assisted page: pageId p001, OCR + english, no marker', async () => {
    const fixture = await writeFixtureArchive({
      case: FULL_SOURCE_CASE,
      slug: FULL_SOURCE_SLUG,
      pageCount: 3,
    });
    try {
      const folios = await foliosOf(FULL_SOURCE_ID, fixture.archiveRoot);
      const segments = await readSegments(fixture.sourceDir);

      const content = await loadArchivePage(folios[0], segments);

      expect(content.pageId).toBe('p001');
      expect(content.folioId).toBe('f001');
      expect(content.ocrFrench.length).toBeGreaterThan(0);
      expect(content.english).toBe('English translation for page 001 (folio f001)');
      expect(content.untranslatable).toBe(false);
      expect(content.machineAssist).not.toBeNull();
      expect(content.machineAssist?.engine).toBe('claude-code-cli');
      expect(content.machineAssist?.model).toBe('claude-opus-4');
      expect(content.machineAssist?.retrieved).toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(content.ocrCondition).toBeNull();
    } finally {
      fixture.cleanup();
    }
  });

  it('marks an untranslatable page: english is "" and untranslatable is true', async () => {
    const fixture = await writeFixtureArchive({
      case: FULL_SOURCE_CASE,
      slug: FULL_SOURCE_SLUG,
      pageCount: 1,
      pages: [{ translationLabel: 'untranslatable' }],
    });
    try {
      const folios = await foliosOf(FULL_SOURCE_ID, fixture.archiveRoot);
      const segments = await readSegments(fixture.sourceDir);

      const content = await loadArchivePage(folios[0], segments);

      expect(content.english).toBe('');
      expect(content.untranslatable).toBe(true);
      expect(content.ocrFrench.length).toBeGreaterThan(0);
    } finally {
      fixture.cleanup();
    }
  });

  it('fails loud naming the page when the translation artifact is absent', async () => {
    const fixture = await writeFixtureArchive({
      case: FULL_SOURCE_CASE,
      slug: FULL_SOURCE_SLUG,
      pageCount: 1,
      pages: [{ omitTranslationArtifact: true }],
    });
    try {
      const folios = await foliosOf(FULL_SOURCE_ID, fixture.archiveRoot);
      const segments = await readSegments(fixture.sourceDir);

      await expect(loadArchivePage(folios[0], segments)).rejects.toThrow(/p001/);
    } finally {
      fixture.cleanup();
    }
  });

  it('fails loud on an inconsistent page: untranslatable label with non-empty text', async () => {
    const fixture = await writeFixtureArchive({
      case: FULL_SOURCE_CASE,
      slug: FULL_SOURCE_SLUG,
      pageCount: 1,
      pages: [{ translationLabel: 'untranslatable' }],
    });
    try {
      // Corrupt the fixture into the inconsistent state: an `untranslatable`
      // sidecar label alongside a NON-empty en.txt (violates empty ⟺ untranslatable).
      await writeFile(
        path.join(fixture.sourceDir, 'translation', 'p001.en.txt'),
        'unexpected non-empty translation text',
      );
      const folios = await foliosOf(FULL_SOURCE_ID, fixture.archiveRoot);
      const segments = await readSegments(fixture.sourceDir);

      await expect(loadArchivePage(folios[0], segments)).rejects.toThrow(/p001/);
    } finally {
      fixture.cleanup();
    }
  });

  it('maps by POSITION: folio f048 at position 1 reads translation/p001, not p048', async () => {
    const fixture = await writeFixtureArchive({
      case: EXTRACT_SOURCE_CASE,
      slug: EXTRACT_SOURCE_SLUG,
      pageCount: 3,
      startFolio: 48,
    });
    try {
      const folios = await foliosOf(EXTRACT_SOURCE_ID, fixture.archiveRoot);
      const segments = await readSegments(fixture.sourceDir);

      expect(folios[0].folioId).toBe('f048');
      expect(folios[0].position).toBe(1);

      const content = await loadArchivePage(folios[0], segments);

      expect(content.pageId).toBe('p001');
      expect(content.folioId).toBe('f048');
      // The english text the fixture wrote to translation/p001.en.txt names the
      // extract-relative page number (001) and the absolute folio (f048).
      expect(content.english).toBe('English translation for page 001 (folio f048)');
      expect(content.untranslatable).toBe(false);
    } finally {
      fixture.cleanup();
    }
  });
});
