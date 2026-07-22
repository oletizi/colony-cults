import { writeFileSync } from 'node:fs';

import type { CompileRequest, CompileResult, TypstRunner } from '@/pdf/render/typst-runner';
import type { FetchFn, FetchResponse } from '@/pdf/images/fetch';

/**
 * A fake TypstRunner that writes a stub PDF file instead of shelling `typst compile`.
 * Used by integration tests to avoid requiring the real Typst binary.
 *
 * @returns An object containing the fake runner and the list of all requests it received.
 */
export function fakeTypstRunner(): { runner: TypstRunner; calls: CompileRequest[] } {
  const calls: CompileRequest[] = [];
  const runner: TypstRunner = {
    async compile(req: CompileRequest): Promise<CompileResult> {
      calls.push(req);
      writeFileSync(req.outPath, `stub pdf (test double) for ${req.outPath}\n`);
      return { outPath: req.outPath };
    },
  };
  return { runner, calls };
}

/**
 * A fake HTTP GET serving folio image bytes at the b2 CDN URL.
 * Matches the trailing `f<NNN>.jpg` OR `f<NNN>.gif` (where NNN is a
 * zero-padded folio number) and serves the corresponding bytes from the
 * provided map. Used by integration tests to avoid network calls while
 * serving bytes whose sha256 matches the archive folio sidecar's recorded
 * image-master hash. The `.gif` alternative (spec 017 T008) serves a
 * source-group member's page-master segment images (Papers-Past-sourced
 * GIFs) without disturbing the existing `.jpg` monograph/periodical fixtures.
 *
 * @param imageBytes Map from folio number (zero-padded 3-digit string, e.g. "001")
 *                   to image byte array. Typically from writeFixtureArchive result.
 * @returns A FetchFn suitable for passing to buildSource/buildAll.
 */
export function makeFixtureFetch(imageBytes: Map<string, Uint8Array>): FetchFn {
  return async (url: string): Promise<FetchResponse> => {
    const match = /f(\d{3})\.(?:jpg|gif)$/.exec(url);
    const bytes = match ? imageBytes.get(match[1]) : undefined;
    if (!bytes) {
      return {
        ok: false,
        status: 404,
        async arrayBuffer() {
          return new ArrayBuffer(0);
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async arrayBuffer() {
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        return copy.buffer;
      },
    };
  };
}
