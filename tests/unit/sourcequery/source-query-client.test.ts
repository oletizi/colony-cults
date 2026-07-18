import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SourceQueryClient } from '@/sourcequery/source-query-client';
import type { SourceConfig } from '@/sourcequery/source-config';
import { DEFAULT_GRACE } from '@/sourcequery/source-config';
import type {
  ExitNode,
  OperatorPermissionRequest,
  PageResult,
  QueryResult,
  QuerySummary,
} from '@/sourcequery/types';
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

/**
 * Build a client whose config resolves to `config` for any source id. An
 * optional node-carrying {@link FakeTailscaleRunner} lets block-path tests
 * drive exit-node enumeration/selection; the default is an empty runner (the
 * happy-path tests never touch it).
 */
function makeClient(
  config: SourceConfig,
  browser: FakeBrowserSession,
  tailscale: FakeTailscaleRunner = new FakeTailscaleRunner(),
) {
  const { clock, sleep } = createFakeClock(0);
  return new SourceQueryClient({
    browser,
    tailscale,
    clock,
    sleep,
    resolveConfig: () => config,
  });
}

function isPermissionRequest(
  value: QueryResult | OperatorPermissionRequest,
): value is OperatorPermissionRequest {
  return 'blockEvidence' in value && 'proposedNode' in value && 'switchCommand' in value;
}

/** Narrow a query outcome to a {@link QueryResult}, failing loud otherwise. */
function asQueryResult(value: QueryResult | OperatorPermissionRequest): QueryResult {
  if (isPermissionRequest(value)) {
    throw new Error('expected a QueryResult, got an OperatorPermissionRequest');
  }
  return value;
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

    const result = asQueryResult(await client.query('fixture', 'gold rush'));

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

    const result = asQueryResult(await client.query('fixture', 'no such thing'));

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

    const result = asQueryResult(await client.query('fixture', 'trove empty'));

    expect(result.retention).toBe('derived-facts-only');
    expect(result.summary.count).toBe(0);
    if (result.retention !== 'derived-facts-only') throw new Error('expected derived-facts-only');
    expect(result.derivedFacts).toEqual([]);
    expect(result.attribution).toBe('Data sourced from Fixture; reproduced under fair use.');
    // Retention-forbidden: NO bytes written under the (temp) cwd tree.
    expect(readdirSync(tempDir)).toEqual([]);
    expect(browser.isOpen).toBe(false);
  });

  it('non-empty result on a derived-facts-only source: persists NOTHING, returns derived facts + attribution (FR-009)', async () => {
    const { readdirSync } = await import('node:fs');
    const html =
      '<html><body><ul class="results"><li>Hit</li></ul><span>2 results</span></body></html>';
    const candidates = [
      { title: 'Hit One', ref: 'r1' },
      { title: 'Hit Two', ref: 'r2' },
    ];
    const config = makeConfig(() => ({ count: 2, candidates }), {
      retention: 'derived-facts-only',
      attribution: 'Data sourced from Fixture; reproduced under fair use.',
    });
    const url = config.buildQueryUrl('trove hits', 1);
    const page: PageResult = { status: 200, html, snapshotMarkdown: '# 2 results', errored: false };
    const browser = new FakeBrowserSession({ responses: { [url]: page } });
    const client = makeClient(config, browser);

    const result = asQueryResult(await client.query('fixture', 'trove hits'));

    expect(result.retention).toBe('derived-facts-only');
    expect(result.summary.count).toBe(2);
    if (result.retention !== 'derived-facts-only') throw new Error('expected derived-facts-only');
    expect(result.derivedFacts).toEqual(candidates);
    expect(result.attribution).toBe('Data sourced from Fixture; reproduced under fair use.');
    // Retention-forbidden: NO bytes written under the (temp) cwd tree, even
    // though the result was non-empty (grounded facts must not leak to disk).
    expect(readdirSync(tempDir)).toEqual([]);
    expect(browser.isOpen).toBe(false);
  });

  const makeExitNode = (overrides: Partial<ExitNode>): ExitNode => ({
    ip: '100.64.0.1',
    hostname: 'node-default',
    country: 'New Zealand',
    city: 'Wellington',
    online: true,
    ...overrides,
  });

  it('hard block (HTTP 403) with a usable node: persists evidence, RETURNS an OperatorPermissionRequest, NEVER switches, closes the session', async () => {
    const config = makeConfig(() => ({ count: 0, candidates: [] }), {
      id: 'fixture',
      preferredGeo: 'New Zealand',
    });
    const url = config.buildQueryUrl('blocked', 1);
    const page: PageResult = {
      status: 403,
      html: '<html><body>Forbidden</body></html>',
      snapshotMarkdown: '# Forbidden',
      errored: false,
    };
    const browser = new FakeBrowserSession({ responses: { [url]: page } });
    const nzNode = makeExitNode({ hostname: 'nz-1', country: 'New Zealand', online: true });
    const usNode = makeExitNode({ hostname: 'us-1', country: 'United States', online: true });
    const runner = new FakeTailscaleRunner([usNode, nzNode], 'prior-node.example.ts.net');
    const client = makeClient(config, browser, runner);

    const outcome = await client.query('fixture', 'blocked');

    if (!isPermissionRequest(outcome)) {
      throw new Error('expected an OperatorPermissionRequest');
    }
    expect(outcome.source).toBe('fixture');
    // Block evidence persisted FIRST, and its file exists on disk.
    expect(outcome.blockEvidence.kind).toBe('status');
    expect(outcome.blockEvidence.detail).toBe('HTTP 403');
    expect(existsSync(outcome.blockEvidence.evidencePath)).toBe(true);
    // Geo-selected the NZ node (preferredGeo match).
    expect(outcome.proposedNode.hostname).toBe('nz-1');
    expect(outcome.currentOrigin).toBe('prior-node.example.ts.net');
    expect(outcome.switchCommand).toBe('tailscale set --exit-node=nz-1');
    expect(outcome.minimalQueryPlan).toEqual([url]);
    expect(outcome.hostImpactWarning.length).toBeGreaterThan(0);
    // SC-003: NO autonomous exit-node switch happened.
    expect(runner.setCalls).toEqual([]);
    expect(browser.isOpen).toBe(false);
  });

  it('hard block with NO usable exit node: rejects, persists evidence, never switches, closes the session', async () => {
    const config = makeConfig(() => ({ count: 0, candidates: [] }));
    const url = config.buildQueryUrl('blocked', 1);
    const page: PageResult = {
      status: 403,
      html: '<html><body>Forbidden</body></html>',
      snapshotMarkdown: '# Forbidden',
      errored: false,
    };
    const browser = new FakeBrowserSession({ responses: { [url]: page } });
    // Only offline nodes => selectNode returns null.
    const runner = new FakeTailscaleRunner([makeExitNode({ hostname: 'off-1', online: false })]);
    const client = makeClient(config, browser, runner);

    await expect(client.query('fixture', 'blocked')).rejects.toThrow(/no usable exit node/i);
    // Evidence was still persisted before the honest stop.
    expect(existsSync(path.join(tempDir, 'bibliography', 'repository-responses', 'fixture'))).toBe(true);
    expect(runner.setCalls).toEqual([]);
    expect(browser.isOpen).toBe(false);
  });

  it('hard block while Tailscale is unavailable: rejects honestly, never switches, closes the session', async () => {
    const config = makeConfig(() => ({ count: 0, candidates: [] }));
    const url = config.buildQueryUrl('blocked', 1);
    const page: PageResult = {
      status: 403,
      html: '<html><body>Forbidden</body></html>',
      snapshotMarkdown: '# Forbidden',
      errored: false,
    };
    const browser = new FakeBrowserSession({ responses: { [url]: page } });
    const runner = new FakeTailscaleRunner();
    // Simulate Tailscale unavailable: enumeration rejects.
    runner.listExitNodes = async () => {
      throw new Error('tailscale CLI not found');
    };
    const client = makeClient(config, browser, runner);

    await expect(client.query('fixture', 'blocked')).rejects.toThrow(/tailscale/i);
    expect(runner.setCalls).toEqual([]);
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

  describe('approved exit-node pass (FR-012/013/014, SC-004)', () => {
    it('performs the ONE switch, runs the grace query, returns a grounded result, restores host, closes the session', async () => {
      // The switched-origin page renders a grounded result.
      const html =
        '<html><body><ul class="results"><li>Hit</li></ul><span>3 results</span></body></html>';
      const config = makeConfig(() => ({ count: 3, candidates: [{ title: 'Hit', ref: 'r1' }] }), {
        grace: { ...DEFAULT_GRACE, maxRequests: 3, maxWindowMs: 10_000_000 },
      });
      const url = config.buildQueryUrl('gold rush', 1);
      const page: PageResult = { status: 200, html, snapshotMarkdown: '# 3 results', errored: false };
      const browser = new FakeBrowserSession({ responses: { [url]: page } });
      const nzNode = makeExitNode({ hostname: 'nz-1', ip: '100.64.0.9', country: 'New Zealand' });
      const runner = new FakeTailscaleRunner([nzNode], 'prior-node.example.ts.net');
      const client = makeClient(config, browser, runner);

      const result = asQueryResult(
        await client.query('fixture', 'gold rush', { approveExitNode: 'nz-1' }),
      );

      expect(result.summary.count).toBe(3);
      if (result.retention !== 'persist') throw new Error('expected persist retention');
      expect(result.captures).toHaveLength(1);
      expect(existsSync(result.captures[0].htmlPath)).toBe(true);
      // Exactly two host mutations: the switch, then the restore (SC-004).
      expect(runner.setCalls).toHaveLength(2);
      expect(runner.setCalls[0]).toBe('nz-1');
      expect(runner.setCalls[1]).toBe('prior-node.example.ts.net');
      // Grace run does not use PolitenessPolicy; it navigates the single planned url.
      expect(browser.navigateCalls).toEqual([url]);
      expect(browser.isOpen).toBe(false);
    });

    it('approved node not found among enumerated nodes: rejects fail-loud, closes the session', async () => {
      const config = makeConfig(() => ({ count: 1, candidates: [] }));
      const browser = new FakeBrowserSession({});
      const nzNode = makeExitNode({ hostname: 'nz-1', ip: '100.64.0.9' });
      const runner = new FakeTailscaleRunner([nzNode], null);
      const client = makeClient(config, browser, runner);

      await expect(
        client.query('fixture', 'gold rush', { approveExitNode: 'does-not-exist' }),
      ).rejects.toThrow(/not found among enumerated nodes/i);
      // No switch happened; the session was still closed.
      expect(runner.setCalls).toEqual([]);
      expect(browser.isOpen).toBe(false);
    });

    it('burned node (grace-run page still blocked): rejects AND host is restored (setCalls[1] present), session closed', async () => {
      const config = makeConfig(() => ({ count: 0, candidates: [] }));
      const url = config.buildQueryUrl('blocked', 1);
      // The switched node is ALSO blocked — a 403 on the grace navigation.
      const page: PageResult = {
        status: 403,
        html: '<html><body>Forbidden</body></html>',
        snapshotMarkdown: '# Forbidden',
        errored: false,
      };
      const browser = new FakeBrowserSession({ responses: { [url]: page } });
      const nzNode = makeExitNode({ hostname: 'nz-1', ip: '100.64.0.9' });
      const runner = new FakeTailscaleRunner([nzNode], 'prior-node.example.ts.net');
      const client = makeClient(config, browser, runner);

      await expect(
        client.query('fixture', 'blocked', { approveExitNode: 'nz-1' }),
      ).rejects.toThrow(/burned node/i);
      // Switch happened AND host was restored on the abort path (SC-004).
      expect(runner.setCalls).toHaveLength(2);
      expect(runner.setCalls[0]).toBe('nz-1');
      expect(runner.setCalls[1]).toBe('prior-node.example.ts.net');
      expect(browser.isOpen).toBe(false);
    });
  });
});
