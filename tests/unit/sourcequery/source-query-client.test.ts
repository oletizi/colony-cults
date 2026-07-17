import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SourceQueryClient } from '@/sourcequery/source-query-client';
import type { SourceConfig } from '@/sourcequery/source-config';
import { DEFAULT_GRACE } from '@/sourcequery/source-config';
import type { PageResult, QuerySummary } from '@/sourcequery/types';
import { createFakeClock } from '@/sourcequery/clock';
import { FakeBrowserSession, FakeTailscaleRunner } from './fakes';

/**
 * Fixture SourceConfig factory. `buildQueryUrl` is deterministic so tests can
 * key scripted FakeBrowserSession responses by the exact URL the client
 * navigates to. `parseSummary` is injectable per case (result / empty /
 * ungrounded).
 */
function makeConfig(
  parseSummary: (html: string) => QuerySummary,
  overrides?: Partial<SourceConfig>,
): SourceConfig {
  return {
    id: 'fixture',
    baseUrl: 'https://fixture.test',
    buildQueryUrl: (query: string, page?: number) =>
      `https://fixture.test/search?q=${encodeURIComponent(query)}&page=${page ?? 1}`,
    resultSelector: 'ul.results',
    parseSummary,
    retention: 'persist',
    attribution: 'Fixture source, no attribution required',
    minIntervalMs: 1000,
    grace: DEFAULT_GRACE,
    ...overrides,
  };
}

/** Build a client whose config resolves to `config` for any source id. */
function makeClient(config: SourceConfig, browser: FakeBrowserSession) {
  const { clock, sleep } = createFakeClock(0);
  return new SourceQueryClient({
    browser,
    tailscale: new FakeTailscaleRunner(),
    clock,
    sleep,
    resolveConfig: () => config,
  });
}

describe('sourcequery/SourceQueryClient', () => {
  let originalCwd: string;
  let tempDir: string;

  // Hermetic strategy: chdir into a fresh temp dir so persistCapture /
  // persistThenParse (whose baseDir defaults to process.cwd()) write under the
  // temp dir, never into the repo tree. Restore + remove afterward.
  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = mkdtempSync(path.join(tmpdir(), 'sourcequery-client-'));
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('result page: returns a grounded persist QueryResult, persists one capture, closes the session', async () => {
    const html =
      '<html><body><ul class="results"><li>Hit</li></ul><span>3 results</span></body></html>';
    const config = makeConfig(() => ({
      count: 3,
      candidates: [{ title: 'Hit', ref: 'r1' }],
    }));
    const url = config.buildQueryUrl('gold rush', 1);
    const page: PageResult = { status: 200, html, snapshotMarkdown: '# 3 results', errored: false };
    const browser = new FakeBrowserSession({ responses: { [url]: page } });
    const client = makeClient(config, browser);

    const result = await client.query('fixture', 'gold rush');

    expect(result.retention).toBe('persist');
    expect(result.summary.count).toBe(3);
    expect(result.source).toBe('fixture');
    expect(result.query).toBe('gold rush');
    if (result.retention !== 'persist') throw new Error('expected persist retention');
    expect(result.captures).toHaveLength(1);
    expect(existsSync(result.captures[0].htmlPath)).toBe(true);
    expect(existsSync(result.captures[0].snapshotPath)).toBe(true);
    expect(browser.navigateCalls).toEqual([url]);
    expect(browser.isOpen).toBe(false);
  });

  it('legit empty page: returns count-0 persist QueryResult with one capture, no throw, session closed', async () => {
    const html = '<html><body><ul class="results"></ul><span>0 results</span></body></html>';
    const config = makeConfig(() => ({ count: 0, candidates: [] }));
    const url = config.buildQueryUrl('no such thing', 1);
    const page: PageResult = { status: 200, html, snapshotMarkdown: '# 0 results', errored: false };
    const browser = new FakeBrowserSession({ responses: { [url]: page } });
    const client = makeClient(config, browser);

    const result = await client.query('fixture', 'no such thing');

    expect(result.retention).toBe('persist');
    expect(result.summary.count).toBe(0);
    expect(result.summary.candidates).toEqual([]);
    if (result.retention !== 'persist') throw new Error('expected persist retention');
    expect(result.captures).toHaveLength(1);
    expect(existsSync(result.captures[0].htmlPath)).toBe(true);
    expect(browser.isOpen).toBe(false);
  });

  it('legit empty on a derived-facts-only source: persists NOTHING, returns derived facts + attribution (FR-009)', async () => {
    const { readdirSync } = await import('node:fs');
    const html = '<html><body><ul class="results"></ul><span>0 results</span></body></html>';
    const config = makeConfig(() => ({ count: 0, candidates: [] }), {
      retention: 'derived-facts-only',
      attribution: 'Data sourced from Fixture; reproduced under fair use.',
    });
    const url = config.buildQueryUrl('trove empty', 1);
    const page: PageResult = { status: 200, html, snapshotMarkdown: '# 0 results', errored: false };
    const browser = new FakeBrowserSession({ responses: { [url]: page } });
    const client = makeClient(config, browser);

    const result = await client.query('fixture', 'trove empty');

    expect(result.retention).toBe('derived-facts-only');
    expect(result.summary.count).toBe(0);
    if (result.retention !== 'derived-facts-only') throw new Error('expected derived-facts-only');
    expect(result.derivedFacts).toEqual([]);
    expect(result.attribution).toBe('Data sourced from Fixture; reproduced under fair use.');
    // Retention-forbidden: NO bytes written under the (temp) cwd tree.
    expect(readdirSync(tempDir)).toEqual([]);
    expect(browser.isOpen).toBe(false);
  });

  it('hard block page (HTTP 403): rejects (escalation not wired) and still closes the session', async () => {
    const config = makeConfig(() => ({ count: 0, candidates: [] }));
    const url = config.buildQueryUrl('blocked', 1);
    const page: PageResult = {
      status: 403,
      html: '<html><body>Forbidden</body></html>',
      snapshotMarkdown: '# Forbidden',
      errored: false,
    };
    const browser = new FakeBrowserSession({ responses: { [url]: page } });
    const client = makeClient(config, browser);

    await expect(client.query('fixture', 'blocked')).rejects.toThrow(/block|escalation|T020|US2/i);
    expect(browser.isOpen).toBe(false);
  });

  it('ungrounded result: rejects via Frugality grounding, session closed', async () => {
    // Container present + positive count => classified 'result', but the count's
    // digits are absent from the persisted HTML => grounding must throw.
    const html = '<html><body><ul class="results"><li>Hit</li></ul></body></html>';
    const config = makeConfig(() => ({ count: 5, candidates: [{ title: 'Hit', ref: 'r1' }] }));
    const url = config.buildQueryUrl('ungrounded', 1);
    const page: PageResult = { status: 200, html, snapshotMarkdown: '# hit', errored: false };
    const browser = new FakeBrowserSession({ responses: { [url]: page } });
    const client = makeClient(config, browser);

    await expect(client.query('fixture', 'ungrounded')).rejects.toThrow(/ungrounded/i);
    expect(browser.isOpen).toBe(false);
  });

  it('pages > 1: rejects fail-loud (multi-page walking not wired in the MVP)', async () => {
    const config = makeConfig(() => ({ count: 1, candidates: [] }));
    const browser = new FakeBrowserSession({});
    const client = makeClient(config, browser);

    await expect(client.query('fixture', 'anything', { pages: 2 })).rejects.toThrow(/multi-page|pages/i);
    // No navigation should have happened (fail before opening the session).
    expect(browser.navigateCalls).toEqual([]);
  });
});
