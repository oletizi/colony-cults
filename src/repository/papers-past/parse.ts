/**
 * Mechanical parse of a Papers Past article page into a {@link ParsedArticle}
 * (T006/T007, specs/015-papers-past-acquisition). Purely mechanical DOM
 * extraction -- no LLM involvement, no fallbacks, no fabricated fields.
 *
 * Selectors mirror the CONFIRMED content-read SourceConfig
 * (`@/sourcequery/sources/papers-past-article`): `h3` title, `#text-tab` OCR.
 * The canonical `<link rel="canonical">` supplies the article id (the `oid`
 * CGI arg / article code, e.g. `HNS18840103.2.19.3`), and image locators are
 * read from the `#image-tab` panel's `img[src*="/imageserver/"]` elements,
 * ordered by the `area` query parameter base64-encoded into each src.
 */

import { parse } from 'node-html-parser';
import type { ParsedArticle } from '@/repository/papers-past/types';

/** The correctable-text OCR panel (matches `ARTICLE_SELECTOR` in the SourceConfig). */
const OCR_SELECTOR = '#text-tab';
/** The article title heading (matches `TITLE_SELECTOR` in the SourceConfig). */
const TITLE_SELECTOR = 'h3.article-title, h3';
/** The "Image" tab panel -- the sole (non-duplicated) source of article image segments. */
const IMAGE_TAB_SELECTOR = '#image-tab';
/** Canonical link, the source of the article id / `oid` CGI arg. */
const CANONICAL_SELECTOR = 'link[rel="canonical"]';
/** The rights statement heading inside the `.copyright` block. */
const RIGHTS_HEADING_SELECTOR = '.copyright h5';

/**
 * Decodes the base64 `imageserver` path segment (e.g.
 * `P29pZD1ITlMxODg0MDEwMy4yLjE5LjMmY29sb3Vycz0zMiZleHQ9Z2lmJmFyZWE9MSZ3aWR0aD0zNzA=`)
 * into its query string (e.g.
 * `?oid=HNS18840103.2.19.3&colours=32&ext=gif&area=1&width=370`) and returns
 * the `area` value as a number.
 */
function decodeImageArea(imageUrl: string): number {
  const segment = imageUrl.split('/').pop();
  if (!segment) {
    throw new Error(`parseArticle: malformed /imageserver/ url, no path segment: "${imageUrl}"`);
  }
  const decoded = Buffer.from(segment, 'base64').toString('utf-8');
  const params = new URLSearchParams(decoded.replace(/^\?/, ''));
  const area = params.get('area');
  if (area === null || area.trim() === '') {
    throw new Error(
      `parseArticle: decoded /imageserver/ query has no "area" param: "${decoded}" (from "${imageUrl}")`,
    );
  }
  const sequence = Number.parseInt(area, 10);
  if (!Number.isFinite(sequence)) {
    throw new Error(`parseArticle: non-numeric "area" param "${area}" (from "${imageUrl}")`);
  }
  return sequence;
}

/**
 * Extracts the article id (`oid` / article code, e.g. `HNS18840103.2.19.3`)
 * from the canonical link's trailing path segment.
 */
function extractArticleId(root: ReturnType<typeof parse>): string {
  const canonical = root.querySelector(CANONICAL_SELECTOR);
  const href = canonical?.getAttribute('href');
  if (!href) {
    throw new Error(
      `parseArticle: no "${CANONICAL_SELECTOR}" element with an href; not an article page (fail-loud).`,
    );
  }
  const segments = href.split('/').filter((segment) => segment.length > 0);
  const articleId = segments[segments.length - 1];
  if (!articleId) {
    throw new Error(`parseArticle: canonical href has no trailing path segment: "${href}"`);
  }
  return articleId;
}

/** Extracts the article-heading text, stripped of the nested `<small>` newspaper/date/page detail. */
function extractTitle(root: ReturnType<typeof parse>): string {
  const heading = root.querySelector(TITLE_SELECTOR);
  if (!heading) {
    throw new Error(`parseArticle: no "${TITLE_SELECTOR}" element; not an article page (fail-loud).`);
  }
  const small = heading.querySelector('small');
  const smallText = small ? small.text.trim() : '';
  const fullText = heading.text.trim();
  const title = smallText ? fullText.slice(0, fullText.length - smallText.length).trim() : fullText;
  if (!title) {
    throw new Error('parseArticle: article title heading is empty.');
  }
  return title;
}

/** Extracts the ordered image locators from the `#image-tab` panel. */
function extractImageLocators(
  root: ReturnType<typeof parse>,
  sourceUrl: string,
): { url: string; sequence: number }[] {
  const imageTab = root.querySelector(IMAGE_TAB_SELECTOR);
  if (!imageTab) {
    throw new Error(`parseArticle: no "${IMAGE_TAB_SELECTOR}" panel; not an article page (fail-loud).`);
  }
  const images = imageTab.querySelectorAll('img[src*="/imageserver/"]');
  if (images.length === 0) {
    throw new Error(
      `parseArticle: no "img[src*=\\"/imageserver/\\"]" elements inside "${IMAGE_TAB_SELECTOR}"; ` +
        'zero image locators (fail-loud, never fabricate).',
    );
  }
  const locators = images.map((img) => {
    const src = img.getAttribute('src');
    if (!src) {
      throw new Error('parseArticle: image element has no "src" attribute.');
    }
    // Papers Past serves the `/imageserver/...` facsimile as a ROOT-RELATIVE
    // src; resolve it to an ABSOLUTE URL against the article page so the
    // byte-fetch client receives a fetchable URL (a relative path throws
    // "Failed to parse URL"). `new URL` leaves an already-absolute src intact.
    let url: string;
    try {
      url = new URL(src, sourceUrl).href;
    } catch {
      throw new Error(
        `parseArticle: cannot resolve image src "${src}" against source URL "${sourceUrl}" ` +
          '(an absolute article-page URL is required to resolve the relative /imageserver/ path).',
      );
    }
    return { url, sequence: decodeImageArea(src) };
  });
  locators.sort((a, b) => a.sequence - b.sequence);
  return locators;
}

/** Extracts the verbatim rights statement from the copyright block's `h5` heading. */
function extractRightsRaw(root: ReturnType<typeof parse>): string {
  const heading = root.querySelector(RIGHTS_HEADING_SELECTOR);
  const rightsRaw = heading ? heading.text.trim() : '';
  if (!rightsRaw) {
    throw new Error(
      `parseArticle: no "${RIGHTS_HEADING_SELECTOR}" element with text; missing rights statement (fail-loud).`,
    );
  }
  return rightsRaw;
}

/**
 * Extracts the on-page OCR text (best-effort). Absent -> `undefined`; never
 * fabricated. Not fail-loud: the `#text-tab` panel is expected on every real
 * article page (already required to exist for the non-article-page rejection
 * below), but empty/whitespace-only text is treated as "not present" rather
 * than an error, since OCR is out of scope as an acquired asset.
 */
function extractOcrText(root: ReturnType<typeof parse>): string | undefined {
  const container = root.querySelector(OCR_SELECTOR);
  const text = container ? container.text.trim().replace(/\s+/g, ' ') : '';
  return text.length > 0 ? text : undefined;
}

/**
 * Mechanically parses a Papers Past article page into a {@link ParsedArticle}.
 * Throws when the page is not a recognisable article page -- missing article
 * id, missing title, or zero image locators -- rather than fabricating any
 * field. `sourceUrl` (the absolute article-page URL) is the base against which
 * the root-relative `/imageserver/` image `src`s are resolved to absolute,
 * fetchable URLs.
 */
export function parseArticle(html: string, sourceUrl: string): ParsedArticle {
  const root = parse(html);

  const articleId = extractArticleId(root);
  const title = extractTitle(root);
  const imageLocators = extractImageLocators(root, sourceUrl);
  const rightsRaw = extractRightsRaw(root);
  const ocrText = extractOcrText(root);

  return {
    articleId,
    title,
    imageLocators,
    rightsRaw,
    ocrText,
  };
}
