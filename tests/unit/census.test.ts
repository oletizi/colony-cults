import { describe, it, expect } from 'vitest';
import { normalizeFrenchDate } from '@/census/date';
import { serializeCensus } from '@/census/serialize';
import { buildCensus } from '@/census/build';
import type { Census } from '@/model/census';
import type {
  GallicaClient,
  GallicaIssueRef,
  IssuesEnumeration,
} from '@/gallica/gallica-client';

describe('normalizeFrenchDate', () => {
  it('normalizes a standard "15 juillet 1879" label', () => {
    expect(normalizeFrenchDate('15 juillet 1879')).toBe('1879-07-15');
  });

  it('zero-pads single-digit days and months', () => {
    expect(normalizeFrenchDate('5 mars 1880')).toBe('1880-03-05');
  });

  it('accepts accented and unaccented month spellings', () => {
    expect(normalizeFrenchDate('15 août 1879')).toBe('1879-08-15');
    expect(normalizeFrenchDate('15 aout 1879')).toBe('1879-08-15');
    expect(normalizeFrenchDate('15 décembre 1879')).toBe('1879-12-15');
  });

  it('handles the French "1er" first-of-month ordinal', () => {
    expect(normalizeFrenchDate('1er janvier 1881')).toBe('1881-01-01');
  });

  it('normalizes every month across the fixture year', () => {
    expect(normalizeFrenchDate('15 septembre 1879')).toBe('1879-09-15');
    expect(normalizeFrenchDate('15 octobre 1879')).toBe('1879-10-15');
    expect(normalizeFrenchDate('15 novembre 1879')).toBe('1879-11-15');
  });

  it('throws (fail loud) on an unparseable label', () => {
    expect(() => normalizeFrenchDate('sometime in 1879')).toThrow(
      /cannot parse|unrecognized/,
    );
  });

  it('throws on an unknown month name', () => {
    expect(() => normalizeFrenchDate('15 smarch 1879')).toThrow(
      /unrecognized French month/,
    );
  });
});

/** A census whose issues are deliberately out of date order. */
function unorderedCensus(): Census {
  return {
    sourceId: 'PB-P001',
    gallicaArk: 'ark:/12148/cb328261098/date',
    builtAt: '2026-07-08',
    totalIssues: 3,
    issues: [
      { ark: 'c', date: '1879-09-15', label: '15 septembre 1879', pageCount: 8 },
      { ark: 'a', date: '1879-07-15', label: '15 juillet 1879', pageCount: 12 },
      { ark: 'b', date: '1879-08-15', label: '15 août 1879', pageCount: 10 },
    ],
  };
}

describe('serializeCensus', () => {
  it('is byte-identical when re-serializing identical data', () => {
    const a = serializeCensus(unorderedCensus());
    const b = serializeCensus(unorderedCensus());
    expect(a).toBe(b);
  });

  it('emits issues sorted ascending by date regardless of input order', () => {
    const json = serializeCensus(unorderedCensus());
    const parsed: unknown = JSON.parse(json);
    const dates = (parsed as Census).issues.map((issue) => issue.date);
    expect(dates).toEqual(['1879-07-15', '1879-08-15', '1879-09-15']);
  });

  it('emits keys in the fixed documented order with 2-space indent', () => {
    const json = serializeCensus(unorderedCensus());
    const topKeys = [...json.matchAll(/^ {2}"(\w+)":/gm)].map((m) => m[1]);
    expect(topKeys).toEqual([
      'sourceId',
      'gallicaArk',
      'builtAt',
      'totalIssues',
      'issues',
    ]);
    const firstIssue = json.indexOf('{', json.indexOf('"issues"'));
    const issueBlock = json.slice(firstIssue, json.indexOf('}', firstIssue));
    const issueKeys = [...issueBlock.matchAll(/"(\w+)":/g)].map((m) => m[1]);
    expect(issueKeys).toEqual(['ark', 'date', 'label', 'pageCount']);
  });

  it('ends with exactly one trailing newline', () => {
    const json = serializeCensus(unorderedCensus());
    expect(json.endsWith('}\n')).toBe(true);
    expect(json.endsWith('}\n\n')).toBe(false);
  });
});

/** A fake GallicaClient (test-only) returning controlled, out-of-order data. */
function fakeClient(): GallicaClient {
  const enumeration: IssuesEnumeration = {
    totalIssues: 3,
    years: ['1879'],
    issues: [
      { ark: 'c', label: '15 septembre 1879' },
      { ark: 'a', label: '15 juillet 1879' },
      { ark: 'b', label: '15 août 1879' },
    ],
  };
  const pageCounts: Record<string, number> = { a: 12, b: 10, c: 8 };
  return {
    years: () =>
      Promise.resolve({ totalIssues: 3, years: ['1879'] }),
    issuesForYear: (): Promise<GallicaIssueRef[]> =>
      Promise.resolve(enumeration.issues),
    issues: () => Promise.resolve(enumeration),
    pagination: (issueArk) => {
      const count = pageCounts[issueArk];
      if (count === undefined) {
        throw new Error(`no page count for ${issueArk}`);
      }
      return Promise.resolve(count);
    },
  };
}

describe('buildCensus', () => {
  it('normalizes dates, resolves page counts, and sorts ascending', async () => {
    const census = await buildCensus(
      'ark:/12148/cb328261098/date',
      fakeClient(),
      'PB-P001',
      '2026-07-08',
    );

    expect(census.sourceId).toBe('PB-P001');
    expect(census.totalIssues).toBe(3);
    expect(census.builtAt).toBe('2026-07-08');
    expect(census.issues).toEqual([
      { ark: 'a', date: '1879-07-15', label: '15 juillet 1879', pageCount: 12 },
      { ark: 'b', date: '1879-08-15', label: '15 août 1879', pageCount: 10 },
      { ark: 'c', date: '1879-09-15', label: '15 septembre 1879', pageCount: 8 },
    ]);
  });

  it('fails loud when builtAt is blank (no magic default)', async () => {
    await expect(
      buildCensus('cb328261098', fakeClient(), 'PB-P001', '   '),
    ).rejects.toThrow(/builtAt is required/);
  });
});
