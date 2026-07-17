import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { persistThenParse } from '@/sourcequery/frugality';
import type { SourceConfig } from '@/sourcequery/source-config';
import type { PageResult, QuerySummary } from '@/sourcequery/types';
import { DEFAULT_GRACE } from '@/sourcequery/source-config';

/** Minimal SourceConfig fixture; only the fields frugality reads matter. */
function makeConfig(overrides: Partial<SourceConfig>): SourceConfig {
  return {
    id: 'fixture',
    baseUrl: 'https://example.test',
    buildQueryUrl: (query: string) => `https://example.test/search?q=${encodeURIComponent(query)}`,
    resultSelector: '.result',
    parseSummary: (html: string): QuerySummary => ({ count: 0, candidates: [] }),
    retention: 'persist',
    attribution: '',
    minIntervalMs: 1000,
    grace: DEFAULT_GRACE,
    ...overrides,
  };
}

function makePageResult(html: string): PageResult {
  return {
    status: 200,
    html,
    snapshotMarkdown: '# snapshot',
    errored: false,
  };
}

describe('sourcequery/frugality persistThenParse', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(path.join(tmpdir(), 'frugality-'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  describe('persist branch', () => {
    it('persists both html + md and returns a grounded persist QueryResult', async () => {
      const html = '<html><body>Showing 42 results<a class="result">A</a></body></html>';
      const candidates = [{ title: 'A', ref: 'r1' }];
      const config = makeConfig({
        id: 'papers-past',
        retention: 'persist',
        parseSummary: () => ({ count: 42, candidates }),
      });

      const result = await persistThenParse({
        pageResult: makePageResult(html),
        config,
        query: 'John Q. Public',
        url: 'https://example.test/search?q=john',
        capturedAtUtc: '2026-07-17T12:00:00.000Z',
        baseDir,
      });

      if (result.retention !== 'persist') {
        throw new Error('expected persist retention');
      }
      expect(result.source).toBe('papers-past');
      expect(result.query).toBe('John Q. Public');
      expect(result.summary.count).toBe(42);
      expect(result.captures).toHaveLength(1);

      const capture = result.captures[0];
      expect(existsSync(capture.htmlPath)).toBe(true);
      expect(existsSync(capture.snapshotPath)).toBe(true);

      // The parsed HTML came from the persisted copy.
      const persisted = await readFile(capture.htmlPath, 'utf-8');
      expect(persisted).toBe(html);
    });

    it('rejects (fail-loud) when the parsed count is not literally in the persisted HTML', async () => {
      const html = '<html><body>Showing 42 results</body></html>';
      const config = makeConfig({
        id: 'papers-past',
        retention: 'persist',
        // 99 is NOT a substring of the persisted bytes -> ungrounded.
        parseSummary: () => ({ count: 99, candidates: [] }),
      });

      await expect(
        persistThenParse({
          pageResult: makePageResult(html),
          config,
          query: 'ungrounded',
          url: 'https://example.test/search?q=x',
          capturedAtUtc: '2026-07-17T12:00:00.000Z',
          baseDir,
        }),
      ).rejects.toThrow(/99/);
    });
  });

  describe('derived-facts-only branch', () => {
    it('persists nothing and returns derived facts + attribution', async () => {
      const html = '<html><body>Trove holds 7 items</body></html>';
      const candidates = [{ title: 'T', ref: 't1' }];
      const config = makeConfig({
        id: 'trove',
        retention: 'derived-facts-only',
        attribution: 'Courtesy Trove / National Library of Australia',
        parseSummary: () => ({ count: 7, candidates }),
      });

      const result = await persistThenParse({
        pageResult: makePageResult(html),
        config,
        query: 'something',
        url: 'https://trove.nla.gov.au/search?q=x',
        capturedAtUtc: '2026-07-17T12:00:00.000Z',
        baseDir,
      });

      if (result.retention !== 'derived-facts-only') {
        throw new Error('expected derived-facts-only retention');
      }
      expect(result.source).toBe('trove');
      expect(result.summary.count).toBe(7);
      expect(result.derivedFacts).toEqual(candidates);
      expect(result.attribution).toBe('Courtesy Trove / National Library of Australia');

      // Nothing was written under baseDir: the bibliography tree never appears.
      const entries = await readdir(baseDir);
      expect(entries).toEqual([]);
      expect(existsSync(path.join(baseDir, 'bibliography'))).toBe(false);
    });
  });
});
