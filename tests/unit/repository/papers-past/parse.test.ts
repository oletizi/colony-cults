/**
 * Tests for {@link parseArticle} (`@/repository/papers-past/parse`), the
 * mechanical Papers Past article-page parser (T006/T007,
 * specs/015-papers-past-acquisition).
 *
 * Real-fixture coverage: `fixtures/de-rays-article.html` -- the persisted
 * "CONVICTION OF MARQUIS DE RAYS." article page (article code
 * `HNS18840103.2.19.3`), captured 2026-07-18.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArticle } from '@/repository/papers-past/parse';

const FIXTURE_HTML = readFileSync(
  join(__dirname, 'fixtures', 'de-rays-article.html'),
  'utf-8',
);
const FIXTURE_URL = 'https://paperspast.natlib.govt.nz/newspapers/HNS18840103.2.19.3';

describe('parseArticle -- real fixture de-rays-article.html', () => {
  it('extracts the article id from the canonical link', () => {
    const article = parseArticle(FIXTURE_HTML, FIXTURE_URL);
    expect(article.articleId).toBe('HNS18840103.2.19.3');
  });

  it('extracts the title from the h3.article-title heading', () => {
    const article = parseArticle(FIXTURE_HTML, FIXTURE_URL);
    expect(article.title).toContain('CONVICTION OF MARQUIS DE RAYS');
  });

  it('extracts 3 image locators sequenced by area, resolved to ABSOLUTE /imageserver/ urls', () => {
    const article = parseArticle(FIXTURE_HTML, FIXTURE_URL);
    expect(article.imageLocators).toHaveLength(3);
    expect(article.imageLocators.map((locator) => locator.sequence)).toEqual([1, 2, 3]);
    for (const locator of article.imageLocators) {
      // Must be an ABSOLUTE, fetchable URL (the root-relative /imageserver/ src
      // resolved against the article page) — a relative path breaks getBytes.
      expect(locator.url).toMatch(/^https:\/\/paperspast\.natlib\.govt\.nz\/imageserver\//);
    }
  });

  it('extracts the verbatim rights statement', () => {
    const article = parseArticle(FIXTURE_HTML, FIXTURE_URL);
    expect(article.rightsRaw).toContain('No known copyright');
  });

  it('extracts on-page OCR text when present (best-effort)', () => {
    const article = parseArticle(FIXTURE_HTML, FIXTURE_URL);
    expect(article.ocrText).toBeDefined();
    expect(article.ocrText).toContain('found guilty and sentenced to four years');
  });

  it('throws on a non-article page', () => {
    const nonArticleHtml = '<html><body><h1>Search results</h1></body></html>';
    expect(() => parseArticle(nonArticleHtml, FIXTURE_URL)).toThrow();
  });
});
