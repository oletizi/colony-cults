import { describe, expect, it } from 'vitest';

import { parseSourceIdentifier } from '@/browser/load/source-identifier';

describe('parseSourceIdentifier', () => {
  it('returns the ark from a Gallica catalog_url', () => {
    expect(parseSourceIdentifier('https://gallica.bnf.fr/ark:/12148/bpt6k58039518')).toBe(
      'ark:/12148/bpt6k58039518',
    );
  });

  it('returns the catalog_url itself for a non-Gallica archive (no ark)', () => {
    expect(parseSourceIdentifier('https://archive.org/details/nouvellefrancec00groogoog')).toBe(
      'https://archive.org/details/nouvellefrancec00groogoog',
    );
  });

  it('is total — never throws on a URL without an ark', () => {
    expect(() => parseSourceIdentifier('https://example.org/no-ark')).not.toThrow();
    expect(parseSourceIdentifier('https://example.org/no-ark')).toBe('https://example.org/no-ark');
  });
});
