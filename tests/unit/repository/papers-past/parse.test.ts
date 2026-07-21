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
import { parseArticle, decodeImageArea } from '@/repository/papers-past/parse';
import { objectKeyForOcr, provenancePathForOcr } from '@/repository/papers-past/keys';

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

describe('objectKeyForOcr / provenancePathForOcr', () => {
  it('are deterministic .txt/.yml under the article dir', () => {
    const sha = 'a'.repeat(64);
    expect(objectKeyForOcr('HNS18840103.2.19.3', sha)).toBe(
      `archive/papers-past/hns18840103.2.19.3/${sha}.txt`,
    );
    expect(provenancePathForOcr('HNS18840103.2.19.3', sha)).toBe(
      `archive/papers-past/hns18840103.2.19.3/${sha}.yml`,
    );
  });
});

describe('extractOcrText (via parseArticle) -- faithful, not whitespace-collapsed', () => {
  it('preserves internal line structure across a multi-paragraph #text-tab panel', () => {
    const articleId = 'ABC18990101.2.5.1';
    const sourceUrl = `https://paperspast.natlib.govt.nz/newspapers/${articleId}`;
    // Encode a real /imageserver/ payload so extractImageLocators succeeds --
    // parseArticle also requires image locators, a title, and a rights heading.
    const imageQuery = `?oid=${articleId}&colours=32&ext=gif&area=1&width=370`;
    const imagePayload = Buffer.from(imageQuery, 'utf-8').toString('base64');
    const html = `<html><head>
      <link rel="canonical" href="${sourceUrl}">
    </head><body>
      <h3 class="article-title">TEST ARTICLE</h3>
      <div id="image-tab"><img src="/imageserver/newspapers/${imagePayload}"></div>
      <div id="text-tab"><p>LINE ONE</p><p>LINE TWO</p></div>
      <div class="copyright"><h5>No known copyright restrictions</h5></div>
    </body></html>`;

    const article = parseArticle(html, sourceUrl);

    expect(article.ocrText).toBeDefined();
    // The two <p> block boundaries must survive as a newline, not collapse to
    // a single space -- proof the ".replace(/\s+/g, ' ')" collapse is gone.
    expect(article.ocrText).toContain('\n');
    expect(article.ocrText).toContain('LINE ONE');
    expect(article.ocrText).toContain('LINE TWO');
  });
});

describe('decodeImageArea -- standard base64 containing a "/" (AUDIT-01 regression)', () => {
  // A STANDARD-base64 payload that legitimately contains a "/" MID-STRING (the
  // byte "?" at a triplet boundary encodes to "/"): `area=42&width=370&oid=A?&z=99`
  // -> this base64, whose "/" sits at index 31. The OLD `split('/').pop()` keeps
  // only the tail after that "/" ("Jno9OTk="), which decodes to "&z=99" -- NO
  // "area" param, so the old code THROWS. This is exactly the ~61% production-break
  // AUDIT-01 describes. The marker-based isolation decodes the FULL payload -> 42.
  const BASE64_WITH_SLASH = 'YXJlYT00MiZ3aWR0aD0zNzAmb2lkPUE/Jno9OTk=';

  it('is a base64 whose alphabet actually contains a MID-STRING "/" (guards the vector)', () => {
    expect(BASE64_WITH_SLASH).toContain('/');
    expect(BASE64_WITH_SLASH.indexOf('/')).toBeLessThan(BASE64_WITH_SLASH.length - 1);
    expect(Buffer.from(BASE64_WITH_SLASH, 'base64').toString('utf-8')).toBe(
      'area=42&width=370&oid=A?&z=99',
    );
    // The OLD split('/').pop() tail drops "area" entirely -> old code would throw.
    expect(BASE64_WITH_SLASH.split('/').pop()).toBe('Jno9OTk=');
  });

  it('isolates the payload by the /imageserver/newspapers/ marker, not the last "/"', () => {
    const src = `/imageserver/newspapers/${BASE64_WITH_SLASH}`;
    expect(decodeImageArea(src)).toBe(42);
  });

  it('also works for the bare /imageserver/ marker and strips a trailing query', () => {
    const src = `https://paperspast.natlib.govt.nz/imageserver/${BASE64_WITH_SLASH}?cachebust=1`;
    expect(decodeImageArea(src)).toBe(42);
  });

  it('throws (fail-loud) when no /imageserver/ marker is present', () => {
    expect(() => decodeImageArea(`https://example.test/${BASE64_WITH_SLASH}`)).toThrow(
      /imageserver/,
    );
  });
});
