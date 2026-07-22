/**
 * T013 (US3): untranslatable-marker handling at the `archive-page` level
 * (spec 014, SC-004, FR-007/FR-008).
 *
 * Exercises `loadArchivePage` against `writeFixtureArchive` fixtures:
 *  - an `untranslatable`-labeled page yields `english === ''` and
 *    `untranslatable === true`, and does NOT throw (FR-007, SC-004).
 *  - an absent translation artifact fails loud, naming the page (FR-008).
 *  - an inconsistent label/text pairing (labeled `untranslatable` but
 *    non-empty `en.txt`) fails loud, naming the page.
 *  - a mixed source (one untranslatable + one normal page) renders the
 *    normal page's text and blanks only the untranslatable one.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { splitIssueOcr } from '@/browser/load/ocr-pages';
import type { ArchivePageSource } from '@/pdf/load/archive-source';
import { resolveArchiveSource } from '@/pdf/load/archive-source';
import { loadArchivePage } from '@/pdf/load/archive-page';

import { writeFixtureArchive } from './archive-fixture';

// A source already registered in `@/archive/location`'s static SOURCE_LAYOUTS,
// reused so `resolveArchiveSource` resolves without any test-only registry
// mutation. Each test builds its own temp `archiveRoot`.
const SOURCE_ID = 'PB-P002';
const SOURCE_CASE = 'port-breton';
const SOURCE_SLUG = 'nouvelle-france-colonie-libre-port-breton';

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

describe('loadArchivePage: untranslatable marker (SC-004, FR-007/FR-008)', () => {
  it('an untranslatable page yields empty english + untranslatable=true, and does not throw', async () => {
    const fixture = await writeFixtureArchive({
      case: SOURCE_CASE,
      slug: SOURCE_SLUG,
      pageCount: 1,
      pages: [{ translationLabel: 'untranslatable' }],
    });
    try {
      const folios = await foliosOf(SOURCE_ID, fixture.archiveRoot);
      const segments = await readSegments(fixture.sourceDir);

      const content = await loadArchivePage(folios[0], segments, 'french');

      expect(content.english).toBe('');
      expect(content.untranslatable).toBe(true);
      // The OCR French side is unaffected by the translation marker (FR-007
      // blanks only the translation column, never the OCR).
      expect(content.ocrFrench.length).toBeGreaterThan(0);
    } finally {
      fixture.cleanup();
    }
  });

  it('fails loud, naming the page, when the translation artifact is absent (FR-008)', async () => {
    const fixture = await writeFixtureArchive({
      case: SOURCE_CASE,
      slug: SOURCE_SLUG,
      pageCount: 1,
      pages: [{ omitTranslationArtifact: true }],
    });
    try {
      const folios = await foliosOf(SOURCE_ID, fixture.archiveRoot);
      const segments = await readSegments(fixture.sourceDir);

      await expect(loadArchivePage(folios[0], segments, 'french')).rejects.toThrow(/p001/);
    } finally {
      fixture.cleanup();
    }
  });

  it('fails loud on an inconsistent label: "untranslatable" sidecar with non-empty en.txt', async () => {
    const fixture = await writeFixtureArchive({
      case: SOURCE_CASE,
      slug: SOURCE_SLUG,
      pageCount: 1,
      pages: [{ translationLabel: 'untranslatable' }],
    });
    try {
      // Corrupt the fixture into the inconsistent state: the sidecar still
      // labels the page `untranslatable`, but the text file now carries
      // non-empty text (violates the empty <=> untranslatable invariant).
      await writeFile(
        path.join(fixture.sourceDir, 'translation', 'p001.en.txt'),
        'unexpected non-empty translation text',
      );
      const folios = await foliosOf(SOURCE_ID, fixture.archiveRoot);
      const segments = await readSegments(fixture.sourceDir);

      await expect(loadArchivePage(folios[0], segments, 'french')).rejects.toThrow(/p001/);
    } finally {
      fixture.cleanup();
    }
  });

  it('mixed source: one normal page renders text, one untranslatable page is blank', async () => {
    const fixture = await writeFixtureArchive({
      case: SOURCE_CASE,
      slug: SOURCE_SLUG,
      pageCount: 2,
      pages: [{}, { translationLabel: 'untranslatable' }],
    });
    try {
      const folios = await foliosOf(SOURCE_ID, fixture.archiveRoot);
      const segments = await readSegments(fixture.sourceDir);

      const normalContent = await loadArchivePage(folios[0], segments, 'french');
      const untranslatableContent = await loadArchivePage(folios[1], segments, 'french');

      expect(normalContent.english.length).toBeGreaterThan(0);
      expect(normalContent.untranslatable).toBe(false);

      expect(untranslatableContent.english).toBe('');
      expect(untranslatableContent.untranslatable).toBe(true);
      expect(untranslatableContent.ocrFrench.length).toBeGreaterThan(0);
    } finally {
      fixture.cleanup();
    }
  });
});
