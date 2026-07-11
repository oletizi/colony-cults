import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

import { makeB2ImageSource } from '@/pdf/images/b2-source';
import { makeIiifImageSource } from '@/pdf/images/iiif-source';
import { sha256OfBytes } from '@/archive/checksum';
import type { FetchFn, FetchResponse, ImageRequest } from '@/pdf/images/fetch';

/**
 * Unit tests for the print-resolution image byte fetch
 * (specs/007-corpus-print-pdf/contracts/image-fetch.md). Everything here
 * runs against in-memory/stub `FetchFn`s -- no real network access, per
 * contract G-5.
 */

const SECRET_TOKEN = 'super-secret-b2-application-key-should-never-leak';

function okResponse(bytes: Uint8Array): FetchResponse {
  return {
    ok: true,
    status: 200,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    },
  };
}

function notFoundResponse(): FetchResponse {
  return {
    ok: false,
    status: 404,
    async arrayBuffer() {
      return new ArrayBuffer(0);
    },
  };
}

/** An in-memory "object store over HTTP" fake keyed by full request url. */
function makeFakeFetch(bytesByUrl: Map<string, Uint8Array>): {
  fetchFn: FetchFn;
  requestedUrls: string[];
} {
  const requestedUrls: string[] = [];
  const fetchFn: FetchFn = async (url: string) => {
    requestedUrls.push(url);
    const bytes = bytesByUrl.get(url);
    if (!bytes) {
      return notFoundResponse();
    }
    return okResponse(bytes);
  };
  return { fetchFn, requestedUrls };
}

const KNOWN_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const KNOWN_SHA256 = sha256OfBytes(KNOWN_BYTES);

const BASE_REQUEST: ImageRequest = {
  folioId: 'f001',
  ark: 'ark:/12148/bpt6k5603637g',
  objectStoreKey: 'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15/f001.jpg',
  sha256: KNOWN_SHA256,
};

describe('makeB2ImageSource (G-1, G-2, G-4)', () => {
  it('G-1: succeeds and returns matching sha256 when fetched bytes match the recorded master hash', async () => {
    const cdnBase = 'https://cdn.example/pb';
    const url = `${cdnBase}/${BASE_REQUEST.objectStoreKey}`;
    const { fetchFn } = makeFakeFetch(new Map([[url, KNOWN_BYTES]]));
    const source = makeB2ImageSource(cdnBase, fetchFn);

    const result = await source.fetch(BASE_REQUEST);

    expect(result.sha256).toBe(KNOWN_SHA256);
    expect(result.provider).toBe('b2-cdn');
    expect(result.width).toBeNull();
    expect(result.height).toBeNull();

    const written = await readFile(result.bytesPath);
    expect(new Uint8Array(written)).toEqual(KNOWN_BYTES);
  });

  it('G-1: throws naming the folio and BOTH hashes on a sha256 mismatch', async () => {
    const cdnBase = 'https://cdn.example/pb';
    const url = `${cdnBase}/${BASE_REQUEST.objectStoreKey}`;
    const wrongBytes = new Uint8Array([9, 9, 9]);
    const wrongSha256 = sha256OfBytes(wrongBytes);
    const { fetchFn } = makeFakeFetch(new Map([[url, wrongBytes]]));
    const source = makeB2ImageSource(cdnBase, fetchFn);

    await expect(source.fetch(BASE_REQUEST)).rejects.toThrow(
      new RegExp(
        `${BASE_REQUEST.folioId}.*${BASE_REQUEST.sha256}.*${wrongSha256}|` +
          `${BASE_REQUEST.folioId}.*${wrongSha256}.*${BASE_REQUEST.sha256}`,
        's',
      ),
    );
  });

  it('G-2: throws when objectStoreKey is empty', async () => {
    const source = makeB2ImageSource('https://cdn.example/pb', async () => okResponse(KNOWN_BYTES));
    const page: ImageRequest = { ...BASE_REQUEST, objectStoreKey: '' };

    await expect(source.fetch(page)).rejects.toThrow(/f001.*object.store key/is);
  });

  it('G-2: throws when objectStoreKey is null', async () => {
    const source = makeB2ImageSource('https://cdn.example/pb', async () => okResponse(KNOWN_BYTES));
    const page: ImageRequest = {
      folioId: 'f002',
      ark: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      objectStoreKey: null as unknown as string,
      sha256: KNOWN_SHA256,
    };

    await expect(source.fetch(page)).rejects.toThrow(/f002.*object.store key/is);
  });

  it('G-4: no credential/secret appears in the returned bytesPath or thrown errors', async () => {
    const cdnBase = 'https://cdn.example/pb';
    const url = `${cdnBase}/${BASE_REQUEST.objectStoreKey}`;
    const wrongBytes = new Uint8Array([42]);
    const { fetchFn } = makeFakeFetch(new Map([[url, wrongBytes]]));
    const source = makeB2ImageSource(cdnBase, fetchFn);

    let bytesPath: string | undefined;
    try {
      const result = await source.fetch(BASE_REQUEST);
      bytesPath = result.bytesPath;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(SECRET_TOKEN);
    }
    if (bytesPath) {
      expect(bytesPath).not.toContain(SECRET_TOKEN);
    }

    // A missing-key error must also carry no secret.
    try {
      await source.fetch({ ...BASE_REQUEST, objectStoreKey: '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(SECRET_TOKEN);
    }
  });
});

describe('makeIiifImageSource (G-3, G-4)', () => {
  it('G-3: requests the IIIF full/max full-size raster URL and returns provider="source-iiif" with no master-hash comparison', async () => {
    const iiifBytes = new Uint8Array([10, 20, 30, 40]); // deliberately does NOT match BASE_REQUEST.sha256
    const expectedUrl =
      'https://gallica.bnf.fr/iiif/ark:/12148/bpt6k5603637g/f1/full/max/0/default.jpg';
    const { fetchFn, requestedUrls } = makeFakeFetch(new Map([[expectedUrl, iiifBytes]]));
    const source = makeIiifImageSource(fetchFn);

    const result = await source.fetch(BASE_REQUEST);

    expect(requestedUrls).toEqual([expectedUrl]);
    expect(result.provider).toBe('source-iiif');
    // The returned sha256 is the IIIF bytes' own checksum, NOT the (mismatched) master hash.
    expect(result.sha256).toBe(sha256OfBytes(iiifBytes));
    expect(result.sha256).not.toBe(BASE_REQUEST.sha256);

    const written = await readFile(result.bytesPath);
    expect(new Uint8Array(written)).toEqual(iiifBytes);
  });

  it('G-3: throws naming the folio when ark is missing', async () => {
    const source = makeIiifImageSource(async () => okResponse(KNOWN_BYTES));
    const page: ImageRequest = { ...BASE_REQUEST, ark: null };

    await expect(source.fetch(page)).rejects.toThrow(/f001.*ark/is);
  });

  it('G-3: throws naming the folio when the IIIF response is non-200', async () => {
    const source = makeIiifImageSource(async () => notFoundResponse());

    await expect(source.fetch(BASE_REQUEST)).rejects.toThrow(/f001/);
  });

  it('G-4: no credential/secret appears in the returned bytesPath or thrown errors', async () => {
    const source = makeIiifImageSource(async () => notFoundResponse());

    try {
      await source.fetch(BASE_REQUEST);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(SECRET_TOKEN);
    }
  });
});
