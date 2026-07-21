/**
 * T021 -- ENV-GATED integration test for the Papers Past acquisition adapter
 * (specs/015-papers-past-acquisition, SC-005).
 *
 * This suite is env-gated behind `RUN_PAPERS_PAST_ACQUIRE=1`. It performs a
 * REAL external fetch against the Papers Past image CDN and (scenario b) a
 * REAL end-to-end acquire that writes to the real B2 object store and
 * rewrites `bibliography/sources/PB-P061.yml` on disk -- so it is an
 * OPERATOR-RUN ACCEPTANCE test, never part of the hermetic unit suite. In a
 * normal `vitest run` (no `RUN_PAPERS_PAST_ACQUIRE`), the whole describe
 * block is skipped -- not failed -- via `describe.skipIf`, so ZERO network
 * calls happen and the suite reports 0 failures / skipped.
 *
 * To run it live:
 *
 *   npx playwright install chrome
 *   export COLONY_ARCHIVE_ROOT=<path to your private per-session archive worktree>
 *   # + B2 env vars (bucket/endpoint/region) and a readable B2 credentials
 *   #   file, per resolveObjectStoreConfig (@/archive/b2-config)
 *   RUN_PAPERS_PAST_ACQUIRE=1 npx vitest run tests/integration/repository/papers-past/acquire.test.ts
 *
 * Scenario (a) (image-CDN reachability, research R1 CONFIRMED) derives one
 * real `/imageserver/...` GIF URL by mechanically parsing the persisted
 * fixture `tests/unit/repository/papers-past/fixtures/de-rays-article.html`
 * and fetches it INSIDE the WAF-cleared browser context via
 * `PlaywrightBrowserSession.fetchBytes` (open + navigate the article page
 * first, same origin) -- asserting the bytes carry the GIF87a/GIF89a magic.
 * R1 is CONFIRMED (a live `bib acquire`): the `/imageserver/` CDN is
 * Incapsula-WAF-gated too, so the stateless `HttpClient` byte fetch FAILS
 * ("fetch failed"); the browser byte-fetch is now the adapter's mechanism.
 * A non-image/challenge response FAILS loud (never a silent pass).
 *
 * Scenario (b) (live end-to-end acquire) drives the REAL `runAcquireCli`
 * for the de Rays member (`PB-P061`, `bibliography/sources/PB-P061.yml`),
 * asserting page-master GIF asset(s) are recorded, then reruns it and
 * asserts idempotency (the recorded assets are byte-for-byte unchanged --
 * the adapter's head-then-put never re-PUTs an already-present checksum).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

import { parseArticle } from '@/repository/papers-past/parse';
import { PlaywrightBrowserSession } from '@/sourcequery/browser-session-playwright';
import { runAcquireCli } from '@/cli/bib-sourcegroup-acquire';
import { resolveRepoRoot, sourcesDirOf } from '@/cli/bib-sourcegroup-paths';
import { loadAllSources } from '@/bibliography/load';
import { resolveObjectStoreConfig } from '@/archive/b2-config';
import type { AcquiredAsset } from '@/model/acquired-asset';

/** Env gate: skip cleanly (0 network calls) unless a live run is explicitly requested. */
const RUN_PAPERS_PAST_ACQUIRE = process.env.RUN_PAPERS_PAST_ACQUIRE === '1';

const PAPERS_PAST_HOST = 'https://paperspast.natlib.govt.nz';

const FIXTURE_HTML_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  'unit',
  'repository',
  'papers-past',
  'fixtures',
  'de-rays-article.html',
);
const FIXTURE_URL = `${PAPERS_PAST_HOST}/newspapers/HNS18840103.2.19.3`;

/** The `papers-past` member under acceptance test (source id read from `bibliography/sources/PB-P061.yml`). */
const DE_RAYS_SOURCE_ID = 'PB-P061';

/** Real browser launch / real network round trips can exceed vitest's default 5s timeout. */
const LIVE_TIMEOUT_MS = 180_000;

/** Is `bytes` a GIF (magic number `GIF87a` / `GIF89a`)? Mirrors the adapter's own image-validity guard. */
function isGifMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 6 &&
    bytes[0] === 0x47 && // G
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x38 && // 8
    (bytes[4] === 0x37 || bytes[4] === 0x39) && // 7 | 9
    bytes[5] === 0x61 // a
  );
}

describe.skipIf(!RUN_PAPERS_PAST_ACQUIRE)('Papers Past adapter (live, operator-run acceptance)', () => {
  it(
    '(a) fetches a real /imageserver/ GIF URL via the WAF-cleared browser byte-fetch and validates GIF magic bytes (research R1 CONFIRMED)',
    async () => {
      const html = readFileSync(FIXTURE_HTML_PATH, 'utf-8');
      const parsed = parseArticle(html, FIXTURE_URL);
      const first = parsed.imageLocators[0];
      if (first === undefined) {
        throw new Error(
          'de-rays-article.html fixture parsed to zero image locators -- cannot derive a /imageserver/ URL.',
        );
      }
      const url = first.url.startsWith('http') ? first.url : `${PAPERS_PAST_HOST}${first.url}`;

      // R1 CONFIRMED (live `bib acquire`): the `/imageserver/` CDN is
      // Incapsula-WAF-gated too, so a stateless `HttpClient` GET FAILS
      // ("fetch failed"). Fetch the bytes INSIDE the WAF-cleared browser
      // context -- open + navigate the article page first (same origin), then
      // `fetchBytes` the image URL -- the governed mechanism the adapter uses.
      const browser = new PlaywrightBrowserSession();
      await browser.open();
      try {
        await browser.navigate(FIXTURE_URL);
        const bytes = await browser.fetchBytes(url);

        if (!isGifMagic(bytes)) {
          throw new Error(
            `Papers Past image-CDN check FAILED: the WAF-cleared browser fetchBytes(${url}) did ` +
              'not return GIF bytes (no GIF87a/GIF89a magic in the first 6 bytes) -- likely a ' +
              'non-image/challenge response. This is NOT a silent pass.',
          );
        }
        expect(isGifMagic(bytes)).toBe(true);
      } finally {
        await browser.close();
      }
    },
    LIVE_TIMEOUT_MS,
  );

  it(
    '(b) live end-to-end acquire records page-master GIF asset(s) and is idempotent on rerun',
    async () => {
      const archiveRoot = process.env.COLONY_ARCHIVE_ROOT;
      if (archiveRoot === undefined || archiveRoot.trim() === '') {
        throw new Error(
          'RUN_PAPERS_PAST_ACQUIRE=1 live acquire requires COLONY_ARCHIVE_ROOT (a private per-session ' +
            'archive worktree) -- configure COLONY_ARCHIVE_ROOT + B2 before running this suite.',
        );
      }
      try {
        resolveObjectStoreConfig();
      } catch (cause) {
        throw new Error(
          'RUN_PAPERS_PAST_ACQUIRE=1 live acquire requires B2 object-store config (bucket/endpoint/region ' +
            'env vars plus a readable B2 credentials file) -- configure COLONY_ARCHIVE_ROOT + B2 before ' +
            `running this suite. Underlying error: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }

      const repoRoot = resolveRepoRoot();
      const sourcesDir = sourcesDirOf(repoRoot);

      const exitFirst = await runAcquireCli([DE_RAYS_SOURCE_ID]);
      expect(exitFirst).toBe(0);

      const afterFirst = loadAllSources(sourcesDir).find(
        (entry) => entry.source.sourceId === DE_RAYS_SOURCE_ID,
      );
      if (afterFirst === undefined) {
        throw new Error(`bibliography/sources/${DE_RAYS_SOURCE_ID}.yml did not load after acquire.`);
      }
      const recordFirst = afterFirst.records.find((record) =>
        (record.identifiers ?? []).some((identifier) => identifier.type === 'papers-past'),
      );
      if (recordFirst === undefined) {
        throw new Error(`${DE_RAYS_SOURCE_ID}'s Papers Past repositoryRecord was not found after acquire.`);
      }
      const assetsFirst: AcquiredAsset[] = recordFirst.assets ?? [];
      expect(assetsFirst.length).toBeGreaterThan(0);
      for (const asset of assetsFirst) {
        expect(asset.role).toBe('page-master');
        expect(asset.mediaType).toBe('image/gif');
      }

      // Rerun: idempotency (no duplicate object writes). The adapter's
      // head-then-put skips the PUT when the checksum is already present at
      // the key, and the record's recorded assets must stay byte-for-byte
      // identical across runs, never grow/duplicate.
      const exitSecond = await runAcquireCli([DE_RAYS_SOURCE_ID]);
      expect(exitSecond).toBe(0);

      const afterSecond = loadAllSources(sourcesDir).find(
        (entry) => entry.source.sourceId === DE_RAYS_SOURCE_ID,
      );
      if (afterSecond === undefined) {
        throw new Error(`bibliography/sources/${DE_RAYS_SOURCE_ID}.yml did not load after the second acquire.`);
      }
      const recordSecond = afterSecond.records.find((record) =>
        (record.identifiers ?? []).some((identifier) => identifier.type === 'papers-past'),
      );
      if (recordSecond === undefined) {
        throw new Error(
          `${DE_RAYS_SOURCE_ID}'s Papers Past repositoryRecord was not found after the second acquire.`,
        );
      }
      const assetsSecond: AcquiredAsset[] = recordSecond.assets ?? [];

      expect(assetsSecond).toEqual(assetsFirst);
    },
    LIVE_TIMEOUT_MS,
  );
});
