import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  publicObjectUrl,
  restoreIssueImages,
  type HttpGet,
  type HttpResponse,
} from '@/archive/public-cache';
import { sha256OfBytes } from '@/archive/checksum';
import {
  serializeProvenance,
  type ObjectStoreLocation,
  type ProvenanceFields,
} from '@/archive/provenance';

const ENDPOINT = 'https://s3.us-west-004.backblazeb2.com';
const BUCKET = 'colony-cults';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function tmpIssueDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'public-cache-'));
  dirs.push(d);
  return d;
}

function locationFor(key: string): ObjectStoreLocation {
  return { provider: 'backblaze-b2', bucket: BUCKET, key, endpoint: ENDPOINT };
}

/** Provenance for one page image, with a recorded sha256 + object-store location. */
function pageFields(
  n: number,
  sha256: string,
  objectStore: ObjectStoreLocation | null,
): ProvenanceFields {
  const stem = `f${String(n).padStart(3, '0')}`;
  return {
    id: 'PB-P002',
    title: 'Nouvelle-France',
    type: 'page-image',
    case: 'port-breton',
    language: 'French',
    source_archive: 'Gallica / BnF',
    catalog_url: 'https://gallica.bnf.fr/ark:/12148/bpt6k58039518',
    original_url: '',
    rights_status: 'public-domain',
    retrieved: '2026-07-10T00:00:00.000Z',
    local_path: `archive/cases/port-breton/books/nf/${stem}.jpg`,
    sha256,
    size: 100,
    format: 'image/jpeg',
    ocr_status: 'none',
    object_store: objectStore,
    rights_raw: '<results/>',
    notes: null,
  };
}

/** Write an `f###.yml` companion for page `n` into `issueDir`. */
function writeCompanion(
  issueDir: string,
  n: number,
  bytes: Uint8Array | null,
  objectStore: ObjectStoreLocation | null,
): void {
  const stem = `f${String(n).padStart(3, '0')}`;
  const sha = bytes === null ? 'deadbeef' : sha256OfBytes(bytes);
  writeFileSync(
    path.join(issueDir, `${stem}.yml`),
    serializeProvenance(pageFields(n, sha, objectStore)),
  );
}

/** A fake HTTP GET serving a fixed url->bytes map; unknown urls 404. */
function fakeHttpGet(
  serve: Map<string, Uint8Array>,
  calls: string[] = [],
): HttpGet {
  return async (url: string): Promise<HttpResponse> => {
    calls.push(url);
    const bytes = serve.get(url);
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
      arrayBuffer: async () => {
        const copy = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(copy).set(bytes);
        return copy;
      },
    };
  };
}

describe('publicObjectUrl', () => {
  it('builds a path-style URL and normalizes stray slashes', () => {
    expect(
      publicObjectUrl(locationFor('archive/cases/x/f001.jpg')),
    ).toBe(`${ENDPOINT}/${BUCKET}/archive/cases/x/f001.jpg`);
    // Trailing endpoint slash + leading key slash collapse to one separator each.
    expect(
      publicObjectUrl({
        provider: 'backblaze-b2',
        bucket: BUCKET,
        key: '/archive/f002.jpg',
        endpoint: `${ENDPOINT}/`,
      }),
    ).toBe(`${ENDPOINT}/${BUCKET}/archive/f002.jpg`);
  });
});

describe('restoreIssueImages', () => {
  it('pulls absent images from the public cache and verifies sha256', async () => {
    const dir = tmpIssueDir();
    const b1 = new TextEncoder().encode('page-1-image-bytes');
    const b2 = new TextEncoder().encode('page-2-image-bytes');
    const k1 = 'archive/cases/pb/f001.jpg';
    const k2 = 'archive/cases/pb/f002.jpg';
    writeCompanion(dir, 1, b1, locationFor(k1));
    writeCompanion(dir, 2, b2, locationFor(k2));

    const serve = new Map([
      [`${ENDPOINT}/${BUCKET}/${k1}`, b1],
      [`${ENDPOINT}/${BUCKET}/${k2}`, b2],
    ]);
    const result = await restoreIssueImages(dir, { httpGet: fakeHttpGet(serve) });

    expect(result.restored).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
    expect(readFileSync(path.join(dir, 'f001.jpg'))).toEqual(Buffer.from(b1));
    expect(readFileSync(path.join(dir, 'f002.jpg'))).toEqual(Buffer.from(b2));
  });

  it('skips images already present locally (idempotent)', async () => {
    const dir = tmpIssueDir();
    const b1 = new TextEncoder().encode('already-local');
    const b2 = new TextEncoder().encode('needs-pull');
    const k2 = 'archive/cases/pb/f002.jpg';
    writeCompanion(dir, 1, b1, locationFor('archive/cases/pb/f001.jpg'));
    writeCompanion(dir, 2, b2, locationFor(k2));
    // Page 1's image is already on disk.
    writeFileSync(path.join(dir, 'f001.jpg'), b1);

    const calls: string[] = [];
    const serve = new Map([[`${ENDPOINT}/${BUCKET}/${k2}`, b2]]);
    const result = await restoreIssueImages(dir, {
      httpGet: fakeHttpGet(serve, calls),
    });

    expect(result.skipped).toEqual([path.join(dir, 'f001.jpg')]);
    expect(result.restored).toEqual([path.join(dir, 'f002.jpg')]);
    // Only the absent page hit the network.
    expect(calls).toEqual([`${ENDPOINT}/${BUCKET}/${k2}`]);
  });

  it('re-downloads present images under force', async () => {
    const dir = tmpIssueDir();
    const b1 = new TextEncoder().encode('canonical-bytes');
    const k1 = 'archive/cases/pb/f001.jpg';
    writeCompanion(dir, 1, b1, locationFor(k1));
    writeFileSync(path.join(dir, 'f001.jpg'), new TextEncoder().encode('stale'));

    const calls: string[] = [];
    const serve = new Map([[`${ENDPOINT}/${BUCKET}/${k1}`, b1]]);
    const result = await restoreIssueImages(dir, {
      httpGet: fakeHttpGet(serve, calls),
      force: true,
    });

    expect(result.restored).toEqual([path.join(dir, 'f001.jpg')]);
    expect(calls).toHaveLength(1);
    expect(readFileSync(path.join(dir, 'f001.jpg'))).toEqual(Buffer.from(b1));
  });

  it('throws on a sha256 mismatch (integrity failure)', async () => {
    const dir = tmpIssueDir();
    const recorded = new TextEncoder().encode('the-real-bytes');
    const tampered = new TextEncoder().encode('WRONG-bytes-from-cache');
    const k1 = 'archive/cases/pb/f001.jpg';
    writeCompanion(dir, 1, recorded, locationFor(k1));

    const serve = new Map([[`${ENDPOINT}/${BUCKET}/${k1}`, tampered]]);
    await expect(
      restoreIssueImages(dir, { httpGet: fakeHttpGet(serve) }),
    ).rejects.toThrow(/sha256 mismatch/);
    expect(existsSync(path.join(dir, 'f001.jpg'))).toBe(false);
  });

  it('throws on a non-OK response from the cache', async () => {
    const dir = tmpIssueDir();
    const b1 = new TextEncoder().encode('x');
    writeCompanion(dir, 1, b1, locationFor('archive/cases/pb/f001.jpg'));
    // Serve nothing -> the fake returns 404.
    await expect(
      restoreIssueImages(dir, { httpGet: fakeHttpGet(new Map()) }),
    ).rejects.toThrow(/failed \(404 Not Found\)/);
  });

  it('refuses (throws) when a page is absent locally and has no object_store', async () => {
    const dir = tmpIssueDir();
    writeCompanion(dir, 1, null, null);
    await expect(
      restoreIssueImages(dir, { httpGet: fakeHttpGet(new Map()) }),
    ).rejects.toThrow(/nothing to restore from/);
  });

  it('throws when the directory has no page companions', async () => {
    const dir = tmpIssueDir();
    await expect(
      restoreIssueImages(dir, { httpGet: fakeHttpGet(new Map()) }),
    ).rejects.toThrow(/no page provenance/);
  });
});
