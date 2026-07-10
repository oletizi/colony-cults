/**
 * T009 integration test: end-to-end corpus normalization (`loadCorpus`).
 *
 * Exercises the real PB-P001 archive clone through the loader and asserts the
 * corpus-loader contract guarantees (specs/005-corpus-browser/contracts/
 * corpus-loader.md G-1..G-6). Every case is guarded by {@link hasFixture} so
 * the suite skips cleanly when the archive is not present -- set
 * `CORPUS_ARCHIVE_PATH` to run it for real.
 */

import { describe, it, expect } from 'vitest';

import type { LoadConfig } from '@/browser/config';
import type { CorpusView, PageView } from '@/browser/model';
import { loadCorpus } from '@/browser/load/corpus';

import {
  cleanupCopy,
  hasFixture,
  makeCleanArchive,
  makeCorruptedCopy,
  SIBLING_ISSUE_ID,
} from './fixtures';

const FIXTURE_ISSUE_ID = '1879-08-15_bpt6k56068358';
const FIXTURE_ISSUE_DATE = '1879-08-15';
const FIXTURE_ISSUE_ARK = 'ark:/12148/bpt6k56068358';
const FIXTURE_PAGE_COUNT = 8;

function configFor(archivePath: string): LoadConfig {
  return {
    archivePath,
    sources: ['PB-P001'],
    provider: { kind: 'source-iiif' },
  };
}

function fixtureSource(corpus: CorpusView) {
  const source = corpus.sources.find((s) => s.sourceId === 'PB-P001');
  if (source === undefined) {
    throw new Error('test setup: PB-P001 source not present in loaded corpus');
  }
  return source;
}

function fixtureIssue(corpus: CorpusView) {
  const issue = fixtureSource(corpus).issues.find((i) => i.issueId === FIXTURE_ISSUE_ID);
  if (issue === undefined) {
    throw new Error(`test setup: fixture issue ${FIXTURE_ISSUE_ID} not present in loaded corpus`);
  }
  return issue;
}

describe('loadCorpus (integration, PB-P001)', () => {
  it('normalizes the fixture issue end-to-end (G-1, G-2, G-3, G-6)', () => {
    if (!hasFixture()) {
      return; // clean skip when the archive clone is absent
    }

    const archive = makeCleanArchive();
    try {
      const { corpus, skipped } = loadCorpus(configFor(archive));

      // A clean single-complete-issue archive skips nothing.
      expect(skipped).toEqual([]);

      // SourceView scaffold.
      const source = fixtureSource(corpus);
      expect(source.title).toBe(
        'La Nouvelle France'
      );
      expect(source.kind).toBe('periodical');
      expect(source.ark.length).toBeGreaterThan(0);
      expect(source.rights).toBe('public-domain');

      // IssueView + G-1 page-count coherence.
      const issue = fixtureIssue(corpus);
      expect(issue.date).toBe(FIXTURE_ISSUE_DATE);
      expect(issue.pageCount).toBe(FIXTURE_PAGE_COUNT);
      expect(issue.pages).toHaveLength(FIXTURE_PAGE_COUNT);

      // G-6 deterministic ordering: pages sorted by page number.
      const pageIds = issue.pages.map((p) => p.pageId);
      expect(pageIds).toEqual([...pageIds].sort());
      expect(pageIds).toEqual([
        'p001', 'p002', 'p003', 'p004', 'p005', 'p006', 'p007', 'p008',
      ]);

      for (const page of issue.pages) {
        assertPageComplete(page);
      }

      // Image resolution (source-iiif) carries the ISSUE ark, not the source ark.
      // The provider emits a full-image Gallica url with the UN-padded folio
      // (f001 -> f1) and no CORS/info.json path (TASK-10/TASK-11).
      const firstPage = issue.pages[0];
      expect(firstPage.image.kind).toBe('full-image');
      expect(firstPage.image.url).toContain(FIXTURE_ISSUE_ARK);
      const unpaddedFolio = `f${Number(firstPage.folioId.replace(/^f/, ''))}`;
      expect(firstPage.image.url).toContain(`/${unpaddedFolio}/full/full/0/native.jpg`);
    } finally {
      cleanupCopy(archive);
    }
  });

  it('is deterministic: two loads of the same archive are deep-equal (G-6)', () => {
    if (!hasFixture()) {
      return;
    }

    const archive = makeCleanArchive();
    try {
      const first = loadCorpus(configFor(archive));
      const second = loadCorpus(configFor(archive));
      expect(second).toEqual(first);
    } finally {
      cleanupCopy(archive);
    }
  });

  it('throws when a required translation layer is missing (drop-translation)', () => {
    if (!hasFixture()) {
      return;
    }

    const archive = makeCorruptedCopy('drop-translation');
    try {
      expect(() => loadCorpus(configFor(archive))).toThrow(/p003/);
    } finally {
      cleanupCopy(archive);
    }
  });

  it('throws when a provenance field is missing (drop-provenance-field)', () => {
    if (!hasFixture()) {
      return;
    }

    const archive = makeCorruptedCopy('drop-provenance-field');
    try {
      expect(() => loadCorpus(configFor(archive))).toThrow(/sha256/);
    } finally {
      cleanupCopy(archive);
    }
  });

  it('throws on page-count skew (skew-page-count)', () => {
    if (!hasFixture()) {
      return;
    }

    const archive = makeCorruptedCopy('skew-page-count');
    try {
      // The image/OCR-count mismatch must be named against source + issue.
      expect(() => loadCorpus(configFor(archive))).toThrow(
        /PB-P001[\s\S]*1879-08-15_bpt6k56068358|1879-08-15_bpt6k56068358[\s\S]*PB-P001/
      );
    } finally {
      cleanupCopy(archive);
    }
  });

  it('SKIPS (not throws) when the whole OCR layer is absent (drop-issue-ocr)', () => {
    if (!hasFixture()) {
      return;
    }

    const archive = makeCorruptedCopy('drop-issue-ocr');
    try {
      const { corpus, skipped } = loadCorpus(configFor(archive));

      // The mutated issue is skipped + reported, not thrown; the complete
      // sibling still loads (a mix of complete + skipped in one source).
      const loadedIds = fixtureSource(corpus).issues.map((i) => i.issueId);
      expect(loadedIds).toEqual([SIBLING_ISSUE_ID]);
      expect(loadedIds).not.toContain(FIXTURE_ISSUE_ID);

      expect(skipped).toHaveLength(1);
      expect(skipped[0].issueId).toBe(FIXTURE_ISSUE_ID);
      expect(skipped[0].sourceId).toBe('PB-P001');
      expect(skipped[0].reason).toMatch(/issue\.txt/);
    } finally {
      cleanupCopy(archive);
    }
  });

  it('SKIPS (not throws) when the whole translation dir is absent (drop-translation-dir)', () => {
    if (!hasFixture()) {
      return;
    }

    const archive = makeCorruptedCopy('drop-translation-dir');
    try {
      const { corpus, skipped } = loadCorpus(configFor(archive));

      const loadedIds = fixtureSource(corpus).issues.map((i) => i.issueId);
      expect(loadedIds).toEqual([SIBLING_ISSUE_ID]);
      expect(loadedIds).not.toContain(FIXTURE_ISSUE_ID);

      expect(skipped).toHaveLength(1);
      expect(skipped[0].issueId).toBe(FIXTURE_ISSUE_ID);
      expect(skipped[0].reason).toMatch(/translation/);
    } finally {
      cleanupCopy(archive);
    }
  });
});

/**
 * Asserts a page satisfies the required-layer + provenance-completeness
 * guarantees (G-2, G-3, G-4): every layer present, provenance fully
 * populated, no placeholder substitution.
 */
function assertPageComplete(page: PageView): void {
  expect(page.pageId).toMatch(/^p\d{3}$/);
  expect(page.folioId).toMatch(/^f\d{3}$/);
  expect(page.english.length).toBeGreaterThan(0);
  expect(page.ocrFrench.length).toBeGreaterThan(0);
  expect(page.image.url.length).toBeGreaterThan(0);

  const prov = page.provenance;
  expect(prov.sourceId).toBe('PB-P001');
  expect(prov.ark).toBe(FIXTURE_ISSUE_ARK);
  expect(prov.date).toBe(FIXTURE_ISSUE_DATE);
  expect(prov.rights).toBe('public-domain');
  expect(prov.page).toBe(page.pageId);
  expect(prov.sha256).toMatch(/^[0-9a-f]{64}$/);
}
