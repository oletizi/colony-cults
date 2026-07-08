import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FetchClient } from '@/fetch/issue';
import { fetchMonograph, fetchIssue } from '@/fetch/issue';
import { monographDir } from '@/archive/location';
import type { OaiRecordRights, IiifInfo } from '@/gallica/gallica-client';

/**
 * Coverage for T034 (FR-016): a monograph source (a single Gallica document
 * ark, no periodical census) runs through the SAME rights-gated, resumable,
 * guarded per-page pipeline as `fetchIssue`, via `fetchMonograph`, but writes
 * into its flat `books/<slug>/` archive directory rather than a dated issue
 * subdirectory. Driven entirely against an INJECTED FAKE CLIENT (no HTTP, no
 * fixtures, no network) and a temp archive root -- never the real repo, never
 * Gallica.
 */

const DOCUMENT_ARK = 'bpt6kFAKE00001';
const MONOGRAPH_SOURCE_ID = 'PB-P002';
const MONOGRAPH_SLUG = 'nouvelle-france-colonie-libre-port-breton';
const PERIODICAL_SOURCE_ID = 'PB-P001';

const PUBLIC_DOMAIN_RIGHTS: OaiRecordRights = {
  rawResponse: '<oai><dc:rights>domaine public</dc:rights></oai>',
  dcRights: ['domaine public'],
};

const NON_PUBLIC_DOMAIN_RIGHTS: OaiRecordRights = {
  rawResponse: '<oai><dc:rights>copyrighted</dc:rights></oai>',
  dcRights: ['copyrighted'],
};

/** A fully in-memory fake `FetchClient` -- no HTTP, deterministic bytes. */
function fakeClient(options: {
  pageCount: number;
  rights?: OaiRecordRights;
}): FetchClient & { calls: string[] } {
  const { pageCount, rights = PUBLIC_DOMAIN_RIGHTS } = options;
  const calls: string[] = [];
  return {
    calls,
    async oaiRecord(ark: string): Promise<string> {
      calls.push(`oaiRecord:${ark}`);
      return rights.rawResponse;
    },
    async oaiRights(ark: string): Promise<OaiRecordRights> {
      calls.push(`oaiRights:${ark}`);
      return rights;
    },
    async pagination(ark: string): Promise<number> {
      calls.push(`pagination:${ark}`);
      return pageCount;
    },
    async iiifInfo(): Promise<IiifInfo> {
      return { width: 100, height: 100 };
    },
    async iiifImage(ark: string, page: number): Promise<Uint8Array> {
      calls.push(`iiifImage:${ark}:${page}`);
      // Deterministic, page-distinguishing bytes -- not a real JPEG, but the
      // pipeline never inspects image content, only its byte length/hash.
      return new Uint8Array([0xff, 0xd8, page, page, page, 0xff, 0xd9]);
    },
  };
}

function baseCtx(client: FetchClient, archiveRoot: string) {
  return {
    client,
    sourceId: MONOGRAPH_SOURCE_ID,
    archiveRoot,
    clock: () => new Date('2026-07-08T00:00:00.000Z'),
  };
}

describe('fetchMonograph (T034, FR-016 monograph sources)', () => {
  let archiveRoot: string;

  beforeEach(() => {
    archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-monograph-'));
  });

  afterEach(() => {
    rmSync(archiveRoot, { recursive: true, force: true });
  });

  it('writes every page + companion YAML into the flat books/<slug>/ dir (no dated subdir)', async () => {
    const client = fakeClient({ pageCount: 4 });
    const result = await fetchMonograph(DOCUMENT_ARK, baseCtx(client, archiveRoot));

    const expectedDir = path.join(
      archiveRoot,
      'archive/cases/port-breton/books',
      MONOGRAPH_SLUG,
    );
    expect(result.dir).toBe(expectedDir);
    expect(result.dir).toBe(monographDir(MONOGRAPH_SOURCE_ID, archiveRoot));
    expect(result.pageCount).toBe(4);
    expect(result.pages).toHaveLength(4);
    expect(result.skippedCount).toBe(0);
    expect(result.rights.status).toBe('public-domain');

    for (let page = 1; page <= 4; page += 1) {
      const jpg = path.join(expectedDir, `f${String(page).padStart(3, '0')}.jpg`);
      const yml = path.join(expectedDir, `f${String(page).padStart(3, '0')}.yml`);
      expect(existsSync(jpg)).toBe(true);
      expect(existsSync(yml)).toBe(true);
    }

    // The directory name carries no date/ark segment -- unlike a periodical
    // issue dir, a monograph has exactly one flat directory.
    expect(path.basename(expectedDir)).toBe(MONOGRAPH_SLUG);

    const yaml = await readFile(path.join(expectedDir, 'f001.yml'), 'utf-8');
    expect(yaml).toContain('id: "PB-P002"');
    expect(yaml).toContain('type: "page-image"');
    expect(yaml).toContain('case: "port-breton"');
    expect(yaml).toContain('rights_status: "public-domain"');
    expect(yaml).toContain('format: "image/jpeg"');
    expect(yaml).toContain(`original_url: "https://gallica.bnf.fr/iiif/ark:/12148/${DOCUMENT_ARK}/f1/full/full/0/native.jpg"`);

    const manifest = await readFile(
      path.join(archiveRoot, 'manifests', 'MANIFEST.sha256'),
      'utf-8',
    );
    expect(manifest).toContain(
      path.join(
        'archive/cases/port-breton/books',
        MONOGRAPH_SLUG,
        'f001.jpg',
      ),
    );
  });

  it('is resumable: a second run skips recorded pages, --force re-fetches', async () => {
    const first = fakeClient({ pageCount: 3 });
    await fetchMonograph(DOCUMENT_ARK, baseCtx(first, archiveRoot));
    expect(first.calls.filter((c) => c.startsWith('iiifImage:'))).toHaveLength(3);

    const second = fakeClient({ pageCount: 3 });
    const rerun = await fetchMonograph(DOCUMENT_ARK, baseCtx(second, archiveRoot));
    expect(rerun.skippedCount).toBe(3);
    expect(rerun.bytesWritten).toBe(0);
    expect(second.calls.filter((c) => c.startsWith('iiifImage:'))).toHaveLength(0);

    const forced = fakeClient({ pageCount: 3 });
    const forcedRun = await fetchMonograph(DOCUMENT_ARK, {
      ...baseCtx(forced, archiveRoot),
      force: true,
    });
    expect(forcedRun.skippedCount).toBe(0);
    expect(forced.calls.filter((c) => c.startsWith('iiifImage:'))).toHaveLength(3);
  });

  it('throws and writes NOTHING for a non-public-domain monograph', async () => {
    const client = fakeClient({ pageCount: 2, rights: NON_PUBLIC_DOMAIN_RIGHTS });
    await expect(
      fetchMonograph(DOCUMENT_ARK, baseCtx(client, archiveRoot)),
    ).rejects.toThrow(/not confirmed public-domain/i);

    const dir = monographDir(MONOGRAPH_SOURCE_ID, archiveRoot);
    expect(existsSync(dir)).toBe(false);
    expect(
      existsSync(path.join(archiveRoot, 'manifests', 'MANIFEST.sha256')),
    ).toBe(false);
    // The rights gate ran before any page fetch was attempted.
    expect(client.calls.some((c) => c.startsWith('iiifImage:'))).toBe(false);
  });

  it('refuses a periodical source (fetchMonograph is monograph-only)', async () => {
    const client = fakeClient({ pageCount: 1 });
    await expect(
      fetchMonograph(DOCUMENT_ARK, {
        ...baseCtx(client, archiveRoot),
        sourceId: PERIODICAL_SOURCE_ID,
      }),
    ).rejects.toThrow(/not.*monograph|kind/i);
  });

  it('shares its per-page pipeline with fetchIssue (same rights gate, same provenance shape)', async () => {
    // Prove the factoring: a periodical issue fetched via fetchIssue and a
    // monograph fetched via fetchMonograph both produce a StoreResult shape
    // and a provenance YAML with the same field set -- only the target
    // directory differs.
    const periodicalClient = fakeClient({ pageCount: 1 });
    const issueResult = await fetchIssue('bpt6k5603637g', {
      client: periodicalClient,
      sourceId: PERIODICAL_SOURCE_ID,
      date: '1879-07-15',
      archiveRoot,
      clock: () => new Date('2026-07-08T00:00:00.000Z'),
    });

    const monographClient = fakeClient({ pageCount: 1 });
    const monographResult = await fetchMonograph(
      DOCUMENT_ARK,
      baseCtx(monographClient, archiveRoot),
    );

    expect(Object.keys(issueResult).sort()).toEqual(
      Object.keys(monographResult).sort(),
    );
    expect(issueResult.dir).not.toBe(monographResult.dir);
  });
});
