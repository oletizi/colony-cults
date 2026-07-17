/**
 * `parseScandata` / `proposeReadingRange` -- parse an Internet Archive
 * `<id>_scandata.xml` into per-leaf page-type + recorded dimensions, and
 * propose a reading-range seed for the operator's `QualityAssessment`
 * (specs/013-archiveorg-acquisition-path). Reuses the project's shipped
 * `fast-xml-parser` dependency and the shared `@/gallica/xml` navigation
 * helpers -- no new dependency added.
 *
 * @see specs/013-archiveorg-acquisition-path/data-model.md -- § QualityAssessment / LeafRange
 * @see specs/013-archiveorg-acquisition-path/contracts/internet-archive-adapter.md -- FR-008
 *   ("`approvedLeafRange` is seeded from `scandata.xml` `pageType`
 *   (Cover/Title/Normal/…) but the operator confirms/overrides").
 *
 * Fail-loud, no fabrication (Principle V): a `scandata.xml` that fails to
 * parse, or whose `<book><pageData>` holds no `<page>` leaves, throws rather
 * than returning an empty/partial result. Likewise, `proposeReadingRange`
 * throws when there is no `"Normal"`-typed leaf to seed a range from -- the
 * operator must select the range manually rather than receive a fabricated
 * one.
 */

import { XMLParser } from 'fast-xml-parser';
import {
  childNumber,
  childRecord,
  childString,
  requireRecord,
  toArray,
} from '@/gallica/xml';
import type { LeafRange } from '@/model/quality-assessment';

/** One `<page>` leaf from a `scandata.xml`'s `<book><pageData>`. */
export interface ScandataLeaf {
  /** 1-based leaf number (`<page leafNum="...">`). */
  leafNum: number;
  /** Archive.org's page classification, e.g. `Cover`, `Title`, `Color Card`, `Normal`. */
  pageType: string;
  /** Recorded scan width in pixels (`<origWidth>`, else the `<cropBox><w>`), when present. */
  width?: number;
  /** Recorded scan height in pixels (`<origHeight>`, else the `<cropBox><h>`), when present. */
  height?: number;
}

/**
 * Read a recorded scan dimension from a `<page>` leaf. Real Internet Archive
 * scandata records the scan pixel size as `<origWidth>`/`<origHeight>` (the
 * shape the de Groote item and IA's current scandata export use); older
 * exports used `<originalWidth>`/`<originalHeight>`; both fall back to the
 * `<cropBox>`'s `<w>`/`<h>`. Returns `undefined` when none is present rather
 * than fabricating a dimension (Principle V) -- an absent dimension is handled
 * downstream by the fidelity probe, which fails loud on no usable overlap.
 */
function leafDimension(
  page: Record<string, unknown>,
  ctx: string,
  which: 'width' | 'height',
): number | undefined {
  const orig = which === 'width' ? 'origWidth' : 'origHeight';
  const original = which === 'width' ? 'originalWidth' : 'originalHeight';
  const cropKey = which === 'width' ? 'w' : 'h';
  if (page[orig] !== undefined) {
    return childNumber(page, orig, ctx);
  }
  if (page[original] !== undefined) {
    return childNumber(page, original, ctx);
  }
  if (page.cropBox !== undefined) {
    const crop = childRecord(page, 'cropBox', ctx);
    if (crop[cropKey] !== undefined) {
      return childNumber(crop, cropKey, `${ctx} > cropBox`);
    }
  }
  return undefined;
}

/**
 * A `fast-xml-parser` configured to expose the `leafNum` attribute (as
 * `@_leafNum`) alongside child elements, and to keep values as parsed text
 * so numeric coercion happens explicitly via `@/gallica/xml`'s helpers --
 * the same convention `bnf-sru-parse.ts` and `gallica-client.ts` use.
 */
function createScandataParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    trimValues: true,
  });
}

/**
 * Parse a `scandata.xml` document into one {@link ScandataLeaf} per
 * `<page>`. Throws a descriptive Error when the XML does not parse, or when
 * `<book><pageData>` has no `<page>` leaves at all.
 */
export function parseScandata(xml: string): ScandataLeaf[] {
  if (typeof xml !== 'string' || xml.trim().length === 0) {
    throw new Error('parseScandata: empty scandata XML input.');
  }

  const parser = createScandataParser();
  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`parseScandata: malformed scandata XML: ${message}`);
  }

  const root = requireRecord(parsed, 'scandata XML');
  const book = childRecord(root, 'book', 'scandata XML');
  const rawPageData = book.pageData;

  // An empty `<pageData></pageData>` (no `<page>` children) parses to an
  // empty string rather than an object -- that is still "no leaves", not a
  // shape error, so it is handled the same as a present-but-empty page list.
  const rawPages =
    rawPageData === undefined || rawPageData === ''
      ? []
      : toArray(childRecord(book, 'pageData', 'scandata XML > book').page);

  if (rawPages.length === 0) {
    throw new Error(
      'parseScandata: <book><pageData> has no <page> leaves -- cannot derive per-leaf page types.',
    );
  }

  return rawPages.map((rawPage, index) => {
    const ctx = `scandata XML > book > pageData > page[${index}]`;
    const page = requireRecord(rawPage, ctx);

    const leafNum = childNumber(page, '@_leafNum', ctx);
    const pageType = childString(page, 'pageType', ctx);

    const leaf: ScandataLeaf = { leafNum, pageType };
    const width = leafDimension(page, ctx, 'width');
    if (width !== undefined) {
      leaf.width = width;
    }
    const height = leafDimension(page, ctx, 'height');
    if (height !== undefined) {
      leaf.height = height;
    }
    return leaf;
  });
}

/**
 * Propose a reading-range **seed** ({@link LeafRange}, 1-based inclusive):
 * the span from the first to the last leaf whose `pageType` is exactly
 * `"Normal"`. This naturally excludes leading/trailing front-matter leaf
 * types (`Cover`, `Title`, `Color Card`, `Contents`, and similar
 * non-content types) since they are never typed `"Normal"`.
 *
 * This is only a SEED -- FR-008 requires the operator to confirm or
 * override it via `QualityAssessment.approvedLeafRange`. A non-`"Normal"`
 * leaf can end up included in the operator's approved range (e.g. a plate
 * or illustration interleaved among content leaves); the seed never decides
 * that, it only proposes the outer bound.
 *
 * Throws when there is no `"Normal"`-typed leaf -- a range must never be
 * fabricated; the operator selects manually in that case.
 */
export function proposeReadingRange(leaves: readonly ScandataLeaf[]): LeafRange {
  const normalLeaves = leaves.filter((leaf) => leaf.pageType === 'Normal');

  if (normalLeaves.length === 0) {
    throw new Error(
      'proposeReadingRange: no leaves with pageType "Normal" -- refusing to fabricate a range; ' +
        'the operator must select the reading range manually.',
    );
  }

  const leafNums = normalLeaves.map((leaf) => leaf.leafNum);
  return {
    start: Math.min(...leafNums),
    end: Math.max(...leafNums),
  };
}
