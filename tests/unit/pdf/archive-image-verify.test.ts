import { describe, expect, it } from 'vitest';

import { makeB2ImageSource } from '@/pdf/images/b2-source';
import { sha256OfBytes } from '@/archive/checksum';
import type { FetchFn, FetchResponse, ImageRequest } from '@/pdf/images/fetch';

/**
 * T017 (Polish, SC-003): proves that image masters are sha256-verified
 * against the archive-recorded master hash, and that a missing or
 * mismatched master fails loud with NO fallback to IIIF -- `makeB2ImageSource`
 * (`@/pdf/images/b2-source.ts`) has no IIIF path at all, so "no fallback" is
 * structural, not merely untested.
 */

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
function makeFakeFetch(bytesByUrl: Map<string, Uint8Array>): FetchFn {
  return async (url: string) => {
    const bytes = bytesByUrl.get(url);
    if (!bytes) {
      return notFoundResponse();
    }
    return okResponse(bytes);
  };
}

const KNOWN_BYTES = new Uint8Array([11, 22, 33, 44, 55, 66, 77, 88]);
const KNOWN_SHA256 = sha256OfBytes(KNOWN_BYTES);

const CDN_BASE = 'https://cdn.example/archive';

const MASTER_PAGE: ImageRequest = {
  folioId: 'f042',
  ark: null,
  objectStoreKey: 'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15/f042.jpg',
  sha256: KNOWN_SHA256,
};

describe('archive image master verification (SC-003)', () => {
  it('verified master: fetched bytes hash-match the recorded sha256 -- succeeds with provider b2-cdn', async () => {
    const url = `${CDN_BASE}/${MASTER_PAGE.objectStoreKey}`;
    const fetchFn = makeFakeFetch(new Map([[url, KNOWN_BYTES]]));
    const source = makeB2ImageSource(CDN_BASE, fetchFn);

    const result = await source.fetch(MASTER_PAGE);

    expect(result.provider).toBe('b2-cdn');
    expect(result.sha256).toBe(KNOWN_SHA256);
    expect(result.bytesPath.length).toBeGreaterThan(0);
  });

  it('mismatched master: fetched bytes do NOT hash-match the recorded sha256 -- fails loud, naming the folio', async () => {
    const url = `${CDN_BASE}/${MASTER_PAGE.objectStoreKey}`;
    const corruptedBytes = new Uint8Array([1, 2, 3]);
    const fetchFn = makeFakeFetch(new Map([[url, corruptedBytes]]));
    const source = makeB2ImageSource(CDN_BASE, fetchFn);

    await expect(source.fetch(MASTER_PAGE)).rejects.toThrow(
      new RegExp(`sha256 mismatch.*${MASTER_PAGE.folioId}`, 's'),
    );
  });

  it('absent master: fetch returns not-found -- fails loud with NO fallback to IIIF', async () => {
    const fetchFn = makeFakeFetch(new Map()); // empty store: every url misses -> 404
    const source = makeB2ImageSource(CDN_BASE, fetchFn);

    await expect(source.fetch(MASTER_PAGE)).rejects.toThrow(
      new RegExp(`${MASTER_PAGE.folioId}.*failed.*status 404`, 's'),
    );

    // Structural guarantee, not merely behavioral: the b2 source has no
    // iiif-fallback branch to have skipped -- `makeB2ImageSource`'s returned
    // `ImageByteSource` only ever reports `kind: 'b2-cdn'`.
    expect(source.kind).toBe('b2-cdn');
  });
});
