/**
 * Unit test (T027, spec 008-edition-publishing): a focused proof of
 * immutable re-publishing (SC-005 / FR-009). A changed rebuild -- new PDF
 * bytes AND a new pinned snapshot ref -- publishes as a NEW versioned entry
 * (`__<snapshotShort>.pdf`) while the PRIOR version's artifact bytes and
 * `publications[]` entry are left completely untouched: the versioned key
 * scheme (`@/pdf/publish/key`'s `versionedKey`) embeds the `snapshotShort`
 * (`@/pdf/publish/version`'s `snapshotShort`, the first 8 hex chars of the
 * pinned ref read via the injected `ArchivePinReader`), so a rebuild against
 * a different pin lands at a different key rather than overwriting the old
 * one.
 *
 * Fixture approach mirrors `tests/integration/publish/publish.test.ts`: a
 * temp-dir `sourcesDir`/`publicationsDir`/`outDir`, a `rights: public-domain`
 * Source written via `writeSourceFile`, pre-built `<issueId>.pdf` +
 * `<issueId>.input.json` fixtures, and a `FakeObjectStore` in place of a real
 * backend. `pinReader` is a mutable fake so the snapshot ref (and therefore
 * the derived `snapshotShort`/key) can change between the two `publish()`
 * runs, simulating a rebuild.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { loadSourceFile } from '@/bibliography/load';
import { writeSourceFile } from '@/bibliography/source-writer';
import type { ArchivePinReader, CorpusSnapshotReader } from '@/pdf/load/edition';
import type { MachineAssistLabel } from '@/pdf/model';
import { publish } from '@/pdf/publish/publish';
import type { Source } from '@/model/source';

import { FakeObjectStore } from '../archive/fake-object-store';

const SOURCE_ID = 'PB-990';
const VARIANT = 'english-only' as const;
const ISSUE_IDS = ['1900-01-01_a', '1900-02-01_b'];
const CDN_BASE = 'https://cdn.example.test';
const PAGE_COUNT = 12;
const RIGHTS_BASIS = '1881 imprint; French public domain';

const PIN_REF_A = 'a'.repeat(40);
const SNAPSHOT_SHORT_A = 'aaaaaaaa';
const PIN_REF_B = 'b'.repeat(40);
const SNAPSHOT_SHORT_B = 'bbbbbbbb';

const MACHINE_ASSIST: MachineAssistLabel = {
  engine: 'claude-code-cli',
  model: 'claude-sonnet-5',
  retrieved: '2026-07-12T00:00:00.000Z',
};

const FIXED_NOW = new Date('2026-07-12T09:30:00.000Z');
const fixedClock = (): Date => FIXED_NOW;

/** Mutable fake pin reader: the ref returned changes between publish() runs. */
let currentPinRef = PIN_REF_A;
const pinReader: ArchivePinReader = { read: () => currentPinRef };

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
          language: 'French' as const,
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

function versionedKeyFor(issueId: string, snapshotShort: string): string {
  return `editions/${VARIANT}/${SOURCE_ID}/${issueId}__${snapshotShort}.pdf`;
}

/** (Re)write the fixture `<issueId>.pdf` + `<issueId>.input.json` under `sourceOutDir`. */
function writeIssueFixtures(sourceOutDir: string, contentTag: string): void {
  for (const issueId of ISSUE_IDS) {
    const bytes = Buffer.from(`%PDF-1.4 ${contentTag} content for ${issueId}\n`, 'utf-8');
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
}

describe('publish() immutable re-publishing (T027, SC-005 / FR-009)', () => {
  it('a changed rebuild publishes a NEW versioned entry without touching the prior version', async () => {
    const tmpRoot = mkdtempSync(path.join(tmpdir(), 'corpus-print-pdf-publish-immutable-'));
    try {
      const sourcesDir = path.join(tmpRoot, 'bibliography', 'sources');
      const publicationsDir = path.join(tmpRoot, 'bibliography', 'publications');
      const outDir = path.join(tmpRoot, 'build', 'pdf');
      const sourceOutDir = path.join(outDir, SOURCE_ID);
      mkdirSync(sourceOutDir, { recursive: true });

      const source: Source = {
        sourceId: SOURCE_ID,
        titles: [{ text: 'Test Source', role: 'canonical' }],
        kind: 'periodical',
        identifiers: [],
        rights: { status: 'public-domain', basis: RIGHTS_BASIS },
      };
      mkdirSync(sourcesDir, { recursive: true });
      writeSourceFile(sourcesDir, { source, records: [] });

      const store = new FakeObjectStore();
      const commit = vi.fn();

      // --- Run 1: initial publish at pin ref A. ---
      currentPinRef = PIN_REF_A;
      writeIssueFixtures(sourceOutDir, 'run1');

      const result1 = await publish({
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

      expect(result1.ok).toBe(true);
      expect(result1.published).toBe(ISSUE_IDS.length);
      expect(result1.failed).toBe(0);

      // Capture run-1 object bytes at each __aaaaaaaa.pdf key.
      const run1Bytes = new Map<string, Buffer>();
      for (const issueId of ISSUE_IDS) {
        const key = versionedKeyFor(issueId, SNAPSHOT_SHORT_A);
        expect(store.has(key)).toBe(true);
        run1Bytes.set(key, Buffer.from(await store.get(key)));
      }

      const loadedAfterRun1 = loadSourceFile(path.join(sourcesDir, `${SOURCE_ID}.yml`));
      expect(loadedAfterRun1.source.publications).toHaveLength(1);
      const run1Publication = loadedAfterRun1.source.publications?.[0];
      if (run1Publication === undefined) {
        throw new Error('test bug: run-1 publication entry missing');
      }
      expect(run1Publication.snapshotShort).toBe(SNAPSHOT_SHORT_A);

      // --- Run 2: simulate a changed rebuild -- new PDF bytes AND a new pin ref. ---
      currentPinRef = PIN_REF_B;
      writeIssueFixtures(sourceOutDir, 'run2-CHANGED');

      const result2 = await publish({
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

      // Run 2 did NOT throw and succeeded cleanly: a different key, not an
      // immutability conflict.
      expect(result2.ok).toBe(true);
      expect(result2.published).toBe(ISSUE_IDS.length);
      expect(result2.failed).toBe(0);

      // The store now has BOTH the run-1 (__aaaaaaaa) and run-2 (__bbbbbbbb) keys.
      for (const issueId of ISSUE_IDS) {
        const keyA = versionedKeyFor(issueId, SNAPSHOT_SHORT_A);
        const keyB = versionedKeyFor(issueId, SNAPSHOT_SHORT_B);
        expect(store.has(keyA)).toBe(true);
        expect(store.has(keyB)).toBe(true);

        // The run-1 bytes are UNCHANGED: the old version was never overwritten.
        const bytesA = Buffer.from(await store.get(keyA));
        const expectedA = run1Bytes.get(keyA);
        if (expectedA === undefined) {
          throw new Error(`test bug: no captured run-1 bytes for ${keyA}`);
        }
        expect(bytesA).toEqual(expectedA);

        // The run-2 bytes are the NEW (changed) content, distinct from run 1.
        const bytesB = Buffer.from(await store.get(keyB));
        expect(bytesB).not.toEqual(expectedA);
      }

      // The source's publications[] now has TWO entries: the original
      // (snapshotShort 'aaaaaaaa') is unchanged; a new entry (snapshotShort
      // 'bbbbbbbb') was appended.
      const loadedAfterRun2 = loadSourceFile(path.join(sourcesDir, `${SOURCE_ID}.yml`));
      expect(loadedAfterRun2.source.publications).toHaveLength(2);

      const publicationA = loadedAfterRun2.source.publications?.find(
        (p) => p.snapshotShort === SNAPSHOT_SHORT_A,
      );
      const publicationB = loadedAfterRun2.source.publications?.find(
        (p) => p.snapshotShort === SNAPSHOT_SHORT_B,
      );
      if (publicationA === undefined || publicationB === undefined) {
        throw new Error('test bug: expected both snapshotShort A and B publication entries');
      }
      expect(publicationA).toEqual(run1Publication);
      expect(publicationB.snapshot).toBe(PIN_REF_B);
      expect(publicationB.snapshotShort).toBe(SNAPSHOT_SHORT_B);
      expect(publicationB.variant).toBe(VARIANT);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
