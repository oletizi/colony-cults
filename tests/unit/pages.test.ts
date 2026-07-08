import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { splitPages, assemble } from '@/translate/pages';

describe('pages', () => {
  describe('splitPages', () => {
    it('splits text on form-feed character and drops trailing empty element', () => {
      const fixtureText = readFileSync(
        resolve(__dirname, '../fixtures/issue-sample.txt'),
        'utf-8',
      );

      const pages = splitPages(fixtureText);

      // fixture has 2 form-feeds, so 3 pages
      expect(pages).toHaveLength(3);
    });

    it('counts pages as (number of \\f) + 1 when text does not end with \\f', () => {
      const text = 'page1\fpage2\fpage3';
      const pages = splitPages(text);

      expect(pages).toHaveLength(3);
    });

    it('drops trailing empty element when text ends with \\f', () => {
      const text = 'page1\fpage2\fpage3\f';
      const pages = splitPages(text);

      // should be 3, not 4, because trailing empty element is dropped
      expect(pages).toHaveLength(3);
      expect(pages).toEqual(['page1', 'page2', 'page3']);
    });

    it('preserves page content exactly without trimming', () => {
      const text = 'page1 \fpage2\fpage3';
      const pages = splitPages(text);

      expect(pages[0]).toBe('page1 ');
    });

    it('handles single page with no form-feeds', () => {
      const text = 'single page content';
      const pages = splitPages(text);

      expect(pages).toHaveLength(1);
      expect(pages[0]).toBe('single page content');
    });
  });

  describe('assemble', () => {
    it('joins pages with form-feed character', () => {
      const pages = ['page1', 'page2', 'page3'];
      const result = assemble(pages);

      expect(result).toBe('page1\fpage2\fpage3');
    });

    it('reconstructs original text from splitPages result', () => {
      const fixtureText = readFileSync(
        resolve(__dirname, '../fixtures/issue-sample.txt'),
        'utf-8',
      );

      const pages = splitPages(fixtureText);
      const reconstructed = assemble(pages);

      expect(reconstructed).toBe(fixtureText);
    });

    it('handles single page without adding form-feeds', () => {
      const pages = ['single page'];
      const result = assemble(pages);

      expect(result).toBe('single page');
    });

    it('handles empty array', () => {
      const pages: string[] = [];
      const result = assemble(pages);

      expect(result).toBe('');
    });
  });

  describe('round-trip property', () => {
    it('splitPages(assemble(pages)) deep-equals pages', () => {
      const pages = ['a', 'b', 'c'];
      const assembled = assemble(pages);
      const split = splitPages(assembled);

      expect(split).toEqual(pages);
    });

    it('works with pages containing form-feeds in the fixture', () => {
      const fixtureText = readFileSync(
        resolve(__dirname, '../fixtures/issue-sample.txt'),
        'utf-8',
      );

      const original = splitPages(fixtureText);
      const reassembled = assemble(original);
      const resplit = splitPages(reassembled);

      expect(resplit).toEqual(original);
    });
  });
});
