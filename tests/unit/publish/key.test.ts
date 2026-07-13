import { describe, it, expect } from 'vitest';
import {
  versionedKey,
  legacyFlatKey,
  cdnUrl,
  resolveCdnBase,
  PublicationVariant,
} from '@/pdf/publish/key';

describe('key/url builders', () => {
  describe('versionedKey', () => {
    it('builds versioned key for english-only variant', () => {
      const result = versionedKey(
        'english-only',
        'PB-P001',
        '1879-07-15_x',
        '3b8b1fd6',
      );
      expect(result).toBe(
        'editions/english-only/PB-P001/1879-07-15_x__3b8b1fd6.pdf',
      );
    });

    it('builds versioned key for parallel variant', () => {
      const result = versionedKey(
        'parallel',
        'PB-P002',
        '1880-01-01_y',
        'abc12345',
      );
      expect(result).toBe('editions/parallel/PB-P002/1880-01-01_y__abc12345.pdf');
    });
  });

  describe('legacyFlatKey', () => {
    it('builds legacy-flat key with english-only variant', () => {
      const result = legacyFlatKey('PB-P001', '1879-07-15_x');
      expect(result).toBe('editions/english-only/PB-P001/1879-07-15_x.pdf');
    });

    it('builds legacy-flat key for another source', () => {
      const result = legacyFlatKey('PB-P099', '1895-03-20_z');
      expect(result).toBe('editions/english-only/PB-P099/1895-03-20_z.pdf');
    });
  });

  describe('cdnUrl', () => {
    it('joins base and key with single slash', () => {
      const base = 'https://colony-cults-cdn.oletizi.workers.dev';
      const key = 'editions/english-only/PB-P001/1879-07-15_x__3b8b1fd6.pdf';
      const result = cdnUrl(base, key);
      expect(result).toBe(
        'https://colony-cults-cdn.oletizi.workers.dev/editions/english-only/PB-P001/1879-07-15_x__3b8b1fd6.pdf',
      );
    });

    it('strips trailing slash from base', () => {
      const base = 'https://colony-cults-cdn.oletizi.workers.dev/';
      const key = 'editions/english-only/PB-P001/1879-07-15_x__3b8b1fd6.pdf';
      const result = cdnUrl(base, key);
      expect(result).toBe(
        'https://colony-cults-cdn.oletizi.workers.dev/editions/english-only/PB-P001/1879-07-15_x__3b8b1fd6.pdf',
      );
    });

    it('strips leading slash from key', () => {
      const base = 'https://colony-cults-cdn.oletizi.workers.dev';
      const key = '/editions/english-only/PB-P001/1879-07-15_x__3b8b1fd6.pdf';
      const result = cdnUrl(base, key);
      expect(result).toBe(
        'https://colony-cults-cdn.oletizi.workers.dev/editions/english-only/PB-P001/1879-07-15_x__3b8b1fd6.pdf',
      );
    });

    it('handles both trailing and leading slashes', () => {
      const base = 'https://colony-cults-cdn.oletizi.workers.dev/';
      const key = '/editions/english-only/PB-P001/1879-07-15_x__3b8b1fd6.pdf';
      const result = cdnUrl(base, key);
      expect(result).toBe(
        'https://colony-cults-cdn.oletizi.workers.dev/editions/english-only/PB-P001/1879-07-15_x__3b8b1fd6.pdf',
      );
    });

    it('produces exactly one slash between base and key', () => {
      const base = 'https://example.com///';
      const key = '///path/to/file.pdf';
      const result = cdnUrl(base, key);
      expect(result).toBe('https://example.com/path/to/file.pdf');
    });
  });

  describe('url === cdnBase + "/" + key invariant', () => {
    it('holds for a versioned key', () => {
      const variant: PublicationVariant = 'english-only';
      const sourceId = 'PB-P001';
      const issueId = '1879-07-15_x';
      const snapshotShort = '3b8b1fd6';
      const cdnBase = 'https://colony-cults-cdn.oletizi.workers.dev';

      const key = versionedKey(variant, sourceId, issueId, snapshotShort);
      const url = cdnUrl(cdnBase, key);

      expect(url).toBe(cdnBase + '/' + key);
    });
  });

  describe('resolveCdnBase', () => {
    it('returns env value when CORPUS_CDN_BASE is set', () => {
      const env = { CORPUS_CDN_BASE: 'https://colony-cults-cdn.example.com' };
      const result = resolveCdnBase(env);
      expect(result).toBe('https://colony-cults-cdn.example.com');
    });

    it('trims whitespace from env value', () => {
      const env = { CORPUS_CDN_BASE: '  https://colony-cults-cdn.example.com  ' };
      const result = resolveCdnBase(env);
      expect(result).toBe('https://colony-cults-cdn.example.com');
    });

    it('throws when CORPUS_CDN_BASE is unset', () => {
      const env = {};
      expect(() => resolveCdnBase(env)).toThrow(
        /CORPUS_CDN_BASE.*is not set/,
      );
    });

    it('throws when CORPUS_CDN_BASE is empty string', () => {
      const env = { CORPUS_CDN_BASE: '' };
      expect(() => resolveCdnBase(env)).toThrow(
        /CORPUS_CDN_BASE.*is not set/,
      );
    });

    it('throws when CORPUS_CDN_BASE is only whitespace', () => {
      const env = { CORPUS_CDN_BASE: '   ' };
      expect(() => resolveCdnBase(env)).toThrow(
        /CORPUS_CDN_BASE.*is not set/,
      );
    });
  });
});
