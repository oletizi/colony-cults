/**
 * Tests for {@link explodeImageSet} (`@/repository/internet-archive/image-set`)
 * — the T047/T048 fidelity-triggered image-set exploder (FR-009 / US5 AC-2).
 *
 * This is the fallback master path taken when the fidelity probe judged the
 * staged source PDF materially degraded: instead of extracting/rasterising
 * from the PDF, a staged full-resolution scan-image set (`<id>_tif.zip` or
 * `<id>_jp2.zip`) is exploded into per-page PNG masters for the approved leaf
 * range.
 *
 * NO real `unzip` / `magick` process is ever spawned: every test injects FAKE
 * {@link CommandRunner}s that record their argv and return exit code 0. The
 * extracted image files are pre-created in a real temp `outDir` (mkdtemp) so
 * the module's per-leaf "missing entry" existence check passes on the happy
 * path and fails loud when an entry is deliberately withheld. The temp dir is
 * removed in `afterEach`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecResult } from '@/ocr/exec';
import type { CommandRunner } from '@/pdf/poppler/runner';
import { explodeImageSet } from '@/repository/internet-archive/image-set';

/** One recorded runner invocation, so the exact argv can be asserted. */
interface RecordedCall {
  command: string;
  args: string[];
}

/** A fake {@link CommandRunner} that records its argv and returns a chosen ExecResult. */
function fakeRunner(
  result: ExecResult,
  calls: RecordedCall[],
): CommandRunner {
  return (command: string, args: string[]): Promise<ExecResult> => {
    calls.push({ command, args });
    return Promise.resolve(result);
  };
}

const OK: ExecResult = { stdout: '', stderr: '', exitCode: 0 };
const ITEM = 'nouvellefrancec00groogoog';

let outDir: string;

beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'image-set-test-'));
});

afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

/**
 * Simulate `unzip` having extracted the image set: pre-create the per-leaf
 * image files under `<outDir>/<item>_<ext>/<item>_<LLLL>.<ext>` for each leaf.
 */
async function seedExtractedImages(
  item: string,
  ext: 'tif' | 'jp2',
  leaves: number[],
): Promise<void> {
  const setDir = join(outDir, `${item}_${ext}`);
  await mkdir(setDir, { recursive: true });
  for (const leaf of leaves) {
    const name = `${item}_${String(leaf).padStart(4, '0')}.${ext}`;
    await writeFile(join(setDir, name), 'fake-image-bytes');
  }
}

describe('explodeImageSet — happy path (US5 AC-2)', () => {
  it('explodes a 3-leaf approved range into 3 per-page PNG masters with image-set-png provenance', async () => {
    await seedExtractedImages(ITEM, 'tif', [3, 4, 5]);
    const unzipCalls: RecordedCall[] = [];
    const convertCalls: RecordedCall[] = [];
    const zipPath = join(outDir, `${ITEM}_tif.zip`);

    const masters = await explodeImageSet({
      zipPath,
      itemId: ITEM,
      approvedRange: { start: 3, end: 5 },
      extension: 'tif',
      outDir,
      unzip: fakeRunner(OK, unzipCalls),
      convert: fakeRunner(OK, convertCalls),
    });

    // One master per leaf, in reading order.
    expect(masters).toHaveLength(3);
    expect(masters.map((m) => [m.leaf, m.logicalPage])).toEqual([
      [3, 1],
      [4, 2],
      [5, 3],
    ]);

    // Every master carries image-set-png provenance with the zero-padded source entry name.
    for (const master of masters) {
      expect(master.provenance.method).toBe('image-set-png');
      expect(master.provenance.sourcePdfObject).toBeUndefined();
      expect(master.provenance.resolutionDpi).toBeUndefined();
      expect(master.provenance.leaf).toBe(master.leaf);
      expect(master.provenance.logicalPage).toBe(master.logicalPage);
    }
    expect(masters[0].provenance.sourceImage).toBe(
      `${ITEM}_tif/${ITEM}_0003.tif`,
    );
    expect(masters[2].provenance.sourceImage).toBe(
      `${ITEM}_tif/${ITEM}_0005.tif`,
    );

    // unzip called exactly once, extracting the zip into outDir.
    expect(unzipCalls).toHaveLength(1);
    expect(unzipCalls[0].command).toBe('unzip');
    expect(unzipCalls[0].args).toEqual(['-o', zipPath, '-d', outDir]);

    // convert called once per leaf, with the right zero-padded input and per-page jpeg output.
    expect(convertCalls).toHaveLength(3);
    expect(convertCalls[0].command).toBe('magick');
    expect(convertCalls[0].args).toEqual([
      join(outDir, `${ITEM}_tif`, `${ITEM}_0003.tif`),
      join(outDir, 'pages', '1.png'),
    ]);
    expect(convertCalls[2].args).toEqual([
      join(outDir, `${ITEM}_tif`, `${ITEM}_0005.tif`),
      join(outDir, 'pages', '3.png'),
    ]);
    expect(masters[0].pngPath).toBe(join(outDir, 'pages', '1.png'));
    expect(masters[2].pngPath).toBe(join(outDir, 'pages', '3.png'));
  });

  it('handles a jp2 image set with the .jp2 extension', async () => {
    await seedExtractedImages(ITEM, 'jp2', [10]);
    const unzipCalls: RecordedCall[] = [];
    const convertCalls: RecordedCall[] = [];

    const masters = await explodeImageSet({
      zipPath: join(outDir, `${ITEM}_jp2.zip`),
      itemId: ITEM,
      approvedRange: { start: 10, end: 10 },
      extension: 'jp2',
      outDir,
      unzip: fakeRunner(OK, unzipCalls),
      convert: fakeRunner(OK, convertCalls),
    });

    expect(masters).toHaveLength(1);
    expect(masters[0].provenance.sourceImage).toBe(`${ITEM}_jp2/${ITEM}_0010.jp2`);
    expect(convertCalls[0].args[0]).toBe(
      join(outDir, `${ITEM}_jp2`, `${ITEM}_0010.jp2`),
    );
  });
});

describe('explodeImageSet — fail loud (Principle V)', () => {
  it('throws when an expected image entry is missing for a leaf (no silent skip)', async () => {
    // Seed only leaves 3 and 5; leaf 4 is deliberately absent.
    await seedExtractedImages(ITEM, 'tif', [3, 5]);

    await expect(
      explodeImageSet({
        zipPath: join(outDir, `${ITEM}_tif.zip`),
        itemId: ITEM,
        approvedRange: { start: 3, end: 5 },
        extension: 'tif',
        outDir,
        unzip: fakeRunner(OK, []),
        convert: fakeRunner(OK, []),
      }),
    ).rejects.toThrow(/0004\.tif/);
  });

  it('throws naming the command when unzip exits non-zero', async () => {
    const bad: ExecResult = { stdout: '', stderr: 'bad zip: not a valid archive', exitCode: 9 };
    await expect(
      explodeImageSet({
        zipPath: join(outDir, `${ITEM}_tif.zip`),
        itemId: ITEM,
        approvedRange: { start: 3, end: 3 },
        extension: 'tif',
        outDir,
        unzip: fakeRunner(bad, []),
        convert: fakeRunner(OK, []),
      }),
    ).rejects.toThrow(/unzip[\s\S]*not a valid archive/);
  });

  it('throws naming the command when convert exits non-zero', async () => {
    await seedExtractedImages(ITEM, 'tif', [3]);
    const bad: ExecResult = { stdout: '', stderr: 'no decode delegate for this image format', exitCode: 1 };

    await expect(
      explodeImageSet({
        zipPath: join(outDir, `${ITEM}_tif.zip`),
        itemId: ITEM,
        approvedRange: { start: 3, end: 3 },
        extension: 'tif',
        outDir,
        unzip: fakeRunner(OK, []),
        convert: fakeRunner(bad, []),
      }),
    ).rejects.toThrow(/magick[\s\S]*no decode delegate/);
  });

  it('throws on an inverted range (end < start) before touching any runner', async () => {
    const unzipCalls: RecordedCall[] = [];
    const convertCalls: RecordedCall[] = [];

    await expect(
      explodeImageSet({
        zipPath: join(outDir, `${ITEM}_tif.zip`),
        itemId: ITEM,
        approvedRange: { start: 5, end: 3 },
        extension: 'tif',
        outDir,
        unzip: fakeRunner(OK, unzipCalls),
        convert: fakeRunner(OK, convertCalls),
      }),
    ).rejects.toThrow(/range/i);

    expect(unzipCalls).toHaveLength(0);
    expect(convertCalls).toHaveLength(0);
  });
});
