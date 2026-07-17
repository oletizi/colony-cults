/**
 * Tests for {@link parseScandata} / {@link proposeReadingRange}
 * (`@/repository/internet-archive/scandata`), the T033 scandata parse for
 * the Internet Archive acquisition adapter (specs/013-archiveorg-acquisition-path).
 *
 * Real-fixture coverage: `__fixtures__/scandata-nouvellefrancec00groogoog.xml`
 * -- 8 leaves: Cover, Color Card, Title, then 5 Normal content leaves.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseScandata, proposeReadingRange } from '@/repository/internet-archive/scandata';

const fixturesDir = join(
  process.cwd(),
  'src',
  'repository',
  'internet-archive',
  '__fixtures__',
);

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf-8');
}

const FIXTURE_XML = readFixture('scandata-nouvellefrancec00groogoog.xml');

describe('parseScandata -- real fixture scandata-nouvellefrancec00groogoog.xml', () => {
  it('parses 8 leaves', () => {
    const leaves = parseScandata(FIXTURE_XML);
    expect(leaves).toHaveLength(8);
  });

  it('parses leafNum in order', () => {
    const leaves = parseScandata(FIXTURE_XML);
    expect(leaves.map((leaf) => leaf.leafNum)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('parses the front-matter pageTypes in order: Cover, Color Card, Title', () => {
    const leaves = parseScandata(FIXTURE_XML);
    expect(leaves[0].pageType).toBe('Cover');
    expect(leaves[1].pageType).toBe('Color Card');
    expect(leaves[2].pageType).toBe('Title');
  });

  it('parses the remaining 5 leaves as Normal', () => {
    const leaves = parseScandata(FIXTURE_XML);
    expect(leaves.slice(3).map((leaf) => leaf.pageType)).toEqual([
      'Normal',
      'Normal',
      'Normal',
      'Normal',
      'Normal',
    ]);
  });

  it('parses recorded dimensions for each leaf', () => {
    const leaves = parseScandata(FIXTURE_XML);
    expect(leaves[0]).toEqual({
      leafNum: 1,
      pageType: 'Cover',
      width: 1600,
      height: 2300,
    });
    expect(leaves[2]).toEqual({
      leafNum: 3,
      pageType: 'Title',
      width: 1580,
      height: 2290,
    });
    expect(leaves[4]).toEqual({
      leafNum: 5,
      pageType: 'Normal',
      width: 1598,
      height: 2305,
    });
  });

  it('throws on XML with zero <page> leaves', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<book>
  <pageData>
  </pageData>
</book>`;
    expect(() => parseScandata(xml)).toThrow(/no <page> leaves/);
  });

  it('throws on unparseable XML', () => {
    expect(() => parseScandata('')).toThrow(/empty/);
  });

  it('throws on XML missing <book>', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><notabook/>`;
    expect(() => parseScandata(xml)).toThrow();
  });
});

describe('proposeReadingRange -- real fixture scandata-nouvellefrancec00groogoog.xml', () => {
  it('returns the Normal span, excluding the Cover/Color Card/Title front leaves', () => {
    const leaves = parseScandata(FIXTURE_XML);
    const range = proposeReadingRange(leaves);
    expect(range).toEqual({ start: 4, end: 8 });
  });

  it('throws when there are no Normal leaves', () => {
    const leaves = [
      { leafNum: 1, pageType: 'Cover' },
      { leafNum: 2, pageType: 'Color Card' },
      { leafNum: 3, pageType: 'Title' },
    ];
    expect(() => proposeReadingRange(leaves)).toThrow(/no leaves with pageType "Normal"/);
  });

  it('throws on an empty leaf list', () => {
    expect(() => proposeReadingRange([])).toThrow(/no leaves with pageType "Normal"/);
  });
});

describe('parseScandata -- 0-based leaf numbering (newspaper issues) normalized to 1-based', () => {
  // Many archive.org newspaper issues (China Mail, Hong Kong Daily Press) number
  // scandata leaves from 0; the adapter assumes 1-based (leaf N <-> PDF page N).
  const ZERO_BASED = `<book><pageData>
    <page leafNum="0"><pageType>Normal</pageType></page>
    <page leafNum="1"><pageType>Normal</pageType></page>
    <page leafNum="2"><pageType>Normal</pageType></page>
    <page leafNum="3"><pageType>Normal</pageType></page>
  </pageData></book>`;

  it('shifts a 0-based leaf set up to 1-based positional', () => {
    const leaves = parseScandata(ZERO_BASED);
    expect(leaves.map((l) => l.leafNum)).toEqual([1, 2, 3, 4]);
  });

  it('proposeReadingRange over the normalized leaves is 1-based (valid for assessFidelity)', () => {
    const range = proposeReadingRange(parseScandata(ZERO_BASED));
    expect(range).toEqual({ start: 1, end: 4 });
  });

  it('leaves an already-1-based set untouched', () => {
    const oneBased = `<book><pageData>
      <page leafNum="1"><pageType>Normal</pageType></page>
      <page leafNum="2"><pageType>Normal</pageType></page>
    </pageData></book>`;
    expect(parseScandata(oneBased).map((l) => l.leafNum)).toEqual([1, 2]);
  });
});
