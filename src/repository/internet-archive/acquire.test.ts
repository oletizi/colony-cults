/**
 * Tests for {@link InternetArchiveAdapter.acquire} (T025) -- the full
 * fetch -> quality-gate -> fidelity -> master-production -> upload pipeline
 * (specs/013-archiveorg-acquisition-path,
 * contracts/internet-archive-adapter.md `acquire` section). The orchestration
 * lives in `@/repository/internet-archive/acquire`; the adapter delegates to
 * it. These tests drive it through the adapter's public `acquire`.
 *
 * NO real network, poppler, unzip, magick, or B2 is ever touched: every
 * dependency is a FAKE injected via the adapter constructor. Staging + snapshot
 * writes land under unique `mkdtemp` directories cleaned up in `afterEach`.
 *
 * Real-fixture grounding: the de Groote "Nouvelle-France" item
 * (`__fixtures__/metadata-nouvellefrancec00groogoog.json` +
 * `__fixtures__/scandata-nouvellefrancec00groogoog.xml`).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ExecResult } from '@/ocr/exec';
import type { CommandRunner, PageImageInfo, PopplerRunner } from '@/pdf/poppler/runner';
import type { ObjectHead, ObjectStore, PutOptions } from '@/archive/object-store';
import type { QualityGate, QualityGateInput } from '@/repository/internet-archive/quality-gate';
import type { QualityAssessment } from '@/model/quality-assessment';
import type { RepositoryRecord } from '@/model/repository-record';
import { stagingDir } from '@/repository/internet-archive/staging';
import { InternetArchiveAdapter } from '@/repository/internet-archive/adapter';

const ITEM_ID = 'nouvellefrancec00groogoog';

const fixturesDir = join(process.cwd(), 'src', 'repository', 'internet-archive', '__fixtures__');
const METADATA_TEXT = readFileSync(join(fixturesDir, `metadata-${ITEM_ID}.json`), 'utf-8');
const SCANDATA_TEXT = readFileSync(join(fixturesDir, `scandata-${ITEM_ID}.xml`), 'utf-8');

const METADATA_URL = `https://archive.org/metadata/${ITEM_ID}`;
const PDF_URL = `https://archive.org/download/${ITEM_ID}/${ITEM_ID}.pdf`;
const SCANDATA_URL = `https://archive.org/download/${ITEM_ID}/${ITEM_ID}_scandata.xml`;
const IMAGE_SET_URL = `https://archive.org/download/${ITEM_ID}/${ITEM_ID}_tif.zip`;

const NOW = '2026-07-16T00:00:00.000Z';
const APPROVED_RANGE = { start: 4, end: 8 } as const;

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface ClientCall {
  method: 'getText' | 'getBytes';
  url: string;
}

/** A fake fetch client whose responses are keyed by URL, recording every call. */
function makeClient(
  textByUrl: Readonly<Record<string, string>>,
  bytesByUrl: Readonly<Record<string, Uint8Array>>,
  calls: ClientCall[],
) {
  const client = {
    getText: async (url: string): Promise<string> => {
      calls.push({ method: 'getText', url });
      const text = textByUrl[url];
      if (text === undefined) {
        throw new Error(`fakeClient: no text fixture for ${url}`);
      }
      return text;
    },
    getBytes: async (url: string): Promise<Uint8Array> => {
      calls.push({ method: 'getBytes', url });
      const bytes = bytesByUrl[url];
      if (bytes === undefined) {
        throw new Error(`fakeClient: no bytes fixture for ${url}`);
      }
      return bytes;
    },
  };
  return client;
}

/** Row for a page whose single image is `edge`x(edge*0.7) -- longest edge == `edge`. */
function imageRow(page: number, edge: number): PageImageInfo {
  return { page, num: 0, width: Math.round(edge * 0.7), height: edge, objectId: `obj-${page}` };
}

interface PopplerCall {
  fn: 'info' | 'imagesList' | 'extractImage' | 'rasterise';
}

/**
 * A fake poppler runner. `imagesList` returns author-supplied rows (drives both
 * the fidelity probe and, on the PDF path, the per-leaf routing);
 * `extractImage` / `rasterise` WRITE a small unique file at `<outPrefix>.jpg`
 * so the orchestrator can read the produced master's bytes.
 */
function makePoppler(rows: PageImageInfo[], pages: number, calls: PopplerCall[]): PopplerRunner {
  return {
    info: async (): Promise<{ pages: number }> => {
      calls.push({ fn: 'info' });
      return { pages };
    },
    imagesList: async (): Promise<PageImageInfo[]> => {
      calls.push({ fn: 'imagesList' });
      return rows;
    },
    extractImage: async (_pdf: string, page: number, outPrefix: string): Promise<void> => {
      calls.push({ fn: 'extractImage' });
      await mkdir(dirname(outPrefix), { recursive: true });
      await writeFile(`${outPrefix}.jpg`, new Uint8Array([0xff, 0xd8, page, 0xff, 0xd9]));
    },
    rasterise: async (_pdf: string, page: number, _dpi: number, outPrefix: string): Promise<void> => {
      calls.push({ fn: 'rasterise' });
      await mkdir(dirname(outPrefix), { recursive: true });
      await writeFile(`${outPrefix}.jpg`, new Uint8Array([0xff, 0xd8, page, 0x01, 0xff, 0xd9]));
    },
  };
}

interface PutCall {
  key: string;
  sha256: string;
  byteLength: number;
  contentType?: string;
}

type HeadMode = 'absent' | 'match' | 'mismatch';

const SHA_RE = /[0-9a-f]{64}/;

/** A fake object store: `put` records; `head` behavior is configurable per mode. */
function makeObjectStore(mode: HeadMode, puts: PutCall[]): ObjectStore {
  return {
    head: async (key: string): Promise<ObjectHead> => {
      if (mode === 'absent') {
        return { exists: false };
      }
      if (mode === 'match') {
        // The sha256 is embedded in every key, so echo it back as a match.
        const embedded = key.match(SHA_RE);
        if (embedded === null) {
          throw new Error(`fakeObjectStore: key has no embedded sha256: ${key}`);
        }
        return { exists: true, sha256: embedded[0] };
      }
      return { exists: true, sha256: '0'.repeat(64) };
    },
    put: async (key: string, bytes: Uint8Array, options: PutOptions): Promise<void> => {
      puts.push({
        key,
        sha256: options.sha256,
        byteLength: bytes.byteLength,
        contentType: options.contentType,
      });
    },
    get: async (): Promise<Uint8Array> => {
      throw new Error('fakeObjectStore: get is not used by acquire.');
    },
    attachSha256Metadata: async (): Promise<void> => {
      throw new Error('fakeObjectStore: attachSha256Metadata is not used by acquire.');
    },
  };
}

/** A fake quality gate that echoes the assessed checksum + proposed range back. */
function makeQualityGate(status: 'sound' | 'unsound'): QualityGate {
  return {
    assess: async (input: QualityGateInput): Promise<QualityAssessment> => ({
      status,
      assessedBy: 'operator',
      assessedAt: NOW,
      sourceFileChecksum: input.sourceFileChecksum,
      expectedPageCount: input.expectedPageCount,
      observedPageCount: input.observedPageCount,
      approvedLeafRange: input.proposedRange,
      notes: 'test fixture assessment',
    }),
  };
}

const OK: ExecResult = { stdout: '', stderr: '', exitCode: 0 };

interface RunnerCall {
  command: string;
  args: string[];
}

/** A fake `unzip` runner that simulates extraction by writing the expected tif entries. */
function makeUnzip(leaves: number[], calls: RunnerCall[]): CommandRunner {
  return async (command: string, args: string[]): Promise<ExecResult> => {
    calls.push({ command, args });
    // args = ['-o', <zip>, '-d', <outDir>]
    const outDir = args[3];
    const setDir = join(outDir, `${ITEM_ID}_tif`);
    await mkdir(setDir, { recursive: true });
    for (const leaf of leaves) {
      await writeFile(
        join(setDir, `${ITEM_ID}_${String(leaf).padStart(4, '0')}.tif`),
        new Uint8Array([0x49, 0x49, leaf]),
      );
    }
    return OK;
  };
}

/** A fake `magick`/`convert` runner that writes a jpeg at its output path. */
function makeConvert(calls: RunnerCall[]): CommandRunner {
  return async (command: string, args: string[]): Promise<ExecResult> => {
    calls.push({ command, args });
    // args = [<input>, <jpegPath>]
    const jpegPath = args[1];
    await mkdir(dirname(jpegPath), { recursive: true });
    await writeFile(jpegPath, new Uint8Array([0xff, 0xd8, args[0].length & 0xff, 0xff, 0xd9]));
    return OK;
  };
}

// ---------------------------------------------------------------------------
// Fixtures / harness
// ---------------------------------------------------------------------------

let stagingRoot: string;
let baseDir: string;

beforeEach(async () => {
  stagingRoot = await mkdtemp(join(tmpdir(), 'ia-acquire-staging-'));
  baseDir = await mkdtemp(join(tmpdir(), 'ia-acquire-base-'));
});

afterEach(async () => {
  await rm(stagingRoot, { recursive: true, force: true });
  await rm(baseDir, { recursive: true, force: true });
});

function pdRecord(overrides: Partial<RepositoryRecord> = {}): RepositoryRecord {
  return {
    sourceId: 'PB-DEGROOTE',
    sourceArchive: 'Internet Archive',
    identifiers: [{ type: 'ia-item', value: ITEM_ID }],
    status: 'pending',
    rightsAssessment: {
      rightsStatus: 'public-domain',
      rightsBasis: 'Published 1880; well out of copyright term.',
      assessedBy: 'operator',
      assessedAt: NOW,
    },
    ...overrides,
  };
}

/** Assemble an adapter with a full set of fakes for the PDF (faithful) path. */
function pdfPathAdapter(opts: {
  status?: 'sound' | 'unsound';
  headMode?: HeadMode;
  clientCalls?: ClientCall[];
  puts?: PutCall[];
  popplerCalls?: PopplerCall[];
}): InternetArchiveAdapter {
  const clientCalls = opts.clientCalls ?? [];
  const puts = opts.puts ?? [];
  const popplerCalls = opts.popplerCalls ?? [];
  const client = makeClient(
    { [METADATA_URL]: METADATA_TEXT, [SCANDATA_URL]: SCANDATA_TEXT },
    { [PDF_URL]: new TextEncoder().encode('a faithful de Groote source PDF') },
    clientCalls,
  );
  // Faithful: pdf longest edge ~2300 vs scan ~2300 -> ratio ~1.0 -> 'pdf'.
  const rows = [4, 5, 6, 7, 8].map((page) => imageRow(page, 2300));
  return new InternetArchiveAdapter({
    client,
    poppler: makePoppler(rows, 8, popplerCalls),
    objectStore: makeObjectStore(opts.headMode ?? 'absent', puts),
    qualityGate: makeQualityGate(opts.status ?? 'sound'),
    unzip: makeUnzip([], []),
    convert: makeConvert([]),
    stagingRoot,
    baseDir,
    now: () => NOW,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('acquire -- happy path (PDF, faithful fidelity)', () => {
  it('produces one repository-source PDF + N page-masters and puts each', async () => {
    const puts: PutCall[] = [];
    const record = pdRecord();
    const adapter = pdfPathAdapter({ puts });

    const result = await adapter.acquire(record, {});

    expect(result.repositoryRecordId).toBe('PB-DEGROOTE @ Internet Archive');
    expect(result.complete).toBe(true);
    expect(result.reconciliationRequired).toBe(true);
    expect(result.metadataSnapshot.raw).toBe(METADATA_TEXT);
    expect(result.metadataSnapshot.retrievedAt).toBe(NOW);

    // 1 repository-source + 5 page-masters (approved leaves 4..8).
    expect(result.assets).toHaveLength(6);
    const source = result.assets.filter((a) => a.role === 'repository-source');
    const pageMasters = result.assets.filter((a) => a.role === 'page-master');
    expect(source).toHaveLength(1);
    expect(pageMasters).toHaveLength(5);
    expect(source[0].mediaType).toBe('application/pdf');
    expect(pageMasters.every((a) => a.mediaType === 'image/png')).toBe(true);
    expect(pageMasters.map((a) => a.sequence)).toEqual([1, 2, 3, 4, 5]);

    // Exactly one PUT per asset (nothing pre-existing in this store).
    expect(puts).toHaveLength(6);
    for (const asset of result.assets) {
      const put = puts.find((p) => p.key === asset.objectStoreKey);
      expect(put).toBeDefined();
      expect(put?.sha256).toBe(asset.checksum);
      expect(put?.byteLength).toBe(asset.byteLength);
    }
  });

  it('persists the operator quality assessment onto the record', async () => {
    const record = pdRecord();
    const adapter = pdfPathAdapter({});

    await adapter.acquire(record, {});

    expect(record.qualityAssessment).toBeDefined();
    expect(record.qualityAssessment?.status).toBe('sound');
    expect(record.qualityAssessment?.approvedLeafRange).toEqual(APPROVED_RANGE);
    expect(record.qualityAssessment?.expectedPageCount).toBe(8); // 8 scandata leaves
    expect(record.qualityAssessment?.observedPageCount).toBe(8); // poppler.info
    // Excluded front matter (leaves 1-3) recorded on success.
    expect(record.excludedLeaves?.map((e) => e.leaf)).toEqual([1, 2, 3]);
  });
});

describe('acquire -- rights gate (IA-INV-B, fail-closed before any fetch)', () => {
  for (const status of ['restricted', 'uncertain'] as const) {
    it(`throws for rightsStatus "${status}" and never touches the client`, async () => {
      const clientCalls: ClientCall[] = [];
      const puts: PutCall[] = [];
      const record = pdRecord({
        rightsAssessment: {
          rightsStatus: status,
          rightsBasis: 'test',
          assessedBy: 'operator',
          assessedAt: NOW,
        },
      });
      const adapter = pdfPathAdapter({ clientCalls, puts });

      await expect(adapter.acquire(record, {})).rejects.toThrow(new RegExp(status));
      expect(clientCalls).toHaveLength(0);
      expect(puts).toHaveLength(0);
    });
  }

  it('throws when no rightsAssessment is present at all', async () => {
    const clientCalls: ClientCall[] = [];
    const record = pdRecord({ rightsAssessment: undefined });
    const adapter = pdfPathAdapter({ clientCalls });

    await expect(adapter.acquire(record, {})).rejects.toThrow();
    expect(clientCalls).toHaveLength(0);
  });
});

describe('acquire -- quality gate fail-closed (IA-INV-C)', () => {
  it('throws on an unsound assessment, writes nothing, and retains staging', async () => {
    const puts: PutCall[] = [];
    const record = pdRecord();
    const adapter = pdfPathAdapter({ status: 'unsound', puts });

    await expect(adapter.acquire(record, {})).rejects.toThrow(/sound/i);
    expect(puts).toHaveLength(0);

    // Staging is retained on a rejected quality gate (D-8).
    const dir = stagingDir(stagingRoot, ITEM_ID);
    const info = await stat(dir);
    expect(info.isDirectory()).toBe(true);
    const staged = await stat(join(dir, 'source.pdf'));
    expect(staged.isFile()).toBe(true);
  });
});

describe('acquire -- idempotency (INV-E)', () => {
  it('skips PUT when the object already exists with a matching checksum', async () => {
    const puts: PutCall[] = [];
    const record = pdRecord();
    const adapter = pdfPathAdapter({ headMode: 'match', puts });

    const result = await adapter.acquire(record, {});

    expect(result.assets).toHaveLength(6);
    expect(result.complete).toBe(true);
    expect(puts).toHaveLength(0); // every asset already present -> no PUT
  });

  it('throws when a keyed object exists with a mismatched checksum (remote change)', async () => {
    const puts: PutCall[] = [];
    const record = pdRecord();
    const adapter = pdfPathAdapter({ headMode: 'mismatch', puts });

    await expect(adapter.acquire(record, {})).rejects.toThrow(/checksum|mismatch|changed/i);
    expect(puts).toHaveLength(0);
  });
});

describe('acquire -- fidelity image-set branch (FR-009 / US5 AC-2)', () => {
  it('stages + explodes the image set (unzip/convert) instead of extracting the PDF', async () => {
    const puts: PutCall[] = [];
    const unzipCalls: RunnerCall[] = [];
    const convertCalls: RunnerCall[] = [];
    const popplerCalls: PopplerCall[] = [];
    const record = pdRecord();

    const client = makeClient(
      { [METADATA_URL]: METADATA_TEXT, [SCANDATA_URL]: SCANDATA_TEXT },
      {
        [PDF_URL]: new TextEncoder().encode('a materially degraded de Groote PDF'),
        [IMAGE_SET_URL]: new TextEncoder().encode('a fake _tif.zip payload'),
      },
      [],
    );
    // Degraded: pdf longest edge ~1200 vs scan ~2300 -> ratio ~0.52 -> 'image-set'.
    const rows = [4, 5, 6, 7, 8].map((page) => imageRow(page, 1200));
    const adapter = new InternetArchiveAdapter({
      client,
      poppler: makePoppler(rows, 8, popplerCalls),
      objectStore: makeObjectStore('absent', puts),
      qualityGate: makeQualityGate('sound'),
      unzip: makeUnzip([4, 5, 6, 7, 8], unzipCalls),
      convert: makeConvert(convertCalls),
      stagingRoot,
      baseDir,
      now: () => NOW,
    });

    const result = await adapter.acquire(record, {});

    // Image-set path taken: unzip once, convert once per approved leaf.
    expect(unzipCalls).toHaveLength(1);
    expect(convertCalls).toHaveLength(5);
    // PDF-extract path NOT taken: no extractImage/rasterise calls.
    expect(popplerCalls.some((c) => c.fn === 'extractImage' || c.fn === 'rasterise')).toBe(false);

    const pageMasters = result.assets.filter((a) => a.role === 'page-master');
    expect(pageMasters).toHaveLength(5);
    expect(pageMasters.every((a) => a.mediaType === 'image/png')).toBe(true);
    expect(puts).toHaveLength(6);
  });
});

describe('acquire -- asset roles (IA-INV-F)', () => {
  it('preserves exactly one repository-source PDF and the rest are page-masters', async () => {
    const record = pdRecord();
    const adapter = pdfPathAdapter({});

    const result = await adapter.acquire(record, {});

    const roles = result.assets.map((a) => a.role);
    expect(roles.filter((r) => r === 'repository-source')).toHaveLength(1);
    expect(roles.filter((r) => r === 'page-master')).toHaveLength(roles.length - 1);
    const source = result.assets.find((a) => a.role === 'repository-source');
    expect(source?.objectStoreKey).toContain(`internet-archive/${ITEM_ID}/source/`);
    expect(source?.mediaType).toBe('application/pdf');
  });
});

describe('acquire -- dry run (Principle XII / D-11)', () => {
  it('performs no PUT, retains staging, and reports incomplete with no assets', async () => {
    const puts: PutCall[] = [];
    const record = pdRecord();
    const adapter = pdfPathAdapter({ puts });

    const result = await adapter.acquire(record, { dryRun: true });

    expect(puts).toHaveLength(0);
    expect(result.assets).toEqual([]);
    expect(result.complete).toBe(false);
    expect(result.reconciliationRequired).toBe(true);

    // Staging retained for inspection on a dry run.
    const dir = stagingDir(stagingRoot, ITEM_ID);
    const info = await stat(dir);
    expect(info.isDirectory()).toBe(true);
  });
});

describe('acquire -- dependency validation', () => {
  it('throws when an acquire-time dependency is missing', async () => {
    const record = pdRecord();
    // Resolve-only construction (client only) must still build, but acquire fails loud.
    const adapter = new InternetArchiveAdapter({
      client: makeClient({ [METADATA_URL]: METADATA_TEXT }, {}, []),
    });

    await expect(adapter.acquire(record, {})).rejects.toThrow(/dependenc|poppler|objectStore/i);
  });
});
