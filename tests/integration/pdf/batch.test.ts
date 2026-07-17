/**
 * INTEGRATION test (T024, spec 007 US2; archive-direct T009, spec 014): drives
 * the batch build mechanism (`@/pdf/render/batch`'s `buildSource`/`buildAll`)
 * against a FIXTURE archive directory (`writeFixtureArchive`, spec 014's
 * helper) with an INJECTED fake `TypstRunner` (writes a stub file -- no real
 * `typst` binary) and a fake `fetchFn` serving each fixture folio's own real
 * bytes, asserting:
 *
 *  - G-1 (one PDF per item): a healthy source's one item gets exactly one
 *    written PDF, with `typst compile` invoked once.
 *  - G-4 (attributable, record-and-continue): a source whose archive
 *    directory exists but has no folio sidecars at all (deliberately left
 *    empty) is recorded -- by `buildSource` as a direct batch-level throw
 *    naming the source, and by `buildAll` folded into that source's own
 *    `(source ...)`-marked failure -- without aborting or omitting a healthy
 *    sibling source.
 *
 * `provider: 'b2'` is used throughout, not `iiif`: archive-direct pages carry
 * no per-page ark (`@/pdf/render/build`'s module doc), so the IIIF source
 * would throw "no ark" on every page here. `CORPUS_CDN_BASE` is set so the b2
 * source resolves a url, and the fake `fetchFn` serves the fixture's own
 * bytes (keyed by folio number) so the b2 source's sha256 verification
 * against the folio sidecar's real image-master hash succeeds.
 *
 * `PB-P002` (real, registered monograph -- `bibliography/sources/PB-P002.yml`
 * + `@/archive/location`'s static `SOURCE_LAYOUTS`) is the healthy fixture
 * source, matching `archive-edition.test.ts`'s T006 pattern. `PB-P054` (also
 * a real registered monograph, same `case: 'port-breton'`) is reused as the
 * deliberately-broken sibling: its archive directory is created but left
 * empty, so `resolveArchiveSource` itself fails loud with "no folio
 * sidecars". Sharing one case means both resolve under the SAME fixture
 * `archiveRoot`, and since every OTHER registered source has no directory
 * under this fresh temp root, `buildAll`'s bibliography-driven discovery sees
 * exactly these two sources.
 *
 * No committed snapshot (`site/data/*.json.gz`) is read anywhere in this path
 * -- the archive-direct `buildSource`/`buildAll` never touch it.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { resolveRepoRoot } from '@/browser/load/repo-root';
import { buildAll, buildSource } from '@/pdf/render/batch';
import type { FetchFn, FetchResponse } from '@/pdf/images/fetch';
import type { CompileRequest, CompileResult, TypstRunner } from '@/pdf/render/typst-runner';

import { writeFixtureArchive } from '../../unit/pdf/archive-fixture';

// ---------------------------------------------------------------------------
// Shared fakes: no real `typst` binary, no network (mirrors
// `tests/integration/pdf/archive-edition.test.ts`'s T006 patterns -- neither
// module exports these).
// ---------------------------------------------------------------------------

/** A fake TypstRunner that writes a stub PDF file instead of shelling `typst`. */
function fakeTypstRunner(): { runner: TypstRunner; calls: CompileRequest[] } {
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
 * A fake HTTP GET serving each folio's real fixture image bytes at the b2 URL
 * `buildItem` requests (`${CORPUS_CDN_BASE}/${objectStoreKey}`, per
 * `makeB2ImageSource`). Matches the trailing `f<NNN>.jpg` the fixture always
 * writes and looks the bytes up by that folio number -- robust to the
 * fixture's own key format, and yields bytes whose sha256 matches the folio
 * sidecar's recorded image-master hash.
 */
function makeFixtureFetch(imageBytes: Map<string, Uint8Array>): FetchFn {
  return async (url: string): Promise<FetchResponse> => {
    const match = /f(\d{3})\.jpg$/.exec(url);
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
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      },
    };
  };
}

const CORPUS_CDN_BASE = 'https://cdn.test';

// A real, registered monograph (@/archive/location's static SOURCE_LAYOUTS)
// with a committed bibliography SSOT record -- both required for
// resolveArchiveSource/buildItem to succeed against a fixture archiveRoot.
const HEALTHY_SOURCE_ID = 'PB-P002';
const HEALTHY_CASE = 'port-breton';
const HEALTHY_SLUG = 'nouvelle-france-colonie-libre-port-breton';

// A second real, registered monograph, same case -- deliberately left with an
// EMPTY archive directory (no folio sidecars) to exercise the batch-level
// (not per-item) failure path.
const EMPTY_SOURCE_ID = 'PB-P054';
const EMPTY_SLUG = 'cour-de-cassation-chambre-criminelle-arret-de-rejet-du-pourvoi-de-charles';

/** Create `EMPTY_SOURCE_ID`'s registered archive directory, empty, under `archiveRoot`. */
function writeEmptySiblingDir(archiveRoot: string): void {
  const emptyDir = path.join(archiveRoot, 'archive', 'cases', HEALTHY_CASE, 'books', EMPTY_SLUG);
  mkdirSync(emptyDir, { recursive: true });
}

// ---------------------------------------------------------------------------
// buildSource: G-1 over a healthy source's one item, and the batch-level
// throw (contracts/cli.md's bare `<sourceId>` selector's mechanism).
// ---------------------------------------------------------------------------

describe('batch build (T024, US2; archive-direct T009): buildSource', () => {
  const repoRoot = resolveRepoRoot();
  const outDir = path.join(repoRoot, 'build', `pdf-batch-test-${process.pid}-${Date.now()}`);

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('builds the one item of a healthy monograph source straight from the archive (G-1)', async () => {
    const fixture = await writeFixtureArchive({
      case: HEALTHY_CASE,
      slug: HEALTHY_SLUG,
      pageCount: 2,
    });

    try {
      const { runner: typst, calls } = fakeTypstRunner();
      const fetchFn = makeFixtureFetch(fixture.imageBytes);

      const result = await buildSource(HEALTHY_SOURCE_ID, {
        archiveRoot: fixture.archiveRoot,
        provider: 'b2',
        outDir,
        fetchFn,
        typst,
        env: { ...process.env, CORPUS_CDN_BASE },
      });

      expect(result.sourceId).toBe(HEALTHY_SOURCE_ID);
      expect(result.failed).toHaveLength(0);
      expect(result.built).toHaveLength(1);
      expect(result.built[0].itemId).toBe(HEALTHY_SOURCE_ID);
      expect(existsSync(result.built[0].outPath)).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0].outPath).toBe(result.built[0].outPath);
    } finally {
      fixture.cleanup();
    }
  });

  it('throws a batch-level error naming the source when its archive directory has no folio sidecars', async () => {
    const fixture = await writeFixtureArchive({
      case: HEALTHY_CASE,
      slug: HEALTHY_SLUG,
      pageCount: 1,
    });

    try {
      writeEmptySiblingDir(fixture.archiveRoot);

      await expect(
        buildSource(EMPTY_SOURCE_ID, {
          archiveRoot: fixture.archiveRoot,
          provider: 'b2',
          env: { ...process.env, CORPUS_CDN_BASE },
        }),
      ).rejects.toThrow(/no folio sidecars/i);
    } finally {
      fixture.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// buildAll: discovers every buildable source from the archive (bibliography
// SSOT + registered layout + existing archive dir), per-source attribution
// across the whole corpus batch (the `--all` CLI selector's mechanism).
// ---------------------------------------------------------------------------

describe('batch build: buildAll -- discovers buildable sources from the archive, per-source attribution (G-1/G-4)', () => {
  const repoRoot = resolveRepoRoot();
  const outDir = path.join(repoRoot, 'build', `pdf-batch-all-test-${process.pid}-${Date.now()}`);

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('builds the healthy source, attributes the empty sibling as a whole-source failure, and does not stop the rest', async () => {
    const fixture = await writeFixtureArchive({
      case: HEALTHY_CASE,
      slug: HEALTHY_SLUG,
      pageCount: 1,
    });

    try {
      writeEmptySiblingDir(fixture.archiveRoot);

      const { runner: typst } = fakeTypstRunner();
      const fetchFn = makeFixtureFetch(fixture.imageBytes);

      const results = await buildAll({
        archiveRoot: fixture.archiveRoot,
        provider: 'b2',
        outDir,
        fetchFn,
        typst,
        env: { ...process.env, CORPUS_CDN_BASE },
      });

      // Only these two sources have an archive directory under this fresh
      // temp root -- every other registered/bibliography-listed source is
      // absent here, so discovery narrows to exactly this pair.
      expect(results.map((r) => r.sourceId).sort()).toEqual(
        [HEALTHY_SOURCE_ID, EMPTY_SOURCE_ID].sort(),
      );

      const healthy = results.find((r) => r.sourceId === HEALTHY_SOURCE_ID);
      if (healthy === undefined) {
        throw new Error('test: no result for HEALTHY_SOURCE_ID');
      }
      expect(healthy.built).toHaveLength(1);
      expect(healthy.failed).toHaveLength(0);
      expect(existsSync(healthy.built[0].outPath)).toBe(true);

      const empty = results.find((r) => r.sourceId === EMPTY_SOURCE_ID);
      if (empty === undefined) {
        throw new Error('test: no result for EMPTY_SOURCE_ID');
      }
      expect(empty.built).toHaveLength(0);
      expect(empty.failed).toHaveLength(1);
      expect(empty.failed[0].itemId).toBe(`(source ${EMPTY_SOURCE_ID})`);
      expect(empty.failed[0].error).toMatch(/no folio sidecars/i);
    } finally {
      fixture.cleanup();
    }
  });
});
