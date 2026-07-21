/**
 * Hermetic unit tests for {@link PapersPastAdapter} (T012 resolve, T018 rights
 * fail-closed + collectRightsEvidence, T019 governed-read, plus acquire happy
 * path / idempotency / dry-run / image-validity guard).
 *
 * ZERO network, ZERO real host/object-store mutation: the injected fakes
 * (`./fakes`) script every browser navigation, WAF-cleared image byte fetch
 * (`fetchBytes`), and object-store head/put, and `captureBaseDir` is a per-run
 * temp dir so `persistCapture` writes under `os.tmpdir()`, never the repo's
 * `bibliography/` tree.
 *
 * Image bytes flow through the SAME browser session's `fetchBytes` (the
 * WAF-cleared in-page fetch, research.md R1 CONFIRMED) -- not a separate
 * stateless client -- so a test scripts image bytes on the browser fake and
 * asserts on `browser.fetchBytesCalls`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PapersPastAdapter } from '@/repository/papers-past/adapter';
import { objectKeyForSegment, objectKeyForOcr } from '@/repository/papers-past/keys';
import { parseArticle } from '@/repository/papers-past/parse';
import { sha256OfBytes } from '@/archive/checksum';
import type { RepositoryRecord } from '@/model/repository-record';
import type { AcquiredAsset } from '@/model/acquired-asset';
import type { RightsAssessment } from '@/model/rights';
import { FakeBrowserSession, FakeObjectStore } from './fakes';

const FIXTURE_HTML = readFileSync(
  path.join(__dirname, 'fixtures', 'de-rays-article.html'),
  'utf-8',
);
const FIXTURE_URL = 'https://paperspast.natlib.govt.nz/newspapers/HNS18840103.2.19.3';
const ARTICLE_ID = 'HNS18840103.2.19.3';
const FIXED_NOW = '2026-07-18T00:00:00.000Z';

/** The 3 relative image locators the fixture yields, sorted ascending by area. */
const IMAGE_LOCATORS = parseArticle(FIXTURE_HTML, FIXTURE_URL).imageLocators;

/** The fixture's `#text-tab` OCR text -- present on every real article page (Task 3). */
const FIXTURE_OCR_TEXT = parseArticle(FIXTURE_HTML, FIXTURE_URL).ocrText;
if (FIXTURE_OCR_TEXT === undefined) {
  throw new Error('de-rays-article.html fixture parsed to no ocrText -- test setup invariant violated.');
}
const OCR_BYTES = new TextEncoder().encode(FIXTURE_OCR_TEXT);
const OCR_CHECKSUM = sha256OfBytes(OCR_BYTES);
const OCR_KEY = objectKeyForOcr(ARTICLE_ID, OCR_CHECKSUM);

/**
 * Build a distinct, VALID GIF byte body (starts with the `GIF89a` magic) for a
 * given segment marker, so each of the 3 segments checksums to a different key.
 */
function gifBytes(marker: number): Uint8Array {
  return new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, marker, 0x00, 0xff]);
}

/** A non-image / WAF-challenge body (NOT a GIF) to drive the image-validity guard. */
function challengeBytes(): Uint8Array {
  return new Uint8Array(Buffer.from('<html>Incapsula challenge</html>', 'utf-8'));
}

/** Map each fixture image URL -> distinct valid GIF bytes. */
function scriptedImageBytes(): Map<string, Uint8Array> {
  const bytes = new Map<string, Uint8Array>();
  IMAGE_LOCATORS.forEach((locator, index) => {
    bytes.set(locator.url, gifBytes(index + 1));
  });
  return bytes;
}

/** Expected deterministic object key for a segment index (0-based). */
function expectedKey(index: number): string {
  return objectKeyForSegment(ARTICLE_ID, sha256OfBytes(gifBytes(index + 1)));
}

/** Build a recorded page-master AcquiredAsset that PINS a given sequence at a checksum. */
function pageMaster(url: string, checksum: string, sequence: number): AcquiredAsset {
  return {
    sourceUrl: url,
    mediaType: 'image/gif',
    objectStoreKey: `archive/papers-past/hns18840103.2.19.3/${checksum}.gif`,
    checksum,
    byteLength: 9,
    provenancePath: `archive/papers-past/hns18840103.2.19.3/${checksum}.yml`,
    role: 'page-master',
    sequence,
  };
}

/** The base64 payload of the fixture's area=3 (`/imageserver/newspapers/`) image. */
const AREA3_B64 =
  'P29pZD1ITlMxODg0MDEwMy4yLjE5LjMmY29sb3Vycz0zMiZleHQ9Z2lmJmFyZWE9MyZ3aWR0aD00MTc=';

/** The fixture with the area=3 `<img>` removed -> a page that now parses only [1,2]. */
const TWO_SEGMENT_HTML = FIXTURE_HTML.replace(
  new RegExp(`<img\\b[^>]*${AREA3_B64}[^>]*>`, 'g'),
  '',
);

/** The fixture with the `#text-tab` article body emptied -> `ocrText` parses to `undefined`. */
const NO_OCR_HTML = FIXTURE_HTML.replace(
  /<div itemprop="articleBody">[\s\S]*?<\/div>/,
  '<div itemprop="articleBody"></div>',
);

/** The fixture with every root-relative `/imageserver/` src rehomed to an off-origin host. */
const OFF_ORIGIN_IMAGE_HTML = FIXTURE_HTML.replaceAll(
  'src="/imageserver/newspapers/',
  'src="https://evil.example/imageserver/newspapers/',
);

const PUBLIC_DOMAIN: RightsAssessment = {
  rightsStatus: 'public-domain',
  rightsBasis: 'Published 1884; no known copyright (New Zealand).',
  assessedBy: 'operator',
  assessedAt: FIXED_NOW,
};

function recordWith(rightsAssessment?: RightsAssessment): RepositoryRecord {
  const record: RepositoryRecord = {
    sourceId: 'de-rays',
    sourceArchive: 'Papers Past / NLNZ',
    identifiers: [{ type: 'papers-past', value: ARTICLE_ID }],
    sourceUrl: FIXTURE_URL,
    status: 'pending',
  };
  if (rightsAssessment !== undefined) {
    record.rightsAssessment = rightsAssessment;
  }
  return record;
}

/**
 * Fixture browser session scripting the article HTML for `FIXTURE_URL` and,
 * optionally, the WAF-cleared image bytes returned by `fetchBytes` per image
 * URL (research.md R1: bytes come from the same session, not a separate client).
 */
function fixtureBrowser(bytes?: Map<string, Uint8Array>): FakeBrowserSession {
  return new FakeBrowserSession({ html: new Map([[FIXTURE_URL, FIXTURE_HTML]]), bytes });
}

describe('PapersPastAdapter', () => {
  let captureBaseDir: string;

  beforeEach(() => {
    captureBaseDir = mkdtempSync(path.join(os.tmpdir(), 'pp-'));
  });

  afterEach(() => {
    rmSync(captureBaseDir, { recursive: true, force: true });
  });

  function captureDir(): string {
    return path.join(captureBaseDir, 'bibliography', 'repository-responses', 'papers-past-article');
  }

  describe('resolve (T012, from fixture)', () => {
    it('resolves the article identity, title, and 3 sequenced page-master locators', async () => {
      const browser = fixtureBrowser();
      const adapter = new PapersPastAdapter({
        browserSession: browser,
        now: () => FIXED_NOW,
        captureBaseDir,
      });

      const item = await adapter.resolve({ repository: 'papers-past', value: FIXTURE_URL }, {});

      expect(item.repository).toBe('papers-past');
      expect(item.identifiers).toEqual([{ type: 'papers-past', value: ARTICLE_ID }]);
      expect(item.title).toContain('CONVICTION OF MARQUIS DE RAYS');
      expect(item.sourceUrl).toBe(FIXTURE_URL);
      expect(item.assetLocators).toHaveLength(3);
      expect(item.assetLocators.map((locator) => locator.role)).toEqual([
        'page-master',
        'page-master',
        'page-master',
      ]);
      expect(item.assetLocators.map((locator) => locator.sequence)).toEqual([1, 2, 3]);
      // Mechanical grounded date, decoded from the article code (1884-01-03).
      expect(item.metadata.date.value).toBe('1884-01-03');
      expect(item.metadata.date.provenance.engine).toBe('papers-past-mechanical-parse');
    });
  });

  describe('governed read (T019)', () => {
    it('navigates via the browser session and persists the raw page BEFORE parsing', async () => {
      const browser = fixtureBrowser();
      const adapter = new PapersPastAdapter({
        browserSession: browser,
        now: () => FIXED_NOW,
        captureBaseDir,
      });

      await adapter.resolve({ repository: 'papers-past', value: FIXTURE_URL }, {});

      // The article page was fetched through the injected browser session.
      expect(browser.navigateCalls).toEqual([FIXTURE_URL]);
      // resolve fetches NO image bytes (bytes only flow through fetchBytes at acquire).
      expect(browser.fetchBytesCalls).toEqual([]);

      // The raw page was persisted to the temp capture dir (persist-before-parse):
      // an .html capture whose bytes are the fixture exists there.
      const dir = captureDir();
      expect(existsSync(dir)).toBe(true);
      const htmlCaptures = readdirSync(dir).filter((name) => name.endsWith('.html'));
      expect(htmlCaptures).toHaveLength(1);
      const persisted = readFileSync(path.join(dir, htmlCaptures[0]), 'utf-8');
      expect(persisted).toBe(FIXTURE_HTML);
    });
  });

  describe('acquire happy path', () => {
    it('mirrors 3 page-master GIFs under deterministic keys and returns complete', async () => {
      const objectStore = new FakeObjectStore();
      const browser = fixtureBrowser(scriptedImageBytes());
      const adapter = new PapersPastAdapter({
        browserSession: browser,
        objectStore,
        now: () => FIXED_NOW,
        captureBaseDir,
      });

      const result = await adapter.acquire(recordWith(PUBLIC_DOMAIN), {});

      expect(result.complete).toBe(true);
      expect(result.reconciliationRequired).toBe(true);
      // The fixture also carries #text-tab OCR, so the OCR asset (Task 3,
      // asserted in its own describe block below) rides along too -- scope
      // these page-master-specific assertions to that role.
      const pageMasters = result.assets.filter((asset) => asset.role === 'page-master');
      expect(pageMasters).toHaveLength(3);
      expect(pageMasters.map((asset) => asset.sequence)).toEqual([1, 2, 3]);
      expect(pageMasters.every((asset) => asset.mediaType === 'image/gif')).toBe(true);

      // Bytes flowed through the SAME WAF-cleared browser session (never an ad-hoc fetch).
      expect(browser.fetchBytesCalls).toHaveLength(3);

      // Exactly 3 page-master puts, one per deterministic key.
      const gifPutCalls = objectStore.putCalls.filter((call) => call.key.endsWith('.gif'));
      expect(gifPutCalls).toHaveLength(3);
      const putKeys = gifPutCalls.map((call) => call.key).sort();
      const expectedKeys = [expectedKey(0), expectedKey(1), expectedKey(2)].sort();
      expect(putKeys).toEqual(expectedKeys);
      for (const call of gifPutCalls) {
        expect(call.options.contentType).toBe('image/gif');
      }
    });
  });

  describe('OCR asset (ocr-text, Task 3, atomic Principle XV)', () => {
    it('captures the source OCR as an ocr-text asset alongside the page-masters', async () => {
      const objectStore = new FakeObjectStore();
      const browser = fixtureBrowser(scriptedImageBytes());
      const adapter = new PapersPastAdapter({
        browserSession: browser,
        objectStore,
        now: () => FIXED_NOW,
        captureBaseDir,
      });

      const result = await adapter.acquire(recordWith(PUBLIC_DOMAIN), {});

      const ocr = result.assets.filter((asset) => asset.role === 'ocr-text');
      expect(ocr).toHaveLength(1);
      expect(ocr[0].mediaType).toBe('text/plain; charset=utf-8');
      expect(ocr[0].sourceRepresentation).toBe('papers-past-text-tab');
      expect(ocr[0].objectStoreKey).toBe(OCR_KEY);
      expect(ocr[0].objectStoreKey).toMatch(/^archive\/papers-past\/.+\/[0-9a-f]{64}\.txt$/);
      expect(ocr[0].checksum).toBe(OCR_CHECKSUM);
      expect(ocr[0].byteLength).toBe(OCR_BYTES.length);
      expect(ocr[0].sequence).toBe(0);
      expect(ocr[0].sourceUrl).toBe(FIXTURE_URL);

      const put = objectStore.putCalls.find((call) => call.key === ocr[0].objectStoreKey);
      expect(put).toBeDefined();
      if (put === undefined) {
        throw new Error('expected an ocr-text put call');
      }
      expect(new TextDecoder().decode(put.bytes)).toContain('found guilty');
      expect(put.options.sha256).toBe(OCR_CHECKSUM);
      expect(put.options.contentType).toBe('text/plain; charset=utf-8');

      expect(result.assets.filter((asset) => asset.role === 'page-master').length).toBeGreaterThan(0);
    });

    it('is idempotent on the ocr-text object (0 duplicate put on re-run)', async () => {
      const objectStore = new FakeObjectStore();
      objectStore.seed(OCR_KEY, { sha256: OCR_CHECKSUM });
      const adapter = new PapersPastAdapter({
        browserSession: fixtureBrowser(scriptedImageBytes()),
        objectStore,
        now: () => FIXED_NOW,
        captureBaseDir,
      });

      const result = await adapter.acquire(recordWith(PUBLIC_DOMAIN), {});

      const ocr = result.assets.filter((asset) => asset.role === 'ocr-text');
      expect(ocr).toHaveLength(1);
      expect(objectStore.putCalls.some((call) => call.key === OCR_KEY)).toBe(false);
      expect(objectStore.headCalls.some((call) => call.key === OCR_KEY)).toBe(true);
    });

    it('dry-run puts no ocr-text object and returns empty assets', async () => {
      const objectStore = new FakeObjectStore();
      const browser = fixtureBrowser(scriptedImageBytes());
      const adapter = new PapersPastAdapter({
        browserSession: browser,
        objectStore,
        now: () => FIXED_NOW,
        captureBaseDir,
      });

      const result = await adapter.acquire(recordWith(PUBLIC_DOMAIN), { dryRun: true });

      expect(result.assets).toEqual([]);
      expect(objectStore.putCalls.some((call) => call.key === OCR_KEY)).toBe(false);
      expect(objectStore.headCalls.some((call) => call.key === OCR_KEY)).toBe(false);
    });

    it('OCR absent -> page-masters only, no ocr-text asset, no throw', async () => {
      const objectStore = new FakeObjectStore();
      const browser = new FakeBrowserSession({
        html: new Map([[FIXTURE_URL, NO_OCR_HTML]]),
        bytes: scriptedImageBytes(),
      });
      const adapter = new PapersPastAdapter({
        browserSession: browser,
        objectStore,
        now: () => FIXED_NOW,
        captureBaseDir,
      });

      const result = await adapter.acquire(recordWith(PUBLIC_DOMAIN), {});

      expect(result.assets.some((asset) => asset.role === 'ocr-text')).toBe(false);
      expect(result.assets.some((asset) => asset.role === 'page-master')).toBe(true);
      expect(result.assets.filter((asset) => asset.role === 'page-master')).toHaveLength(3);
    });
  });

  describe('idempotent re-acquire', () => {
    it('issues 0 duplicate puts when all 3 page-master keys AND the ocr-text key are already present at matching sha256', async () => {
      const seed = new Map(
        IMAGE_LOCATORS.map((_, index) => {
          const checksum = sha256OfBytes(gifBytes(index + 1));
          return [objectKeyForSegment(ARTICLE_ID, checksum), { sha256: checksum }] as const;
        }),
      );
      // The fixture also carries #text-tab OCR (Task 3) -- seed its key too so
      // this "0 duplicate puts" assertion covers the WHOLE commit, not just
      // the page-masters.
      seed.set(OCR_KEY, { sha256: OCR_CHECKSUM });
      const objectStore = new FakeObjectStore(new Map(seed));
      const adapter = new PapersPastAdapter({
        browserSession: fixtureBrowser(scriptedImageBytes()),
        objectStore,
        now: () => FIXED_NOW,
        captureBaseDir,
      });

      const result = await adapter.acquire(recordWith(PUBLIC_DOMAIN), {});

      expect(result.assets).toHaveLength(4);
      expect(objectStore.putCalls).toHaveLength(0);
      // Still HEADs each key (3 page-masters + 1 ocr-text) to detect the
      // already-present-with-matching-checksum state.
      expect(objectStore.headCalls).toHaveLength(4);
    });
  });

  describe('dry-run', () => {
    it('writes nothing and returns empty assets with complete:false', async () => {
      const objectStore = new FakeObjectStore();
      const browser = fixtureBrowser(scriptedImageBytes());
      const adapter = new PapersPastAdapter({
        browserSession: browser,
        objectStore,
        now: () => FIXED_NOW,
        captureBaseDir,
      });

      const result = await adapter.acquire(recordWith(PUBLIC_DOMAIN), { dryRun: true });

      expect(result.assets).toEqual([]);
      expect(result.complete).toBe(false);
      expect(result.reconciliationRequired).toBe(true);
      // No side effects at all: no navigate, no byte fetch, no put.
      expect(browser.navigateCalls).toEqual([]);
      expect(browser.fetchBytesCalls).toEqual([]);
      expect(objectStore.putCalls).toHaveLength(0);
      expect(objectStore.headCalls).toHaveLength(0);
    });
  });

  describe('image-validity guard', () => {
    it('throws on a non-image/challenge segment and never puts it', async () => {
      const bytes = scriptedImageBytes();
      // Replace the 2nd segment's bytes with a WAF challenge body.
      bytes.set(IMAGE_LOCATORS[1].url, challengeBytes());
      const objectStore = new FakeObjectStore();
      const adapter = new PapersPastAdapter({
        browserSession: fixtureBrowser(bytes),
        objectStore,
        now: () => FIXED_NOW,
        captureBaseDir,
      });

      await expect(adapter.acquire(recordWith(PUBLIC_DOMAIN), {})).rejects.toThrow(
        /image-validity guard/,
      );

      // The challenge segment (index 1) was never put; only the first segment
      // (already fetched + valid) may have been.
      const challengeKey = expectedKey(1);
      expect(objectStore.putCalls.some((call) => call.key === challengeKey)).toBe(false);
    });
  });

  describe('rights fail-closed (T018)', () => {
    it('throws with ZERO side effects when no rightsAssessment is present', async () => {
      const objectStore = new FakeObjectStore();
      const browser = fixtureBrowser(scriptedImageBytes());
      const adapter = new PapersPastAdapter({
        browserSession: browser,
        objectStore,
        now: () => FIXED_NOW,
        captureBaseDir,
      });

      await expect(adapter.acquire(recordWith(undefined), {})).rejects.toThrow(/fail-closed/);
      expect(browser.fetchBytesCalls.length).toBe(0);
      expect(objectStore.putCalls.length).toBe(0);
      expect(browser.navigateCalls.length).toBe(0);
    });

    it('throws with ZERO side effects when rightsStatus is restricted', async () => {
      const objectStore = new FakeObjectStore();
      const browser = fixtureBrowser(scriptedImageBytes());
      const restricted: RightsAssessment = {
        rightsStatus: 'restricted',
        rightsBasis: 'Under copyright.',
        assessedBy: 'operator',
        assessedAt: FIXED_NOW,
      };
      const adapter = new PapersPastAdapter({
        browserSession: browser,
        objectStore,
        now: () => FIXED_NOW,
        captureBaseDir,
      });

      await expect(adapter.acquire(recordWith(restricted), {})).rejects.toThrow(/fail-closed/);
      expect(browser.fetchBytesCalls.length).toBe(0);
      expect(objectStore.putCalls.length).toBe(0);
      expect(browser.navigateCalls.length).toBe(0);
    });
  });

  describe('collectRightsEvidence (T018)', () => {
    it('returns the verbatim NZ rights evidence with a grounded date and NO rightsStatus', async () => {
      const adapter = new PapersPastAdapter({
        browserSession: fixtureBrowser(),
        now: () => FIXED_NOW,
        captureBaseDir,
      });

      const item = await adapter.resolve({ repository: 'papers-past', value: FIXTURE_URL }, {});
      const evidence = await adapter.collectRightsEvidence(item);

      expect(evidence.rightsRaw).toContain('No known copyright');
      expect(evidence.jurisdiction).toBe('NZ');
      expect(evidence.date?.value).toBe('1884-01-03');
      expect('rightsStatus' in evidence).toBe(false);
    });

    it('fails loud when the item is not one this adapter resolved', async () => {
      const adapter = new PapersPastAdapter({
        browserSession: fixtureBrowser(),
        now: () => FIXED_NOW,
        captureBaseDir,
      });

      const foreignItem = {
        repository: 'papers-past' as const,
        identifiers: [{ type: 'papers-past' as const, value: ARTICLE_ID }],
        sourceUrl: FIXTURE_URL,
        title: 'not from resolve',
        assetLocators: [],
        metadata: {
          date: {
            value: '1884-01-03',
            evidence: { excerpt: ARTICLE_ID },
            interpretation: 'x',
            provenance: {
              modelAssisted: true as const,
              engine: 'e',
              model: 'm',
              promptVersion: 'v',
              at: FIXED_NOW,
            },
          },
        },
      };

      await expect(adapter.collectRightsEvidence(foreignItem)).rejects.toThrow(
        /no rights evidence is cached/,
      );
    });
  });

  describe('remote-change fail-loud (verify-before-commit)', () => {
    it('throws and issues 0 puts when a recorded segment-1 master checksum differs', async () => {
      const objectStore = new FakeObjectStore();
      const adapter = new PapersPastAdapter({
        browserSession: fixtureBrowser(scriptedImageBytes()),
        objectStore,
        now: () => FIXED_NOW,
        captureBaseDir,
      });

      const record = recordWith(PUBLIC_DOMAIN);
      // A preserved master already recorded for sequence 1 whose checksum will
      // NOT match the fake GIF bytes' real sha256 -> remote-change fail-loud.
      record.assets = [
        {
          sourceUrl: IMAGE_LOCATORS[0].url,
          mediaType: 'image/gif',
          objectStoreKey: 'archive/papers-past/hns18840103.2.19.3/deadbeef.gif',
          checksum: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
          byteLength: 9,
          provenancePath: 'archive/papers-past/hns18840103.2.19.3/deadbeef.yml',
          role: 'page-master',
          sequence: 1,
        },
      ];

      await expect(adapter.acquire(record, {})).rejects.toThrow(/remote-change fail-loud/);
      // PHASE A threw before any commit: NOTHING was PUT (proves verify-all-then-commit).
      expect(objectStore.putCalls).toHaveLength(0);
    });
  });

  describe('identity guard', () => {
    it('throws and issues 0 puts when the resolved article code differs from the record id', async () => {
      const objectStore = new FakeObjectStore();
      const adapter = new PapersPastAdapter({
        browserSession: fixtureBrowser(scriptedImageBytes()),
        objectStore,
        now: () => FIXED_NOW,
        captureBaseDir,
      });

      // The fixture parses to HNS18840103.2.19.3, but the record names a
      // DIFFERENT code -> the URL moved to another article; fail loud.
      const record = recordWith(PUBLIC_DOMAIN);
      record.identifiers = [{ type: 'papers-past', value: 'HNS18840103.2.99.9' }];

      await expect(adapter.acquire(record, {})).rejects.toThrow(/identity guard/);
      expect(objectStore.putCalls).toHaveLength(0);
    });

    it('throws before any navigation when the record carries no papers-past identifier', async () => {
      const objectStore = new FakeObjectStore();
      const browser = fixtureBrowser(scriptedImageBytes());
      const adapter = new PapersPastAdapter({
        browserSession: browser,
        objectStore,
        now: () => FIXED_NOW,
        captureBaseDir,
      });

      const record = recordWith(PUBLIC_DOMAIN);
      record.identifiers = [];

      await expect(adapter.acquire(record, {})).rejects.toThrow(/identity guard/);
      // The identity precondition is checked BEFORE re-resolve: 0 navigate, 0 put.
      expect(browser.navigateCalls).toHaveLength(0);
      expect(objectStore.putCalls).toHaveLength(0);
    });
  });

  describe('resolve-only (no objectStore)', () => {
    it('throws that it cannot acquire, with 0 navigation, when constructed without an object store', async () => {
      const browser = fixtureBrowser(scriptedImageBytes());
      const adapter = new PapersPastAdapter({
        browserSession: browser,
        // NO objectStore: a resolve-only construction cannot mirror.
        now: () => FIXED_NOW,
        captureBaseDir,
      });

      await expect(adapter.acquire(recordWith(PUBLIC_DOMAIN), {})).rejects.toThrow(
        /resolve-only/,
      );
      // The objectStore-required check precedes re-resolve: no side effects.
      expect(browser.navigateCalls).toHaveLength(0);
    });
  });

  describe('literal object key (pinned)', () => {
    it('produces the exact hand-computed key for segment 1', async () => {
      // Hand-computed: sanitize("HNS18840103.2.19.3") = "hns18840103.2.19.3";
      // sha256(gifBytes(1)) = 911333707e3f852341098e6da76c75569fb9860998360a6bd0b37f760fc4e929.
      const LITERAL_SEGMENT_1_KEY =
        'archive/papers-past/hns18840103.2.19.3/' +
        '911333707e3f852341098e6da76c75569fb9860998360a6bd0b37f760fc4e929.gif';

      const objectStore = new FakeObjectStore();
      const adapter = new PapersPastAdapter({
        browserSession: fixtureBrowser(scriptedImageBytes()),
        objectStore,
        now: () => FIXED_NOW,
        captureBaseDir,
      });

      const result = await adapter.acquire(recordWith(PUBLIC_DOMAIN), {});

      expect(result.assets.map((asset) => asset.objectStoreKey)).toContain(
        LITERAL_SEGMENT_1_KEY,
      );
    });
  });

  describe('governed read persists BEFORE parse on the FAILURE path (AUDIT-03)', () => {
    it('persists the raw capture even when the parse throws', async () => {
      // Navigable but UNPARSABLE: no canonical/title/images -> parseArticle throws.
      const unparsable = '<html><body>no article</body></html>';
      const browser = new FakeBrowserSession({ html: new Map([[FIXTURE_URL, unparsable]]) });
      const adapter = new PapersPastAdapter({
        browserSession: browser,
        now: () => FIXED_NOW,
        captureBaseDir,
      });

      await expect(
        adapter.resolve({ repository: 'papers-past', value: FIXTURE_URL }, {}),
      ).rejects.toThrow();

      // The parse threw, yet the raw capture is already on disk -> persist ran FIRST.
      const dir = captureDir();
      expect(existsSync(dir)).toBe(true);
      const htmlCaptures = readdirSync(dir).filter((name) => name.endsWith('.html'));
      expect(htmlCaptures).toHaveLength(1);
      expect(readFileSync(path.join(dir, htmlCaptures[0]), 'utf-8')).toBe(unparsable);
    });
  });

  describe('dropped-segment coverage guard (AUDIT-04)', () => {
    it('throws with 0 puts when the record pins [1,2,3] but the page now yields only [1,2]', async () => {
      // Sanity: the reduced fixture parses to exactly [1,2].
      const twoLocators = parseArticle(TWO_SEGMENT_HTML, FIXTURE_URL).imageLocators;
      expect(twoLocators.map((locator) => locator.sequence)).toEqual([1, 2]);

      const bytes = new Map<string, Uint8Array>([
        [twoLocators[0].url, gifBytes(1)],
        [twoLocators[1].url, gifBytes(2)],
      ]);
      const browser = new FakeBrowserSession({
        html: new Map([[FIXTURE_URL, TWO_SEGMENT_HTML]]),
        bytes,
      });
      const objectStore = new FakeObjectStore();
      const adapter = new PapersPastAdapter({
        browserSession: browser,
        objectStore,
        now: () => FIXED_NOW,
        captureBaseDir,
      });

      const record = recordWith(PUBLIC_DOMAIN);
      // Segments 1,2 checksums MATCH the fetched bytes (so PHASE A passes), and the
      // record additionally PINS segment 3 that the fresh parse no longer yields.
      record.assets = [
        pageMaster(twoLocators[0].url, sha256OfBytes(gifBytes(1)), 1),
        pageMaster(twoLocators[1].url, sha256OfBytes(gifBytes(2)), 2),
        pageMaster(
          'https://paperspast.natlib.govt.nz/imageserver/newspapers/gone',
          'cafef00dcafef00dcafef00dcafef00dcafef00dcafef00dcafef00dcafef00d',
          3,
        ),
      ];

      await expect(adapter.acquire(record, {})).rejects.toThrow(/remote-change fail-loud/);
      // Coverage guard fires AFTER PHASE A, BEFORE any commit -> 0 puts.
      expect(objectStore.putCalls).toHaveLength(0);
    });
  });

  describe('Papers Past origin enforcement (AUDIT-05)', () => {
    it('acquire throws before any navigate/fetch when record.sourceUrl is off-origin', async () => {
      const browser = fixtureBrowser(scriptedImageBytes());
      const objectStore = new FakeObjectStore();
      const adapter = new PapersPastAdapter({
        browserSession: browser,
        objectStore,
        now: () => FIXED_NOW,
        captureBaseDir,
      });

      const record = recordWith(PUBLIC_DOMAIN);
      record.sourceUrl = 'https://evil.example/newspapers/HNS18840103.2.19.3';

      await expect(adapter.acquire(record, {})).rejects.toThrow(/origin guard/);
      expect(browser.navigateCalls).toHaveLength(0);
      expect(browser.fetchBytesCalls).toHaveLength(0);
      expect(objectStore.putCalls).toHaveLength(0);
    });

    it('resolve throws before any navigate when the locator value is off-origin', async () => {
      const browser = fixtureBrowser();
      const adapter = new PapersPastAdapter({
        browserSession: browser,
        now: () => FIXED_NOW,
        captureBaseDir,
      });

      await expect(
        adapter.resolve(
          { repository: 'papers-past', value: 'https://evil.example/newspapers/HNS18840103.2.19.3' },
          {},
        ),
      ).rejects.toThrow(/origin guard/);
      expect(browser.navigateCalls).toHaveLength(0);
    });

    it('acquire throws before fetch when a resolved image locator is off-origin', async () => {
      // The article page is on-origin and parses fine, but its image src resolves
      // off-origin -> the per-locator origin guard throws BEFORE any byte fetch.
      const browser = new FakeBrowserSession({
        html: new Map([[FIXTURE_URL, OFF_ORIGIN_IMAGE_HTML]]),
        // No bytes scripted: reaching fetchBytes at all would itself throw, but the
        // origin guard must fire first, so fetchBytesCalls stays empty.
      });
      const objectStore = new FakeObjectStore();
      const adapter = new PapersPastAdapter({
        browserSession: browser,
        objectStore,
        now: () => FIXED_NOW,
        captureBaseDir,
      });

      await expect(adapter.acquire(recordWith(PUBLIC_DOMAIN), {})).rejects.toThrow(/origin guard/);
      expect(browser.fetchBytesCalls).toHaveLength(0);
      expect(objectStore.putCalls).toHaveLength(0);
    });
  });

  describe('record-level metadataSnapshotRef (GAP 2)', () => {
    it('acquire returns a metadataSnapshotRef under bibliography/repository-responses/papers-past-article/', async () => {
      const objectStore = new FakeObjectStore();
      const browser = fixtureBrowser(scriptedImageBytes());
      const adapter = new PapersPastAdapter({
        browserSession: browser,
        objectStore,
        now: () => FIXED_NOW,
        captureBaseDir,
      });

      const result = await adapter.acquire(recordWith(PUBLIC_DOMAIN), {});

      expect(result.metadataSnapshotRef).toBeDefined();
      const ref = result.metadataSnapshotRef;
      if (ref === undefined) {
        throw new Error('expected a metadataSnapshotRef');
      }
      expect(ref.path.startsWith('bibliography/repository-responses/papers-past-article/')).toBe(
        true,
      );
      expect(ref.path.endsWith('.html')).toBe(true);
      expect(ref.retrievedAt).toBe(FIXED_NOW);
      expect(ref.endpoint).toBe(FIXTURE_URL);
      expect(ref.normalizationVersion).toBe(1);
    });
  });
});
