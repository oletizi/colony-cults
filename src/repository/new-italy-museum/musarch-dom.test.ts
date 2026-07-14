/**
 * Tests for {@link parseMusarchItem} (`@/repository/new-italy-museum/musarch-dom`),
 * T014's DOM-direct mechanical-field pull for Musarch item pages.
 *
 * Real-fixture coverage: `__fixtures__/musarch-000844.html` (Pioneers Group
 * Photo 1890 -- has an image) and `__fixtures__/musarch-000855.html`
 * (Survivors arrival Sydney 1881).
 *
 * IMPORTANT DISCREPANCY (documented, not silently "fixed"): the task brief
 * and `__fixtures__/STRUCTURE.md` both describe fixture 000855 as having NO
 * `image_anchor` ("artist's impression, NO downloadable image" -- an
 * HTML-description-only item whose `masterImageUrl` should be `null`).
 * Reading the actual captured fixture shows this is not what the markup
 * contains: `musarch-000855.html` has TWO `<a class="image_anchor" ...>`
 * elements (`image_anchor000855000001` / `...000002`), both pointing at
 * `./images/000855_nimi-0855-arrival-sydney-1881-lr.jpg`. Since this parser
 * is mechanical/deterministic and explicitly must never special-case a
 * particular object id (that would be fabrication, not extraction), the
 * tests below assert what the real fixture actually mechanically yields: a
 * non-null `masterImageUrl` for 000855. The "no image_anchor -> null" code
 * path is real and still required (some Musarch items genuinely have none),
 * so it is covered here with a synthetic minimal snippet instead. This
 * discrepancy should be reconciled upstream (STRUCTURE.md and/or the fixture
 * capture) -- flagged rather than papered over.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMusarchItem } from '@/repository/new-italy-museum/musarch-dom';

const fixturesDir = join(process.cwd(), 'src', 'repository', 'new-italy-museum', '__fixtures__');

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf-8');
}

const PAGE_URL_000844 = 'https://newitaly.org.au/CAT/000844.htm';
const PAGE_URL_000855 = 'https://newitaly.org.au/CAT/000855.htm';

describe('parseMusarchItem -- real fixture musarch-000844.html (Pioneers Group Photo 1890, has an image)', () => {
  const html = readFixture('musarch-000844.html');
  const fields = parseMusarchItem(html, PAGE_URL_000844);

  it('extracts objectId', () => {
    expect(fields.objectId).toBe('000844');
  });

  it('extracts accession (the durable copy identity)', () => {
    expect(fields.accession).toBe('NIMI-0844');
  });

  it('extracts description containing "Pioneers Group Photo 1890"', () => {
    expect(fields.description).toContain('Pioneers Group Photo 1890');
  });

  it('resolves masterImageUrl to the absolute full-res jpg, never the tn_ thumbnail or a template gif', () => {
    expect(fields.masterImageUrl).toBe(
      'https://newitaly.org.au/CAT/images/000844_nimi-0844-pioneers-1890-lr.jpg',
    );
    expect(fields.masterImageUrl).not.toBeNull();
    const url = fields.masterImageUrl as string;
    expect(url).not.toContain('tn_');
    expect(url).not.toMatch(/img\d+\.gif$/i);
    expect(url).not.toContain('little_logo.jpg');
  });

  it('rawStructuredDate is null (the #objectdate span is blank on this fixture)', () => {
    expect(fields.rawStructuredDate).toBeNull();
  });
});

describe('parseMusarchItem -- real fixture musarch-000855.html (Survivors arrival Sydney 1881)', () => {
  const html = readFixture('musarch-000855.html');
  const fields = parseMusarchItem(html, PAGE_URL_000855);

  it('extracts objectId and accession', () => {
    expect(fields.objectId).toBe('000855');
    expect(fields.accession).toBe('NIMI-0855');
  });

  it('extracts description', () => {
    expect(fields.description).toContain('Artists impression of the Italian immigrants');
  });

  // See the module-level discrepancy note above: the real fixture DOES carry
  // `image_anchor` elements, contrary to STRUCTURE.md's "no downloadable
  // image" characterization of this item. Mechanical extraction from the
  // real markup correctly yields a non-null master here.
  it('resolves a non-null masterImageUrl -- the real fixture markup carries image_anchor elements (see discrepancy note above), never a tn_ thumbnail', () => {
    expect(fields.masterImageUrl).toBe(
      'https://newitaly.org.au/CAT/images/000855_nimi-0855-arrival-sydney-1881-lr.jpg',
    );
    const url = fields.masterImageUrl as string;
    expect(url).not.toContain('tn_');
  });

  it('extracts rawStructuredDate "1881" (the #objectdate span is non-blank on this fixture)', () => {
    expect(fields.rawStructuredDate).toBe('1881');
  });
});

describe('parseMusarchItem -- fail-loud on missing required fields (synthetic, no fabrication)', () => {
  const pageUrl = 'https://newitaly.org.au/CAT/000900.htm';

  it('throws when #objectaccession is absent', () => {
    const html = `
      <span class="data" id="objectid"> 000900</span>
      <span class="data" id="objectdesc"> Test Item</span>
    `;
    expect(() => parseMusarchItem(html, pageUrl)).toThrow(/objectaccession/);
  });

  it('throws when #objectaccession is present but empty', () => {
    const html = `
      <span class="data" id="objectid"> 000900</span>
      <span class="data" id="objectaccession"></span>
      <span class="data" id="objectdesc"> Test Item</span>
    `;
    expect(() => parseMusarchItem(html, pageUrl)).toThrow(/objectaccession/);
  });

  it('throws when #objectid is absent', () => {
    const html = `
      <span class="data" id="objectaccession"> NIMI-0900</span>
      <span class="data" id="objectdesc"> Test Item</span>
    `;
    expect(() => parseMusarchItem(html, pageUrl)).toThrow(/objectid/);
  });

  it('throws when no description is available (#objectdesc empty and no meta Description)', () => {
    const html = `
      <span class="data" id="objectid"> 000900</span>
      <span class="data" id="objectaccession"> NIMI-0900</span>
      <span class="data" id="objectdesc"></span>
    `;
    expect(() => parseMusarchItem(html, pageUrl)).toThrow(/description/);
  });

  it('throws when html is empty', () => {
    expect(() => parseMusarchItem('', pageUrl)).toThrow(/html is required/);
  });

  it('throws when pageUrl is empty', () => {
    const html = '<span class="data" id="objectid"> 000900</span>';
    expect(() => parseMusarchItem(html, '')).toThrow(/pageUrl is required/);
  });
});

describe('parseMusarchItem -- description fallback to <meta name="Description">', () => {
  it('falls back to the meta tag when #objectdesc is blank', () => {
    const html = `
      <meta name="Description" content="Fallback Desc From Meta">
      <span class="data" id="objectid"> 000901</span>
      <span class="data" id="objectaccession"> NIMI-0901</span>
      <span class="data" id="objectdesc"></span>
    `;
    const fields = parseMusarchItem(html, 'https://newitaly.org.au/CAT/000901.htm');
    expect(fields.description).toBe('Fallback Desc From Meta');
  });
});

describe('parseMusarchItem -- image-less item (no image_anchor at all)', () => {
  it('returns masterImageUrl null when the page has no image_anchor (HTML-description-only item)', () => {
    const html = `
      <span class="data" id="objectid"> 000902</span>
      <span class="data" id="objectaccession"> NIMI-0902</span>
      <span class="data" id="objectdesc"> No Image Item</span>
    `;
    const fields = parseMusarchItem(html, 'https://newitaly.org.au/CAT/000902.htm');
    expect(fields.masterImageUrl).toBeNull();
  });
});

describe('parseMusarchItem -- defensive guards: thumbnail/template graphics are never selected as master', () => {
  const baseSpans = `
    <span class="data" id="objectid"> 000903</span>
    <span class="data" id="objectaccession"> NIMI-0903</span>
    <span class="data" id="objectdesc"> Guard Test Item</span>
  `;
  const pageUrl = 'https://newitaly.org.au/CAT/000903.htm';

  it('throws (rather than mirroring) if the image_anchor href itself resolves to a tn_-prefixed filename', () => {
    const html = `${baseSpans}
      <a href="./images/tn_000903_guard-lr.jpg" target="_blank" class="image_anchor" id="image_anchor000903000001">
        <img src="./images/tn_000903_guard-lr.jpg" class="image" id="image000903000001">
      </a>
    `;
    expect(() => parseMusarchItem(html, pageUrl)).toThrow(/thumbnail/);
  });

  it('throws (rather than mirroring) if the image_anchor href resolves to a template gif', () => {
    const html = `${baseSpans}
      <a href="./images/img0001.gif" target="_blank" class="image_anchor" id="image_anchor000903000001">
        <img src="./images/img0001.gif" class="image" id="image000903000001">
      </a>
    `;
    expect(() => parseMusarchItem(html, pageUrl)).toThrow(/template graphic/);
  });

  it('throws (rather than mirroring) if the image_anchor href resolves to little_logo.jpg', () => {
    const html = `${baseSpans}
      <a href="./images/little_logo.jpg" target="_blank" class="image_anchor" id="image_anchor000903000001">
        <img src="./images/little_logo.jpg" class="image" id="image000903000001">
      </a>
    `;
    expect(() => parseMusarchItem(html, pageUrl)).toThrow(/template graphic/);
  });

  it('never picks the thumbnail img src even though it sits inside the anchor markup', () => {
    // Real-shape markup (as in the shipped fixtures): the anchor's OWN href is
    // the full-res master; its child <img> src is the tn_ thumbnail. The
    // resolved masterImageUrl must be the anchor href, never the child img src.
    const html = `${baseSpans}
      <a href="./images/000903_guard-lr.jpg" target="_blank" class="image_anchor" id="image_anchor000903000001">
        <img src="./images/tn_000903_guard-lr.jpg" class="image" id="image000903000001">
      </a>
    `;
    const fields = parseMusarchItem(html, pageUrl);
    expect(fields.masterImageUrl).toBe(
      'https://newitaly.org.au/CAT/images/000903_guard-lr.jpg',
    );
  });
});
