/**
 * Integration test (T015, spec 008-edition-publishing): end-to-end exercise
 * of `publish()` (`@/pdf/publish/publish`) -- the whole orchestration
 * (rights gate -> snapshot/CDN resolution -> resolvePublishTargets ->
 * per-issue upload -> record + commit -> warm) against a temp-dir fixture
 * with every side-effecting collaborator (`store`, `clock`, `pinReader`,
 * `corpusSnapshotReader`, `commit`) injected. This is the SC-001 proof: a
 * confirmed publish actually lands bytes in the object store AND records
 * the SSOT + manifest, from nothing but pre-built `<issueId>.pdf` +
 * `<issueId>.input.json` fixtures (no network, no git, no real B2).
 *
 * Scope: dry-run (writes nothing), confirm (uploads + records + commits,
 * G-5/FR-008), and a second confirm run proving idempotency (SC-004: zero
 * new uploads, unchanged SSOT).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadSourceFile } from '@/bibliography/load';
import { writeSourceFile } from '@/bibliography/source-writer';
import type { ArchivePinReader, CorpusSnapshotReader } from '@/pdf/load/edition';
import type { MachineAssistLabel } from '@/pdf/model';
import { publish } from '@/pdf/publish/publish';
import type { Source } from '@/model/source';

import { FakeObjectStore } from '../../unit/archive/fake-object-store';

const SOURCE_ID = 'PB-990';
const VARIANT = 'english-only' as const;
const ISSUE_IDS = ['1900-01-01_a', '1900-02-01_b', '1900-03-01_c'];
const PIN_REF = 'a'.repeat(40);
const SNAPSHOT_SHORT = 'aaaaaaaa';
const CDN_BASE = 'https://cdn.example.test';
const PAGE_COUNT = 20;
const RIGHTS_BASIS = '1881 imprint; French public domain';

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
          title: 'Test Source',
          kind: 'periodical' as const,
          ark: 'ark:/12148/test-source',
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

/** SHA-256 hex digest of `bytes`, computed independently of `sha256OfFile`. */
function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function versionedKeyFor(issueId: string): string {
  return `editions/${VARIANT}/${SOURCE_ID}/${issueId}__${SNAPSHOT_SHORT}.pdf`;
}

let tmpRoot: string;
let sourcesDir: string;
let publicationsDir: string;
let outDir: string;
let store: FakeObjectStore;
let commit: ReturnType<typeof vi.fn>;
const issueBytes = new Map<string, Buffer>();

beforeAll(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'corpus-print-pdf-publish-integration-'));
  sourcesDir = path.join(tmpRoot, 'bibliography', 'sources');
  publicationsDir = path.join(tmpRoot, 'bibliography', 'publications');
  outDir = path.join(tmpRoot, 'build', 'pdf');

  // Authored SSOT: a minimal Source cleared by the rights gate.
  const source: Source = {
    sourceId: SOURCE_ID,
    titles: [{ text: 'Test Source', role: 'canonical' }],
    kind: 'periodical',
    identifiers: [],
    rights: { status: 'public-domain', basis: RIGHTS_BASIS },
  };
  mkdirSync(sourcesDir, { recursive: true });
  writeSourceFile(sourcesDir, { source, records: [] });

  // Pre-built PDFs + matching <issueId>.input.json (what `pdf:build` writes).
  const sourceOutDir = path.join(outDir, SOURCE_ID);
  mkdirSync(sourceOutDir, { recursive: true });
  for (const issueId of ISSUE_IDS) {
    const bytes = Buffer.from(`%PDF-1.4 stub content for ${issueId}\n`, 'utf-8');
    issueBytes.set(issueId, bytes);
    writeFileSync(path.join(sourceOutDir, `${issueId}.pdf`), bytes);

    const pages = [
      { recto: { machineAssist: MACHINE_ASSIST } },
      ...Array.from({ length: PAGE_COUNT - 1 }, () => ({})),
    ];
    writeFileSync(
      path.join(sourceOutDir, `${issueId}.input.json`),
      JSON.stringify({ pages }),
      'utf-8',
    );
  }

  store = new FakeObjectStore();
  commit = vi.fn();
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('publish() integration (T015, SC-001): end-to-end confirm pipeline', () => {
  it('dry-run (confirm: false) plans without writing to the store or the SSOT', async () => {
    const result = await publish({
      sourceId: SOURCE_ID,
      variant: VARIANT,
      confirm: false,
      outDir,
      sourcesDir,
      publicationsDir,
      store,
      clock: fixedClock,
      pinReader,
      corpusSnapshotReader,
      cdnBase: CDN_BASE,
      commit,
      log: () => {},
    });

    expect(result.mode).toBe('dry-run');
    expect(result.ok).toBe(true);
    expect(result.published).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.planned).toHaveLength(ISSUE_IDS.length);

    // Nothing written: the store is empty and the SSOT carries no publications.
    expect(store.size).toBe(0);
    const loaded = loadSourceFile(path.join(sourcesDir, `${SOURCE_ID}.yml`));
    expect(loaded.source.publications).toBeUndefined();
    expect(commit).not.toHaveBeenCalled();
  });

  it('confirm: true publishes every issue, uploads bytes, records SSOT + manifest, and commits (G-5, FR-008)', async () => {
    const result = await publish({
      sourceId: SOURCE_ID,
      variant: VARIANT,
      confirm: true,
      outDir,
      sourcesDir,
      publicationsDir,
      store,
      clock: fixedClock,
      pinReader,
      corpusSnapshotReader,
      cdnBase: CDN_BASE,
      warm: false,
      commit,
      log: () => {},
    });

    // 1. published === issueCount, zero failures.
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('confirm');
    expect(result.published).toBe(ISSUE_IDS.length);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);

    // 2. Every issue's bytes are in the FakeObjectStore at its versioned key,
    // with a matching sha256.
    for (const issueId of ISSUE_IDS) {
      const key = versionedKeyFor(issueId);
      expect(store.has(key)).toBe(true);
      const stored = await store.get(key);
      const bytes = issueBytes.get(issueId);
      if (bytes === undefined) {
        throw new Error(`test bug: no fixture bytes recorded for ${issueId}`);
      }
      expect(Buffer.from(stored)).toEqual(bytes);
      const head = await store.head(key);
      expect(head.sha256).toBe(sha256Hex(bytes));
    }

    // 3. The source YAML now has a publications[] entry with the right
    // variant/snapshotShort/cdnBase/rightsBasis and a manifest.manifestPath.
    const loaded = loadSourceFile(path.join(sourcesDir, `${SOURCE_ID}.yml`));
    expect(loaded.source.publications).toHaveLength(1);
    const publication = loaded.source.publications?.[0];
    if (publication === undefined) {
      throw new Error('test bug: publication entry missing after confirm publish');
    }
    expect(publication.variant).toBe(VARIANT);
    expect(publication.snapshotShort).toBe(SNAPSHOT_SHORT);
    expect(publication.snapshot).toBe(PIN_REF);
    expect(publication.cdnBase).toBe(CDN_BASE);
    expect(publication.rightsBasis).toBe(RIGHTS_BASIS);
    expect(publication.keyScheme).toBe('versioned');
    expect(publication.machineAssist).toEqual(MACHINE_ASSIST);
    expect(publication.manifest.manifestPath).toBe(
      `bibliography/publications/${SOURCE_ID}-${VARIANT}-${SNAPSHOT_SHORT}.yml`,
    );
    expect(publication.manifest.issueCount).toBe(ISSUE_IDS.length);

    // 4. The manifest file exists and lists every issue with
    // {issueId, url, key, sha256, pages}; issueCount === issues.length; each
    // url === cdnBase + '/' + key (G-5 / SC-001).
    const manifestPath = path.join(publicationsDir, `${SOURCE_ID}-${VARIANT}-${SNAPSHOT_SHORT}.yml`);
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = parseYaml(readFileSync(manifestPath, 'utf-8')) as {
      sourceId: string;
      variant: string;
      issues: { issueId: string; url: string; key: string; sha256: string; pages: number }[];
    };
    expect(manifest.sourceId).toBe(SOURCE_ID);
    expect(manifest.issues).toHaveLength(ISSUE_IDS.length);
    for (const issueId of ISSUE_IDS) {
      const entry = manifest.issues.find((i) => i.issueId === issueId);
      expect(entry).toBeDefined();
      if (entry === undefined) {
        continue;
      }
      const key = versionedKeyFor(issueId);
      expect(entry.key).toBe(key);
      expect(entry.url).toBe(`${CDN_BASE}/${key}`);
      expect(entry.sha256).toBe(sha256Hex(issueBytes.get(issueId) as Buffer));
      expect(entry.pages).toBe(PAGE_COUNT);
    }

    // 5. The commit spy was invoked (FR-008).
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('a second confirm run is idempotent: zero new uploads, unchanged SSOT (SC-004)', async () => {
    const sizeBefore = store.size;
    const ssotBefore = readFileSync(path.join(sourcesDir, `${SOURCE_ID}.yml`), 'utf-8');

    const result = await publish({
      sourceId: SOURCE_ID,
      variant: VARIANT,
      confirm: true,
      outDir,
      sourcesDir,
      publicationsDir,
      store,
      clock: fixedClock,
      pinReader,
      corpusSnapshotReader,
      cdnBase: CDN_BASE,
      warm: false,
      commit,
      log: () => {},
    });

    expect(result.ok).toBe(true);
    expect(result.published).toBe(0);
    expect(result.skipped).toBe(ISSUE_IDS.length);
    expect(result.failed).toBe(0);

    // No new objects were PUT (the store's object count is unchanged).
    expect(store.size).toBe(sizeBefore);

    // The re-upserted publication is structurally identical, so the source
    // YAML re-serializes to the same bytes (deterministic serialization).
    const ssotAfter = readFileSync(path.join(sourcesDir, `${SOURCE_ID}.yml`), 'utf-8');
    expect(ssotAfter).toBe(ssotBefore);
  });
});
