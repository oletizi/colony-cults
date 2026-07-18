/**
 * T018 -- env-gated end-to-end integration test for the Source Query Client
 * (spec 014, US1; quickstart.md Scenario 3, research.md R3).
 *
 * Drives the REAL `SourceQueryClient` -- with the REAL Playwright-backed
 * `PlaywrightBrowserSession` (which launches genuine installed Chrome) -- against
 * a LOCAL fixture HTTP server bound to 127.0.0.1 on an ephemeral port. It proves
 * the whole governed happy path end-to-end without touching any live/external
 * source and without mutating the host: a real browser navigates the fixture
 * results page, the raw page is persisted BEFORE parsing, the count is grounded
 * in the persisted bytes, and the fake `TailscaleRunner` records ZERO exit-node
 * switches (the happy path never escalates).
 *
 * ENV GATING: this test needs a real installed Chrome (Playwright
 * `channel: 'chrome'`), so it is gated behind `RUN_SOURCEQUERY_INTEGRATION=1`.
 * By default the suite SKIPS cleanly (CI without a browser stays green) yet the
 * file still typechecks. To run it live:
 *
 *   npx playwright install chrome
 *   RUN_SOURCEQUERY_INTEGRATION=1 npx vitest run tests/integration/sourcequery/fixture.test.ts
 *
 * Even "live", the ONLY host contacted is the local 127.0.0.1 fixture server --
 * never a real source website.
 *
 * NOTE: the fixture `SourceConfig`s are built via the shared
 * `buildFixtureSourceConfig` builder (T027, `@/sourcequery/sources/fixture`)
 * and `registerSource`d here once the ephemeral port is known -- NOT via a
 * static module-level registration -- because `buildQueryUrl` must close
 * over the runtime `baseUrl`, which only exists once the fixture server has
 * actually bound its port (see that module's header for why a static
 * registered config is impossible here).
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { SourceQueryClient } from '@/sourcequery/source-query-client';
import { PlaywrightBrowserSession } from '@/sourcequery/browser-session-playwright';
import { registerSource } from '@/sourcequery/source-config';
import { buildFixtureSourceConfig } from '@/sourcequery/sources/fixture';
import { realClock, realSleep } from '@/sourcequery/clock';
import type { ExitNode } from '@/sourcequery/types';
import { FakeTailscaleRunner } from '../../unit/sourcequery/fakes';

// --- Env gate: skip cleanly unless a real Chrome run is explicitly requested. ---
const RUN = process.env.RUN_SOURCEQUERY_INTEGRATION === '1';
const d = RUN ? describe : describe.skip;

/** Real Chrome launch + navigation can exceed vitest's default 5s timeout. */
const BROWSER_TIMEOUT_MS = 120_000;

const FIXTURE_LOCAL_ID = 'fixture-local';
const FIXTURE_CHALLENGE_ID = 'fixture-challenge';

/**
 * Single ONLINE exit node shared by the T024 escalation-path tests
 * (Scenarios 3 & 4). Its `country` ("NZ") matches `FIXTURE_CHALLENGE_ID`'s
 * `preferredGeo` above, so Scenario 3 exercises the geo-match branch of
 * `ExitNodePolicy.selectNode` rather than only the single-online-node
 * fallback.
 */
const ESCALATION_NODE: ExitNode = {
  ip: '100.64.0.9',
  hostname: 'nz-akl-01',
  country: 'NZ',
  city: 'Auckland',
  online: true,
};

/**
 * Static results page: a `.search-results` container with two `.result` rows
 * (title + link) and a plain-digit `.results-count` ("2 results"). The count is
 * PLAIN digits (no thousands separator) so verify-in-code grounding holds --
 * "2" is a literal substring of these bytes.
 */
const RESULTS_HTML = [
  '<!DOCTYPE html>',
  '<html lang="en"><head><title>Fixture results</title></head>',
  '<body>',
  '  <div class="results-count">2 results</div>',
  '  <div class="search-results">',
  '    <div class="result"><a href="/doc/1">First fixture result</a><div class="result-date">1875-01-01</div></div>',
  '    <div class="result"><a href="/doc/2">Second fixture result</a></div>',
  '  </div>',
  '</body></html>',
  '',
].join('\n');

/**
 * Static challenge page: carries the "Just a moment" WAF fingerprint and has NO
 * result container, so block-detection classifies it as a hard block (research
 * R1). Serving it lets the test prove block classification alongside the happy
 * path (both fixtures per the task).
 */
const CHALLENGE_HTML = [
  '<!DOCTYPE html>',
  '<html lang="en"><head><title>Just a moment...</title></head>',
  '<body>',
  '  <h1>Just a moment...</h1>',
  '  <p>Checking your browser before accessing the site.</p>',
  '</body></html>',
  '',
].join('\n');

d('SourceQueryClient end-to-end against a local fixture server', () => {
  let server: Server;
  let port: number;

  // Hermetic-capture scaffolding: each test runs with cwd set to a fresh temp
  // dir so persistCapture's `process.cwd()` base writes land there, never in the
  // real repo tree.
  let originalCwd: string;
  let tmpDir: string;

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? '';
      if (url.startsWith('/results')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(RESULTS_HTML);
        return;
      }
      if (url.startsWith('/challenge')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(CHALLENGE_HTML);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    const addr = server.address();
    if (addr === null || typeof addr === 'string') {
      throw new Error('fixture server did not bind to a TCP port');
    }
    port = addr.port;

    // Build + register the fixture configs now that the ephemeral port is
    // known. A static, module-level SourceConfig is impossible here --
    // `buildQueryUrl` must close over `baseUrl`, which only exists once the
    // server above has actually bound its port (see
    // `@/sourcequery/sources/fixture`'s header for the full rationale).
    const baseUrl = `http://127.0.0.1:${port}`;

    registerSource(
      buildFixtureSourceConfig({
        id: FIXTURE_LOCAL_ID,
        baseUrl,
        path: '/results',
      }),
    );

    registerSource(
      buildFixtureSourceConfig({
        id: FIXTURE_CHALLENGE_ID,
        baseUrl,
        path: '/challenge',
        // Matches CHALLENGE_NODE's country below, so selectNode's geo-match
        // branch is exercised (not just the "only one online node" fallback).
        preferredGeo: 'NZ',
      }),
    );
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = mkdtempSync(path.join(tmpdir(), 'sourcequery-fixture-'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    // Restore cwd + remove the temp capture tree even if an assertion threw.
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it(
    'persists a grounded capture from the fixture results page with no host mutation',
    async () => {
      const fakeTailscale = new FakeTailscaleRunner();
      const client = new SourceQueryClient({
        // Isolated browser profile under the per-test temp dir avoids sharing a
        // persistent profile (lock contention) and is removed by afterEach.
        browser: new PlaywrightBrowserSession({
          userDataDir: path.join(tmpDir, 'browser-profile'),
        }),
        tailscale: fakeTailscale,
        clock: realClock,
        sleep: realSleep,
      });

      const result = await client.query(FIXTURE_LOCAL_ID, 'ballarat');

      // A result page yields a QueryResult, never an escalation.
      if ('blockEvidence' in result) {
        throw new Error('expected a QueryResult, not an OperatorPermissionRequest');
      }

      // Retention + grounded count.
      expect(result.retention).toBe('persist');
      if (result.retention !== 'persist') {
        throw new Error('expected a persist-retention QueryResult');
      }
      expect(result.summary.count).toBe(2);

      // Exactly one persisted capture, whose .html + .md files exist on disk.
      expect(result.captures).toHaveLength(1);
      const capture = result.captures[0];
      expect(capture).toBeDefined();
      if (capture === undefined) {
        throw new Error('expected a persisted capture');
      }
      expect(existsSync(capture.htmlPath)).toBe(true);
      expect(existsSync(capture.snapshotPath)).toBe(true);

      // No host mutation: the happy path never switches the exit node.
      expect(fakeTailscale.setCalls).toEqual([]);
    },
    BROWSER_TIMEOUT_MS,
  );

  it(
    'classifies the fixture challenge page as a hard block and never switches the exit node',
    async () => {
      const fakeTailscale = new FakeTailscaleRunner();
      const client = new SourceQueryClient({
        browser: new PlaywrightBrowserSession({
          userDataDir: path.join(tmpDir, 'browser-profile'),
        }),
        tailscale: fakeTailscale,
        clock: realClock,
        sleep: realSleep,
      });

      // A detected hard block with no usable exit node (the fake carries none)
      // reports honestly and STOPS — it throws rather than switching (SC-003).
      await expect(client.query(FIXTURE_CHALLENGE_ID, 'ballarat')).rejects.toThrow(
        /hard block/i,
      );

      // Even on a block, the client never autonomously switches the exit node.
      expect(fakeTailscale.setCalls).toEqual([]);
    },
    BROWSER_TIMEOUT_MS,
  );

  // --- T024: escalation path (Scenarios 3 & 4, quickstart.md; FR-010/011/012/013, SC-003/SC-004). ---

  it(
    'Scenario 3: requests operator escalation on a hard block with persisted evidence and no autonomous switch',
    async () => {
      // Unlike the block-classification test above, this fake carries a usable
      // ONLINE exit node, so the client returns an OperatorPermissionRequest
      // instead of throwing (a usable node exists — FR-010/FR-011).
      const fakeTailscale = new FakeTailscaleRunner([ESCALATION_NODE]);
      const client = new SourceQueryClient({
        browser: new PlaywrightBrowserSession({
          userDataDir: path.join(tmpDir, 'browser-profile'),
        }),
        tailscale: fakeTailscale,
        clock: realClock,
        sleep: realSleep,
      });

      const result = await client.query(FIXTURE_CHALLENGE_ID, 'ballarat');

      // A hard block with a usable node yields an OperatorPermissionRequest,
      // never a QueryResult.
      if (!('proposedNode' in result)) {
        throw new Error('expected an OperatorPermissionRequest, not a QueryResult');
      }

      // Block evidence is persisted to disk BEFORE the escalation is raised
      // (FR-010) -- the file must actually exist, not just be referenced.
      expect(existsSync(result.blockEvidence.evidencePath)).toBe(true);

      // The proposed node, switch command, and minimal plan are populated so
      // the operator has everything needed to approve or decline.
      expect(result.proposedNode).toEqual(ESCALATION_NODE);
      expect(result.switchCommand).toContain(ESCALATION_NODE.hostname);
      expect(result.minimalQueryPlan.length).toBeGreaterThan(0);

      // SC-003: the client NEVER switches the exit node autonomously, even
      // though a usable node was available.
      expect(fakeTailscale.setCalls).toEqual([]);
    },
    BROWSER_TIMEOUT_MS,
  );

  it(
    'Scenario 4: on operator approval, switches once, runs the grace pass, and restores the prior exit node',
    async () => {
      // A fresh FakeTailscaleRunner per query (per the task): this one carries
      // both the usable node AND the host's prior exit node, so the restore
      // step (SC-004) has something concrete to restore to.
      const priorNode = 'prior-node';
      const fakeTailscale = new FakeTailscaleRunner([ESCALATION_NODE], priorNode);
      const client = new SourceQueryClient({
        browser: new PlaywrightBrowserSession({
          userDataDir: path.join(tmpDir, 'browser-profile'),
        }),
        tailscale: fakeTailscale,
        clock: realClock,
        sleep: realSleep,
      });

      const result = await client.query(FIXTURE_LOCAL_ID, 'ballarat', {
        approveExitNode: ESCALATION_NODE.hostname,
      });

      // Operator approval + a healthy result page yields a grounded
      // QueryResult, never an escalation request.
      if ('proposedNode' in result) {
        throw new Error('expected a grounded QueryResult, not an OperatorPermissionRequest');
      }

      expect(result.retention).toBe('persist');
      if (result.retention !== 'persist') {
        throw new Error('expected a persist-retention QueryResult');
      }
      expect(result.summary.count).toBe(2);

      // The grace run's single query is persisted to disk.
      expect(result.captures).toHaveLength(1);
      const capture = result.captures[0];
      expect(capture).toBeDefined();
      if (capture === undefined) {
        throw new Error('expected a persisted capture');
      }
      expect(existsSync(capture.htmlPath)).toBe(true);
      expect(existsSync(capture.snapshotPath)).toBe(true);

      // SC-004: exactly ONE switch (to the approved node) then the restore
      // back to the host's prior exit node -- host state ends up unchanged.
      expect(fakeTailscale.setCalls).toEqual([ESCALATION_NODE.hostname, priorNode]);
    },
    BROWSER_TIMEOUT_MS,
  );
});
