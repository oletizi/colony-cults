/**
 * Unit test (T026, spec 008-edition-publishing): a focused proof of publish
 * idempotency (SC-004) -- narrower than the integration test's end-to-end
 * exercise: an unchanged whole `publish({confirm:true})` re-run performs
 * ZERO uploads AND leaves the SSOT (source YAML + manifest file) byte-
 * identical to the first run's output.
 *
 * Mirrors the integration fixture approach (tests/integration/publish/
 * publish.test.ts): a temp-dir fixture with fake ArchivePinReader /
 * CorpusSnapshotReader / clock, a valid `rights: public-domain` Source
 * written via `writeSourceFile`, and pre-built `<issueId>.pdf` +
 * `<issueId>.input.json` fixtures (what `pdf:build` writes). Uses source id
 * `PB-990` -- the loader's `SOURCE_ID_PATTERN` rejects arbitrary ids. Counts
 * `ObjectStore.put` calls via a counting `FakeObjectStore` subclass, the
 * same pattern as `tests/unit/archive/store-idempotent.test.ts`'s
 * `CountingStore`.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { PutOptions } from '@/archive/object-store';
import { writeSourceFile } from '@/bibliography/source-writer';
import type { ArchivePinReader, CorpusSnapshotReader } from '@/pdf/load/edition';
import type { MachineAssistLabel } from '@/pdf/model';
import { publish, type PublishResult } from '@/pdf/publish/publish';
import type { Source } from '@/model/source';

import { FakeObjectStore } from '../archive/fake-object-store';

const SOURCE_ID = 'PB-990';
const VARIANT = 'english-only' as const;
const ISSUE_IDS = ['1900-01-01_a', '1900-02-01_b', '1900-03-01_c'];
const PIN_REF = 'b'.repeat(40);
const SNAPSHOT_SHORT = 'bbbbbbbb';
const CDN_BASE = 'https://cdn.example.test';
const PAGE_COUNT = 12;
const RIGHTS_BASIS = 'idempotency test public-domain basis';

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
          title: 'Idempotency Test Source',
          kind: 'periodical' as const,
          ark: 'ark:/12148/idempotent-test',
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

/**
 * Counting FakeObjectStore: records how many times `put` (the only bytes-
 * writing primitive `publish()`'s upload path uses) was invoked, so the test
 * can prove the second, unchanged run performs ZERO new uploads.
 */
class CountingStore extends FakeObjectStore {
  putCount = 0;

  override async put(key: string, bytes: Uint8Array, options: PutOptions): Promise<void> {
    this.putCount += 1;
    await super.put(key, bytes, options);
  }
}

let tmpRoot: string;
let sourcesDir: string;
let publicationsDir: string;
let outDir: string;
let store: CountingStore;
let commit: ReturnType<typeof vi.fn>;

beforeAll(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'corpus-print-pdf-publish-idempotent-'));
  sourcesDir = path.join(tmpRoot, 'bibliography', 'sources');
  publicationsDir = path.join(tmpRoot, 'bibliography', 'publications');
  outDir = path.join(tmpRoot, 'build', 'pdf');

  // Authored SSOT: a minimal Source cleared by the rights gate.
  const source: Source = {
    sourceId: SOURCE_ID,
    titles: [{ text: 'Idempotency Test Source', role: 'canonical' }],
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
    const bytes = Buffer.from(`%PDF-1.4 idempotent stub content for ${issueId}\n`, 'utf-8');
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

  store = new CountingStore();
  commit = vi.fn();
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function runPublish(): Promise<PublishResult> {
  return publish({
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
}

const sourceYamlPath = (): string => path.join(sourcesDir, `${SOURCE_ID}.yml`);
const manifestFilePath = (): string =>
  path.join(publicationsDir, `${SOURCE_ID}-${VARIANT}-${SNAPSHOT_SHORT}.yml`);

describe('publish() idempotency (T026, SC-004): unchanged re-run is a zero-upload, byte-identical no-op', () => {
  it('first confirm run publishes every issue and uploads exactly once per issue', async () => {
    const result = await runPublish();

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('confirm');
    expect(result.published).toBe(ISSUE_IDS.length);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(store.putCount).toBe(ISSUE_IDS.length);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('an identical second confirm run performs zero uploads and leaves the SSOT + manifest byte-identical', async () => {
    const putCountBefore = store.putCount;
    const sourceYamlBefore = readFileSync(sourceYamlPath(), 'utf-8');
    const manifestBefore = readFileSync(manifestFilePath(), 'utf-8');

    const result = await runPublish();

    // Core SC-004 assertions: nothing new was published, everything was
    // recognized as already present (idempotent skip), and no failures.
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('confirm');
    expect(result.published).toBe(0);
    expect(result.skipped).toBe(ISSUE_IDS.length);
    expect(result.failed).toBe(0);

    // Zero new bytes were PUT to the object store.
    expect(store.putCount).toBe(putCountBefore);

    // The SSOT source YAML and the manifest file re-serialize to
    // byte-identical content (deterministic serialization of the same
    // structural data -- SC-004).
    const sourceYamlAfter = readFileSync(sourceYamlPath(), 'utf-8');
    const manifestAfter = readFileSync(manifestFilePath(), 'utf-8');
    expect(sourceYamlAfter).toBe(sourceYamlBefore);
    expect(manifestAfter).toBe(manifestBefore);

    // Actual `commit` behavior on an unchanged re-run: `publish()`'s
    // `runConfirm` records+commits whenever `uploads.length > 0` -- and
    // idempotent-skip issues are still pushed onto `uploads` (only
    // attributable per-issue FAILURES are excluded). So a fully-skipped,
    // zero-failure re-run still re-upserts the (structurally identical)
    // publication and calls `commit` again -- it does NOT special-case
    // "nothing to commit" when every issue was a skip rather than an
    // upload. This assertion documents that actual behavior rather than
    // the (incorrect) assumption that a skip-only run calls `commit` zero
    // times.
    expect(commit).toHaveBeenCalledTimes(2);
  });
});
