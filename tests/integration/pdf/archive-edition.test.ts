/**
 * INTEGRATION test (T006, spec 007 US1): builds a fixture-archive source
 * end-to-end through `buildItem` (`@/pdf/render/build`), asserting the
 * archive-direct render for BOTH recto variants (FR-010, DESIGN.md §
 * "Variant: English-only recto").
 *
 * Everything the build touches is either:
 *  - a FIXTURE archive directory (`writeFixtureArchive`, spec 014's helper) --
 *    folio sidecars, `issue.txt`, and `translation/*` artifacts written fresh
 *    to a temp dir per run, resolved via `resolveArchiveSource` /
 *    `makeArchiveEditionReader`, OR
 *  - the REAL, committed bibliography SSOT (`bibliography/sources/PB-P002.yml`)
 *    and the REAL, committed pin sidecar (`site/data/archive-source.json`) --
 *    both required, non-fixture-able inputs `buildItem` reads unconditionally
 *    (`makeSourceMetaReader`/`makeArchivePinReader` are not injectable on
 *    `BuildItemOptions`; see `batch.test.ts`'s module doc for the same
 *    constraint).
 *
 * No committed snapshot (`site/data/*.json.gz`) is read anywhere in this path
 * -- the archive-direct reader (`@/pdf/load/archive-edition`) never touches
 * it, which is exactly the spec-014 behavior this test locks in.
 *
 * `PB-P002` (a monograph, `case: 'port-breton'`, `type: 'books'`, slug
 * `nouvelle-france-colonie-libre-port-breton`) is used because it is
 * registered in `@/archive/location`'s static `SOURCE_LAYOUTS` AND has a
 * committed bibliography SSOT record -- both are required for
 * `resolveArchiveSource`/`resolveTitleAndRights` to succeed. A monograph is
 * built as a whole, so `itemId` must equal `sourceId` (`PB-P002`/`PB-P002`).
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { resolveRepoRoot } from '@/browser/load/repo-root';
import { buildItem } from '@/pdf/render/build';
import type { FetchFn, FetchResponse } from '@/pdf/images/fetch';
import type { CompileRequest, CompileResult, TypstRunner } from '@/pdf/render/typst-runner';
import type { TypstInput } from '@/pdf/render/typst-input';

import { writeFixtureArchive } from '../../unit/pdf/archive-fixture';

// ---------------------------------------------------------------------------
// Local fakes (mirrors tests/integration/pdf/batch.test.ts +
// tests/unit/pdf/image-fetch.test.ts's patterns -- neither exports these, so
// they are redefined locally here).
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
 * A fake HTTP GET serving each folio's fixture image bytes at the b2 URL
 * `buildItem` requests (`${CORPUS_CDN_BASE}/${objectStoreKey}`, per
 * `makeB2ImageSource`). Rather than reconstructing the exact object-store key
 * shape, this matches the trailing `f<NNN>.jpg` the fixture always writes and
 * looks the bytes up by that folio number -- robust to the fixture's own key
 * format.
 */
function makeFixtureFetch(imageBytes: Map<string, Uint8Array>): {
  fetchFn: FetchFn;
  requestedUrls: string[];
} {
  const requestedUrls: string[] = [];
  const fetchFn: FetchFn = async (url: string): Promise<FetchResponse> => {
    requestedUrls.push(url);
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
  return { fetchFn, requestedUrls };
}

// ---------------------------------------------------------------------------
// Fixture: a real registered monograph (PB-P002) with 3 fixture pages -- two
// machine-assisted, one untranslatable (blank EN column, FR-007).
// ---------------------------------------------------------------------------

const SOURCE_ID = 'PB-P002';
const CASE = 'port-breton';
// Must match PB-P002's registered slug (@/archive/location's SOURCE_LAYOUTS)
// so resolveArchiveSource finds the fixture dir under archiveRoot.
const SLUG = 'nouvelle-france-colonie-libre-port-breton';

describe('integration (T006, US1): fixture archive -> buildItem -> archive-direct render, both recto variants (FR-010)', () => {
  const repoRoot = resolveRepoRoot();
  const outDir = path.join(repoRoot, 'build', `pdf-archive-edition-test-${process.pid}-${Date.now()}`);

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  async function buildVariant(showFrench: boolean): Promise<{
    calls: CompileRequest[];
    requestedUrls: string[];
    typstInput: TypstInput;
    imageDir: string;
  }> {
    const fixture = await writeFixtureArchive({
      case: CASE,
      slug: SLUG,
      pageCount: 3,
      pages: [
        { translationLabel: 'machine-assisted' },
        { translationLabel: 'machine-assisted' },
        { translationLabel: 'untranslatable' },
      ],
    });

    try {
      const { runner: typst, calls } = fakeTypstRunner();
      const { fetchFn, requestedUrls } = makeFixtureFetch(fixture.imageBytes);

      const variantOutDir = path.join(outDir, showFrench ? 'fr-en' : 'en-only');

      const result = await buildItem(SOURCE_ID, SOURCE_ID, {
        archiveRoot: fixture.archiveRoot,
        provider: 'b2',
        showFrench,
        typst,
        fetchFn,
        outDir: variantOutDir,
        env: { ...process.env, CORPUS_CDN_BASE: 'https://cdn.test' },
      });

      expect(existsSync(result.outPath)).toBe(true);
      expect(calls).toHaveLength(1);

      const inputPath = calls[0].inputPath.startsWith('/')
        ? path.join(repoRoot, calls[0].inputPath.slice(1))
        : calls[0].inputPath;
      const typstInput = JSON.parse(readFileSync(inputPath, 'utf-8')) as TypstInput;

      const imageDirAbs = calls[0].imageDir.startsWith('/')
        ? path.join(repoRoot, calls[0].imageDir.slice(1))
        : calls[0].imageDir;

      return { calls, requestedUrls, typstInput, imageDir: imageDirAbs };
    } finally {
      fixture.cleanup();
    }
  }

  it('builds succeed, image bytes are staged + sha256-verified, and no committed snapshot is read (archive-only)', async () => {
    const { requestedUrls, imageDir } = await buildVariant(true);

    // 3 fixture pages -> 3 fetches, one per folio.
    expect(requestedUrls).toHaveLength(3);
    for (const url of requestedUrls) {
      expect(url.startsWith('https://cdn.test/')).toBe(true);
    }

    // stageImages copied the verified bytes to <folioId>.jpg under the image dir.
    expect(existsSync(path.join(imageDir, 'f001.jpg'))).toBe(true);
    expect(existsSync(path.join(imageDir, 'f002.jpg'))).toBe(true);
    expect(existsSync(path.join(imageDir, 'f003.jpg'))).toBe(true);
  });

  it('showFrench:true builds the parallel FR|EN recto, reflecting the fixture pages in order', async () => {
    const { typstInput } = await buildVariant(true);

    expect(typstInput.showFrench).toBe(true);
    expect(typstInput.itemId).toBe(SOURCE_ID);
    expect(typstInput.kind).toBe('monograph');
    expect(typstInput.pages).toHaveLength(3);

    expect(typstInput.pages.map((p) => p.pageId)).toEqual(['p001', 'p002', 'p003']);
    expect(typstInput.pages.map((p) => p.folioId)).toEqual(['f001', 'f002', 'f003']);

    // Machine-assisted pages: non-empty FR OCR + non-empty EN translation, in order.
    expect(typstInput.pages[0].recto.ocrFrench).toContain('page 001');
    expect(typstInput.pages[0].recto.english).toContain('page 001');
    expect(typstInput.pages[1].recto.ocrFrench).toContain('page 002');
    expect(typstInput.pages[1].recto.english).toContain('page 002');

    // The untranslatable page: FR OCR still present, EN column blank (FR-007).
    expect(typstInput.pages[2].recto.ocrFrench).toContain('page 003');
    expect(typstInput.pages[2].recto.english).toBe('');

    // Verso carries a real, non-empty sha256 for every page.
    for (const page of typstInput.pages) {
      expect(page.verso.sha256.trim().length).toBeGreaterThan(0);
      expect(page.verso.imagePath).toBe(`${page.folioId}.jpg`);
    }
  });

  it('showFrench:false builds the English-only recto -- same page content, different render mode', async () => {
    const { typstInput } = await buildVariant(false);

    expect(typstInput.showFrench).toBe(false);
    expect(typstInput.pages).toHaveLength(3);

    // The recto DATA is unchanged by the toggle (it is a render-mode-only
    // flag, per typst-input.ts's module doc) -- only `showFrench` differs.
    expect(typstInput.pages[0].recto.english).toContain('page 001');
    expect(typstInput.pages[0].recto.ocrFrench).toContain('page 001');
    expect(typstInput.pages[2].recto.english).toBe('');
  });

  it('both variants build a real PDF at a distinct output path', async () => {
    const frEn = await buildVariant(true);
    const enOnly = await buildVariant(false);

    expect(frEn.calls[0].outPath).not.toBe(enOnly.calls[0].outPath);
    expect(existsSync(frEn.calls[0].outPath)).toBe(true);
    expect(existsSync(enOnly.calls[0].outPath)).toBe(true);
  });
});
