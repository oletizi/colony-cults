import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { groundedResultFromCapture, derivedFactsResult } from '@/sourcequery/frugality';
import { persistCapture } from '@/sourcequery/persistence';
import type { SourceConfig } from '@/sourcequery/source-config';
import type { PageResult, PersistedCapture, QuerySummary } from '@/sourcequery/types';
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

describe('sourcequery/frugality', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(path.join(tmpdir(), 'frugality-'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  /**
   * Persist the raw page the way the client does (persist-before-analysis) so a
   * {@link PersistedCapture} exists on disk for groundedResultFromCapture to read.
   */
  async function persist(html: string, source: string, query: string): Promise<PersistedCapture> {
    return await persistCapture({
      source,
      query,
      url: `https://example.test/search?q=${encodeURIComponent(query)}`,
      html,
      snapshotMarkdown: '# snapshot',
      capturedAtUtc: '2026-07-17T12:00:00.000Z',
      baseDir,
    });
  }

  describe('groundedResultFromCapture (persist branch, no double-write)', () => {
    it('grounds + returns a persist QueryResult from an already-persisted capture', async () => {
      const html = '<html><body>Showing 42 results<a class="result">A</a></body></html>';
      const candidates = [{ title: 'A', ref: 'r1' }];
      const config = makeConfig({
        id: 'papers-past',
        retention: 'persist',
        parseSummary: () => ({ count: 42, candidates }),
      });
      const capture = await persist(html, 'papers-past', 'John Q. Public');

      const result = await groundedResultFromCapture({ capture, config, query: 'John Q. Public' });

      if (result.retention !== 'persist') {
        throw new Error('expected persist retention');
      }
      expect(result.source).toBe('papers-past');
      expect(result.query).toBe('John Q. Public');
      expect(result.summary.count).toBe(42);
      expect(result.captures).toHaveLength(1);
      expect(result.captures[0]).toBe(capture);

      // The capture (written by persistCapture) exists on disk; the parse read
      // the persisted copy back.
      expect(existsSync(capture.htmlPath)).toBe(true);
      expect(existsSync(capture.snapshotPath)).toBe(true);
      const persisted = await readFile(capture.htmlPath, 'utf-8');
      expect(persisted).toBe(html);
    });

    it('grounds a plain-digit count parsed from a thousands-separated HTML form (12,345 -> 12345)', async () => {
      // The persisted bytes carry the separated form "12,345"; the parser yields
      // the plain-digit 12345. Separator-tolerant grounding must accept this.
      const html = '<html><body>About 12,345 results found<a class="result">A</a></body></html>';
      const config = makeConfig({
        id: 'papers-past',
        retention: 'persist',
        parseSummary: () => ({ count: 12345, candidates: [{ title: 'A', ref: 'r1' }] }),
      });
      const capture = await persist(html, 'papers-past', 'separated');

      const result = await groundedResultFromCapture({ capture, config, query: 'separated' });

      if (result.retention !== 'persist') {
        throw new Error('expected persist retention');
      }
      expect(result.summary.count).toBe(12345);
    });

    it('rejects (fail-loud) when the parsed count is not literally in the persisted HTML', async () => {
      const html = '<html><body>Showing 42 results</body></html>';
      const config = makeConfig({
        id: 'papers-past',
        retention: 'persist',
        // 99 is NOT a substring of the persisted bytes -> ungrounded.
        parseSummary: () => ({ count: 99, candidates: [] }),
      });
      const capture = await persist(html, 'papers-past', 'ungrounded');

      await expect(
        groundedResultFromCapture({ capture, config, query: 'ungrounded' }),
      ).rejects.toThrow(/99/);
    });
  });

  describe('derivedFactsResult (derived-facts-only branch, persists nothing)', () => {
    it('persists nothing and returns derived facts + attribution', async () => {
      const html = '<html><body>Trove holds 7 items</body></html>';
      const candidates = [{ title: 'T', ref: 't1' }];
      const config = makeConfig({
        id: 'trove',
        retention: 'derived-facts-only',
        attribution: 'Courtesy Trove / National Library of Australia',
        parseSummary: () => ({ count: 7, candidates }),
      });

      const result = derivedFactsResult({
        pageResult: makePageResult(html),
        config,
        query: 'something',
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

    it('grounds a separated count against the in-memory HTML (12,345 -> 12345, no throw)', () => {
      const html = '<html><body>Trove holds 12,345 items</body></html>';
      const config = makeConfig({
        id: 'trove',
        retention: 'derived-facts-only',
        attribution: 'Courtesy Trove / National Library of Australia',
        parseSummary: () => ({ count: 12345, candidates: [] }),
      });

      const result = derivedFactsResult({
        pageResult: makePageResult(html),
        config,
        query: 'separated',
      });

      expect(result.summary.count).toBe(12345);
    });

    it('rejects (fail-loud) when the count is ungrounded in the in-memory HTML', () => {
      // Symmetric to the persist ungrounded test: 99 is absent from the fetched
      // bytes, so the derived-facts-only branch must THROW (not silently return an
      // ungrounded fact) even though nothing is persisted.
      const html = '<html><body>Trove holds 7 items</body></html>';
      const config = makeConfig({
        id: 'trove',
        retention: 'derived-facts-only',
        attribution: 'Courtesy Trove / National Library of Australia',
        parseSummary: () => ({ count: 99, candidates: [] }),
      });

      expect(() =>
        derivedFactsResult({ pageResult: makePageResult(html), config, query: 'ungrounded' }),
      ).toThrow(/ungrounded/i);
    });
  });
});
