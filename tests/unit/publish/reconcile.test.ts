/**
 * Unit test (T030, spec 008-edition-publishing): the reconcile back-fill mode
 * of `publish()` (`@/pdf/publish/publish`), US4 / FR-013 / G-8 / SC-006. A
 * confirmed `reconcile` run records a source's already-served english-only
 * issues at their EXISTING legacy-flat keys (no `__snapshotShort` suffix),
 * WITHOUT any upload: it GETs each served URL via an injected `httpGet` to
 * compute the recorded `sha256`, reads the page count from the build's
 * `<issueId>.input.json`, and records with `keyScheme: 'legacy-flat'` + a
 * `<sourceId>-<variant>-legacy.yml` manifest.
 *
 * Mirrors the idempotency-test fixture (tests/unit/publish/idempotent.test.ts):
 * a temp-dir fixture with fake ArchivePinReader / CorpusSnapshotReader / clock,
 * a `rights: public-domain` Source `PB-990` written via `writeSourceFile`, and
 * `<issueId>.input.json` present for the page count. A counting FakeObjectStore
 * proves ZERO uploads (put-count 0). A seeded fake `httpGet` returns known
 * served bytes per legacy-flat URL, so the recorded `sha256` can be checked
 * against the served bytes and each `url === cdnBase + '/' + key` (SC-006, G-8).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PutOptions } from '@/archive/object-store';
import type { HttpGet, HttpResponse } from '@/archive/public-cache';
import { loadSourceFile } from '@/bibliography/load';
import { writeSourceFile } from '@/bibliography/source-writer';
import type { ArchivePinReader, CorpusSnapshotReader } from '@/pdf/load/edition';
import type { MachineAssistLabel } from '@/pdf/model';
import { publish } from '@/pdf/publish/publish';
import type { Source } from '@/model/source';

import { FakeObjectStore } from '../archive/fake-object-store';

const SOURCE_ID = 'PB-990';
const VARIANT = 'english-only' as const;
const ISSUE_IDS = ['1900-01-01_a', '1900-02-01_b', '1900-03-01_c'];
const PIN_REF = 'c'.repeat(40);
const CDN_BASE = 'https://cdn.example.test';
const PAGE_COUNT = 8;
const RIGHTS_BASIS = 'reconcile test public-domain basis';

const MACHINE_ASSIST: MachineAssistLabel = {
  engine: 'claude-code-cli',
  model: 'claude-sonnet-5',
  retrieved: '2026-07-12T00:00:00.000Z',
};

const FIXED_NOW = new Date('2026-07-12T09:30:00.000Z');
const fixedClock = (): Date => FIXED_NOW;

const pinReader: ArchivePinReader = { read: () => PIN_REF };

const corpusSnapshotReader: CorpusSnapshotReader = {
  read(sourceId: string) {
    if (sourceId !== SOURCE_ID) {
      throw new Error(`fake corpusSnapshotReader: unexpected sourceId ${sourceId}`);
    }
    return {
      sources: [
        {
          sourceId: SOURCE_ID,
          title: 'Reconcile Test Source',
          kind: 'periodical' as const,
          language: 'French' as const,
          ark: 'ark:/12148/reconcile-test',
          rights: 'public-domain',
          issues: ISSUE_IDS.map((issueId, i) => ({
            issueId,
            date: '1900-01-01',
            sequence: i + 1,
            pages: [],
          })),
        },
      ],
      skipped: [],
    };
  },
};

/** The legacy-flat key for an issue (no `__snapshotShort` suffix). */
function legacyKeyFor(issueId: string): string {
  return `editions/${VARIANT}/${SOURCE_ID}/${issueId}.pdf`;
}

/** SHA-256 hex of `bytes`, computed independently of `sha256OfBytes`. */
function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Copy `bytes` into a fresh, exactly-sized ArrayBuffer (an `HttpResponse.arrayBuffer` body). */
function toArrayBuffer(bytes: Buffer): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/**
 * Counting FakeObjectStore: records `put` calls so the test can prove reconcile
 * performs ZERO uploads (put-count 0). Same pattern as the idempotency test.
 */
class CountingStore extends FakeObjectStore {
  putCount = 0;

  override async put(key: string, bytes: Uint8Array, options: PutOptions): Promise<void> {
    this.putCount += 1;
    await super.put(key, bytes, options);
  }
}

/**
 * Build a fake `httpGet` that serves `served` bytes for each seeded URL and
 * returns a non-OK 404 otherwise. Wrapped in a vi.fn so call counts can be
 * asserted (a reconcile dry-run must NOT GET anything).
 */
function makeFakeHttpGet(served: Map<string, Buffer>): ReturnType<typeof vi.fn> & HttpGet {
  return vi.fn(async (url: string): Promise<HttpResponse> => {
    const bytes = served.get(url);
    if (bytes === undefined) {
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => toArrayBuffer(bytes),
    };
  }) as ReturnType<typeof vi.fn> & HttpGet;
}

interface Fixture {
  tmpRoot: string;
  sourcesDir: string;
  publicationsDir: string;
  outDir: string;
  store: CountingStore;
  commit: ReturnType<typeof vi.fn>;
  httpGet: ReturnType<typeof vi.fn> & HttpGet;
  /** issueId -> the served bytes seeded at its legacy-flat CDN URL. */
  servedBytes: Map<string, Buffer>;
}

let fixture: Fixture;

beforeEach(() => {
  const tmpRoot = mkdtempSync(path.join(tmpdir(), 'corpus-print-pdf-publish-reconcile-'));
  const sourcesDir = path.join(tmpRoot, 'bibliography', 'sources');
  const publicationsDir = path.join(tmpRoot, 'bibliography', 'publications');
  const outDir = path.join(tmpRoot, 'build', 'pdf');

  // Authored SSOT: a minimal Source cleared by the rights gate.
  const source: Source = {
    sourceId: SOURCE_ID,
    titles: [{ text: 'Reconcile Test Source', role: 'canonical' }],
    kind: 'periodical',
    identifiers: [],
    rights: { status: 'public-domain', basis: RIGHTS_BASIS },
  };
  mkdirSync(sourcesDir, { recursive: true });
  writeSourceFile(sourcesDir, { source, records: [] });

  // Build metadata: <issueId>.input.json (source of the page count + label).
  // The built PDF bytes are irrelevant to reconcile (which reads SERVED bytes),
  // but are written to mirror what `pdf:build` leaves behind.
  const sourceOutDir = path.join(outDir, SOURCE_ID);
  mkdirSync(sourceOutDir, { recursive: true });

  const servedBytes = new Map<string, Buffer>();
  for (const issueId of ISSUE_IDS) {
    writeFileSync(
      path.join(sourceOutDir, `${issueId}.pdf`),
      Buffer.from(`%PDF-1.4 built stub for ${issueId}\n`, 'utf-8'),
    );
    const pages = [
      { recto: { machineAssist: MACHINE_ASSIST } },
      ...Array.from({ length: PAGE_COUNT - 1 }, () => ({})),
    ];
    writeFileSync(
      path.join(sourceOutDir, `${issueId}.input.json`),
      JSON.stringify({ pages }),
      'utf-8',
    );

    // Distinct SERVED bytes (what the CDN already has), not the built stub.
    servedBytes.set(issueId, Buffer.from(`SERVED legacy edition bytes for ${issueId}\n`, 'utf-8'));
  }

  // Seed the fake httpGet by legacy-flat URL (== cdnBase + '/' + legacyKey).
  const servedByUrl = new Map<string, Buffer>();
  for (const issueId of ISSUE_IDS) {
    servedByUrl.set(`${CDN_BASE}/${legacyKeyFor(issueId)}`, servedBytes.get(issueId) as Buffer);
  }

  fixture = {
    tmpRoot,
    sourcesDir,
    publicationsDir,
    outDir,
    store: new CountingStore(),
    commit: vi.fn(),
    httpGet: makeFakeHttpGet(servedByUrl),
    servedBytes,
  };
});

afterEach(() => {
  rmSync(fixture.tmpRoot, { recursive: true, force: true });
});

const sourceYamlPath = (): string => path.join(fixture.sourcesDir, `${SOURCE_ID}.yml`);
const legacyManifestPath = (): string =>
  path.join(fixture.publicationsDir, `${SOURCE_ID}-${VARIANT}-legacy.yml`);

describe('publish() reconcile (T030, US4 / FR-013 / G-8 / SC-006): back-fill served legacy-flat URLs', () => {
  it('confirm + reconcile records each issue at its legacy-flat key with the served sha256, and uploads NOTHING', async () => {
    const result = await publish({
      sourceId: SOURCE_ID,
      variant: VARIANT,
      confirm: true,
      reconcile: true,
      outDir: fixture.outDir,
      sourcesDir: fixture.sourcesDir,
      publicationsDir: fixture.publicationsDir,
      store: fixture.store,
      clock: fixedClock,
      pinReader,
      corpusSnapshotReader,
      cdnBase: CDN_BASE,
      httpGet: fixture.httpGet,
      commit: fixture.commit,
      log: () => {},
    });

    // 1. Reconcile mode, every issue recorded, zero failures/uploads.
    expect(result.mode).toBe('reconcile');
    expect(result.ok).toBe(true);
    expect(result.published).toBe(ISSUE_IDS.length);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);

    // 2. ZERO uploads: no `store.put` (G-8, back-fill only), store empty.
    expect(fixture.store.putCount).toBe(0);
    expect(fixture.store.size).toBe(0);

    // 3. The recorded URLs are the served legacy-flat URLs (no `__short`).
    for (const issueId of ISSUE_IDS) {
      const key = legacyKeyFor(issueId);
      expect(key).not.toContain('__');
      expect(result.urls).toContain(`${CDN_BASE}/${key}`);
    }

    // 4. The SSOT publication is recorded with keyScheme legacy-flat + the
    // `legacy` snapshot tokens (data-model §2/§4).
    const loaded = loadSourceFile(sourceYamlPath());
    expect(loaded.source.publications).toHaveLength(1);
    const publication = loaded.source.publications?.[0];
    if (publication === undefined) {
      throw new Error('test bug: publication entry missing after reconcile');
    }
    expect(publication.variant).toBe(VARIANT);
    expect(publication.keyScheme).toBe('legacy-flat');
    expect(publication.snapshot).toBe('legacy');
    expect(publication.snapshotShort).toBe('legacy');
    expect(publication.cdnBase).toBe(CDN_BASE);
    expect(publication.rightsBasis).toBe(RIGHTS_BASIS);
    expect(publication.machineAssist).toEqual(MACHINE_ASSIST);
    expect(publication.manifest.manifestPath).toBe(
      `bibliography/publications/${SOURCE_ID}-${VARIANT}-legacy.yml`,
    );
    expect(publication.manifest.issueCount).toBe(ISSUE_IDS.length);

    // 5. The `-legacy.yml` manifest lists every issue with its legacy-flat key,
    // url === cdnBase + '/' + key, and sha256 === sha256(served bytes) (SC-006).
    expect(existsSync(legacyManifestPath())).toBe(true);
    const manifest = parseYaml(readFileSync(legacyManifestPath(), 'utf-8')) as {
      sourceId: string;
      variant: string;
      snapshot?: string;
      issues: { issueId: string; url: string; key: string; sha256: string; pages: number }[];
    };
    expect(manifest.sourceId).toBe(SOURCE_ID);
    expect(manifest.variant).toBe(VARIANT);
    expect(manifest.snapshot).toBeUndefined();
    expect(manifest.issues).toHaveLength(ISSUE_IDS.length);
    for (const issueId of ISSUE_IDS) {
      const entry = manifest.issues.find((i) => i.issueId === issueId);
      expect(entry).toBeDefined();
      if (entry === undefined) {
        continue;
      }
      const key = legacyKeyFor(issueId);
      expect(entry.key).toBe(key);
      expect(entry.url).toBe(`${CDN_BASE}/${key}`);
      expect(entry.sha256).toBe(sha256Hex(fixture.servedBytes.get(issueId) as Buffer));
      expect(entry.pages).toBe(PAGE_COUNT);
    }

    // 6. Provenance committed (FR-008).
    expect(fixture.commit).toHaveBeenCalledTimes(1);
  });

  it('a reconcile dry-run (confirm: false) plans without GETting, uploading, or recording anything', async () => {
    const result = await publish({
      sourceId: SOURCE_ID,
      variant: VARIANT,
      confirm: false,
      reconcile: true,
      outDir: fixture.outDir,
      sourcesDir: fixture.sourcesDir,
      publicationsDir: fixture.publicationsDir,
      store: fixture.store,
      clock: fixedClock,
      pinReader,
      corpusSnapshotReader,
      cdnBase: CDN_BASE,
      httpGet: fixture.httpGet,
      commit: fixture.commit,
      log: () => {},
    });

    // Planned only: legacy-flat keys/URLs, nothing written.
    expect(result.mode).toBe('dry-run');
    expect(result.ok).toBe(true);
    expect(result.published).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.planned).toHaveLength(ISSUE_IDS.length);
    for (const issueId of ISSUE_IDS) {
      const key = legacyKeyFor(issueId);
      const plan = result.planned?.find((p) => p.issueId === issueId);
      expect(plan?.key).toBe(key);
      expect(plan?.url).toBe(`${CDN_BASE}/${key}`);
    }

    // Nothing GET, nothing PUT, no manifest, no publications, no commit.
    expect(fixture.httpGet).not.toHaveBeenCalled();
    expect(fixture.store.putCount).toBe(0);
    expect(fixture.store.size).toBe(0);
    expect(existsSync(legacyManifestPath())).toBe(false);
    expect(loadSourceFile(sourceYamlPath()).source.publications).toBeUndefined();
    expect(fixture.commit).not.toHaveBeenCalled();
  });

  it('a non-OK GET for an issue is an attributable per-issue failure (G-7), never a silent skip', async () => {
    // Drop one issue from the served set so its GET returns 404.
    const missingIssue = ISSUE_IDS[0];
    const missingUrl = `${CDN_BASE}/${legacyKeyFor(missingIssue)}`;
    fixture.httpGet.mockImplementation(async (url: string): Promise<HttpResponse> => {
      if (url === missingUrl) {
        return {
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }
      const bytes = fixture.servedBytes.get(
        ISSUE_IDS.find((id) => url === `${CDN_BASE}/${legacyKeyFor(id)}`) ?? '',
      );
      if (bytes === undefined) {
        return { ok: false, status: 404, statusText: 'Not Found', arrayBuffer: async () => new ArrayBuffer(0) };
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => toArrayBuffer(bytes),
      };
    });

    const result = await publish({
      sourceId: SOURCE_ID,
      variant: VARIANT,
      confirm: true,
      reconcile: true,
      outDir: fixture.outDir,
      sourcesDir: fixture.sourcesDir,
      publicationsDir: fixture.publicationsDir,
      store: fixture.store,
      clock: fixedClock,
      pinReader,
      corpusSnapshotReader,
      cdnBase: CDN_BASE,
      httpGet: fixture.httpGet,
      commit: fixture.commit,
      log: () => {},
    });

    expect(result.ok).toBe(false);
    expect(result.failed).toBe(1);
    expect(result.published).toBe(ISSUE_IDS.length - 1);
    const failure = result.failures.find((f) => f.issueId === missingIssue);
    expect(failure).toBeDefined();
    expect(failure?.reason).toContain('403');
    // The other issues still recorded (record-and-continue).
    expect(fixture.store.putCount).toBe(0);
  });
});
