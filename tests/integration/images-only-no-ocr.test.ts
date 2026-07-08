import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HttpClient } from '@/gallica/http-client';
import type { FetchLike } from '@/gallica/http-client';
import { GallicaHttpClient } from '@/gallica/gallica-client';
import { runFetchIssue, type FetchDeps } from '@/cli/fetch';
import { parse } from '@/cli/parse';

/**
 * SC-008 / Acceptance Scenario 3 (T038): an images-only run (no `--ocr`)
 * completes successfully even when the OCR toolchain is entirely absent --
 * i.e. the preflight is NEVER invoked when OCR is not requested. The
 * preflight here is a poisoned stub that always throws, so this test is
 * deterministic regardless of what is actually installed on the machine
 * running it.
 */

const ISSUE_ARK = 'bpt6k5603637g';
const SOURCE_ID = 'PB-P001';

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

function textFixture(name: string): string {
  return readFileSync(fixturePath(name), 'utf-8');
}

function imageFixtureBytes(): ArrayBuffer {
  const view = new Uint8Array(readFileSync(fixturePath('iiif-page-sample.jpg')));
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

function fakeFetch(): FetchLike {
  const image = imageFixtureBytes();
  return (input) => {
    const url = String(input);
    if (url.includes('/services/Pagination')) {
      return Promise.resolve(
        new Response(textFixture('pagination-bpt6k5603637g.xml'), { status: 200 }),
      );
    }
    if (url.includes('/services/OAIRecord')) {
      return Promise.resolve(
        new Response(textFixture('oairecord-bpt6k5603637g.xml'), { status: 200 }),
      );
    }
    if (url.includes('/iiif/') && url.endsWith('native.jpg')) {
      return Promise.resolve(new Response(image, { status: 200 }));
    }
    throw new Error(`fakeFetch: no fixture mapped for ${url}`);
  };
}

describe('images-only fetch with OCR toolchain absent (T038, SC-008)', () => {
  it('completes fetch-issue without ever invoking the OCR preflight or runner', async () => {
    const archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-noocr-archive-'));
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'cc-noocr-repo-'));
    try {
      const http = new HttpClient({ fetch: fakeFetch(), sleep: () => Promise.resolve() });
      const client = new GallicaHttpClient(http);

      let preflightCalls = 0;
      const deps: FetchDeps = {
        client,
        repoRoot,
        archiveRoot,
        clock: () => new Date('2026-07-08T00:00:00.000Z'),
        builtAt: '2026-07-08',
        log: () => {},
        ocrPreflight: async () => {
          preflightCalls += 1;
          throw new Error(
            'OCR toolchain preflight failed -- simulated absence (should never be called)',
          );
        },
        ocrRunner: {
          run: async () => {
            throw new Error('ocrRunner should never be invoked for an images-only run');
          },
        },
      };

      const args = parse(['fetch-issue', ISSUE_ARK, '--source-id', SOURCE_ID]);
      expect(args.flags.ocr).toBe(false);

      await expect(runFetchIssue(args, deps)).resolves.toBeUndefined();
      expect(preflightCalls).toBe(0);
    } finally {
      rmSync(archiveRoot, { recursive: true, force: true });
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
