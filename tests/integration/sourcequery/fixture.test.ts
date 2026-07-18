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
 * NOTE: the fixture `SourceConfig`s are registered INLINE here (not via the
 * persistent registry) so US1 stays self-contained; the persistent-registry
 * SourceConfig is a later Polish task (T027).
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'node-html-parser';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { SourceQueryClient } from '@/sourcequery/source-query-client';
import { PlaywrightBrowserSession } from '@/sourcequery/browser-session-playwright';
import { registerSource, DEFAULT_GRACE } from '@/sourcequery/source-config';
import { realClock, realSleep } from '@/sourcequery/clock';
import type { Candidate, QuerySummary } from '@/sourcequery/types';
import { FakeTailscaleRunner } from '../../unit/sourcequery/fakes';

// --- Env gate: skip cleanly unless a real Chrome run is explicitly requested. ---
const RUN = process.env.RUN_SOURCEQUERY_INTEGRATION === '1';
const d = RUN ? describe : describe.skip;

/** Real Chrome launch + navigation can exceed vitest's default 5s timeout. */
const BROWSER_TIMEOUT_MS = 120_000;

const FIXTURE_LOCAL_ID = 'fixture-local';
const FIXTURE_CHALLENGE_ID = 'fixture-challenge';
const RESULT_SELECTOR = '.search-results .result';

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

/**
 * Inline fixture parser (fail-loud, no fallbacks): reads the plain-digit count
 * from `.results-count` and the title/ref of each `.result` row. Throws rather
 * than guessing when the count element, its digits, a row link, or an href is
 * missing.
 */
function parseFixtureSummary(html: string): QuerySummary {
  const root = parse(html);
  const countEl = root.querySelector('.results-count');
  if (!countEl) {
    throw new Error('fixture parseSummary: no `.results-count` element found.');
  }
  const match = countEl.text.match(/\d+/);
  if (!match) {
    throw new Error(
      `fixture parseSummary: no digit sequence in count element text "${countEl.text}".`,
    );
  }
  const count = Number.parseInt(match[0], 10);
  const rows = root.querySelectorAll(RESULT_SELECTOR);
  const candidates: Candidate[] = rows.map((row): Candidate => {
    const link = row.querySelector('a');
    if (!link) {
      throw new Error('fixture parseSummary: result row is missing its title/ref <a> link.');
    }
    const ref = link.getAttribute('href');
    if (!ref) {
      throw new Error('fixture parseSummary: result link is missing an href.');
    }
    return { title: link.text.trim(), ref };
  });
  return { count, candidates };
}

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

    // Register the fixture configs INLINE now that the ephemeral port is known.
    registerSource({
      id: FIXTURE_LOCAL_ID,
      baseUrl: `http://127.0.0.1:${port}`,
      buildQueryUrl: (query: string) =>
        `http://127.0.0.1:${port}/results?query=${encodeURIComponent(query)}`,
      resultSelector: RESULT_SELECTOR,
      parseSummary: parseFixtureSummary,
      retention: 'persist',
      attribution: '',
      minIntervalMs: 50,
      grace: DEFAULT_GRACE,
    });

    registerSource({
      id: FIXTURE_CHALLENGE_ID,
      baseUrl: `http://127.0.0.1:${port}`,
      buildQueryUrl: (query: string) =>
        `http://127.0.0.1:${port}/challenge?query=${encodeURIComponent(query)}`,
      resultSelector: RESULT_SELECTOR,
      parseSummary: parseFixtureSummary,
      retention: 'persist',
      attribution: '',
      minIntervalMs: 50,
      grace: DEFAULT_GRACE,
    });
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
});
