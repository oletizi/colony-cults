/**
 * `explodeImageSet` — the fidelity-triggered image-set fallback master path
 * (FR-009 / US5 AC-2, T047/T048).
 *
 * This is the path taken when the fidelity probe judged the staged source PDF
 * MATERIALLY DEGRADED: rather than extracting/rasterising page-masters from the
 * degraded PDF, we explode a staged full-resolution scan-image SET into per-page
 * PNG masters for the operator-approved leaf range.
 *
 * A sibling module fetches the image-set zip to a staged path; THIS module takes
 * that `zipPath` and never fetches anything.
 *
 * DOCUMENTED IMAGE-SET LAYOUT ASSUMPTION
 * --------------------------------------
 * Internet Archive scan-derived image sets use a STABLE, DOCUMENTED internal
 * convention. The archive `<id>_tif.zip` (or `<id>_jp2.zip`) contains a single
 * top-level folder named after the set:
 *
 *   <id>_tif/                        (or <id>_jp2/)
 *     <id>_0001.tif                  (or .jp2)
 *     <id>_0002.tif
 *     <id>_0003.tif
 *     ...
 *
 * i.e. exactly one image per leaf, named `<id>_<NNNN>.<ext>` where `<NNNN>` is
 * the 4-digit zero-padded, 1-based LEAF ORDER, and `<ext>` is `tif` for a tif
 * set or `jp2` for a jp2 set. The operator-acceptance run (T055) verifies this
 * assumption against the real de Groote `_tif.zip`; if a future item deviates,
 * the per-leaf existence check below fails LOUD rather than guessing.
 *
 * COMPOSITION + DI (Principle VI): the two external tools this module needs —
 * `unzip` (extract the archive) and `magick`/`convert` (ImageMagick, TIFF/JP2 →
 * PNG) — are shelled out to ONLY through injected {@link CommandRunner}s, the
 * same runner shape `@/pdf/poppler/runner` uses over `@/ocr/exec`'s
 * `execCommand`. Tests inject fakes and spawn NO real process.
 *
 * FAIL LOUD (Principle V, no fallbacks): a non-zero exit from `unzip` or
 * `convert` throws an Error naming the command + captured stderr; a missing
 * expected image entry for an approved leaf throws (never a silent skip); an
 * inverted / invalid range throws before any tool runs. The produced-master
 * count MUST equal the number of leaves in the approved range (SC-005) or an
 * Error is thrown rather than storing a misaligned set.
 */

import { access } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExecResult } from '@/ocr/exec';
import type { CommandRunner } from '@/pdf/poppler/runner';
import type { LeafRange, PageMethodProvenance } from '@/model/quality-assessment';

/** One produced per-page PNG master, with its source leaf, reading order, and provenance. */
export interface ImageSetMaster {
  /** 1-based source leaf this master was produced from. */
  leaf: number;
  /** Reading order within the approved range (1..N == `AcquiredAsset.sequence`). */
  logicalPage: number;
  /** Absolute path to the converted per-page PNG master under `<outDir>/pages`. */
  pngPath: string;
  /** How the master was produced: always `image-set-png`, carrying `sourceImage`. */
  provenance: PageMethodProvenance;
}

/** Inputs to {@link explodeImageSet}. */
export interface ExplodeImageSetParams {
  /** Path to the staged full-resolution image-set archive (a sibling module fetched it). */
  zipPath: string;
  /** The Internet Archive item id — the `<id>` in the layout convention. */
  itemId: string;
  /** 1-based inclusive leaves that become reading masters. */
  approvedRange: LeafRange;
  /** Which set was selected: `tif` (`<id>_tif.zip`) or `jp2` (`<id>_jp2.zip`). */
  extension: 'tif' | 'jp2';
  /** Staging directory the extracted images + converted `pages/<n>.png` land under. */
  outDir: string;
  /** Injected `unzip` runner (tests inject a fake; the real impl composes `execCommand`). */
  unzip: CommandRunner;
  /** Injected `magick`/`convert` runner (tests inject a fake). */
  convert: CommandRunner;
}

/** The `unzip` executable name. */
const UNZIP = 'unzip';
/** The ImageMagick executable name (v7 `magick`; on v6 hosts an alias to `convert`). */
const MAGICK = 'magick';

/** Run `command args` via the injected runner, throwing a descriptive error on a non-zero exit. */
async function runOrThrow(
  run: CommandRunner,
  command: string,
  args: string[],
): Promise<ExecResult> {
  const result = await run(command, args);
  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim();
    throw new Error(
      `explodeImageSet: "${command} ${args.join(' ')}" exited ${result.exitCode} -- ` +
        `${stderr.length > 0 ? stderr : '(no stderr)'}`,
    );
  }
  return result;
}

/** Whether a path exists on disk. */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** The zip entry (relative) name for a leaf under the documented layout convention. */
function entryName(itemId: string, extension: 'tif' | 'jp2', leaf: number): string {
  return `${itemId}_${extension}/${itemId}_${String(leaf).padStart(4, '0')}.${extension}`;
}

/**
 * Explode a staged image-set archive into per-page PNG masters for
 * `approvedRange`. See the module header for the layout convention + fail-loud
 * rules.
 */
export async function explodeImageSet(
  params: ExplodeImageSetParams,
): Promise<ImageSetMaster[]> {
  const { zipPath, itemId, approvedRange, extension, outDir, unzip, convert } = params;
  const { start, end } = approvedRange;

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    throw new Error(
      `explodeImageSet: invalid approved leaf range {start:${start}, end:${end}} -- ` +
        'expected 1-based integers with start <= end.',
    );
  }

  // Extract the archive into the staging dir (one invocation).
  await runOrThrow(unzip, UNZIP, ['-o', zipPath, '-d', outDir]);

  // Per-page PNG masters land under <outDir>/pages.
  const pagesDir = join(outDir, 'pages');
  await mkdir(pagesDir, { recursive: true });

  const expectedCount = end - start + 1;
  const masters: ImageSetMaster[] = [];

  let logicalPage = 0;
  for (let leaf = start; leaf <= end; leaf += 1) {
    logicalPage += 1;
    const entry = entryName(itemId, extension, leaf);
    const inputPath = join(outDir, entry);

    // A missing expected image entry is a fail-loud condition, never a silent skip.
    if (!(await exists(inputPath))) {
      throw new Error(
        `explodeImageSet: expected image-set entry "${entry}" for leaf ${leaf} was not found ` +
          `at "${inputPath}" after extracting "${zipPath}". The archive does not match the ` +
          'documented <id>_<ext>/<id>_<NNNN>.<ext> layout -- refusing to skip the leaf.',
      );
    }

    // Lossless PNG master (no lossy transcode of the archival scan). ImageMagick
    // decodes the TIFF/JP2 and writes PNG; for a bitonal scan this is a small
    // 1-bit PNG, for a photographic page a full-depth PNG.
    const pngPath = join(pagesDir, `${logicalPage}.png`);
    await runOrThrow(convert, MAGICK, [inputPath, pngPath]);

    const provenance: PageMethodProvenance = {
      leaf,
      logicalPage,
      method: 'image-set-png',
      sourceImage: entry,
    };
    masters.push({ leaf, logicalPage, pngPath, provenance });
  }

  if (masters.length !== expectedCount) {
    throw new Error(
      `explodeImageSet: count invariant violated -- approved range {start:${start}, end:${end}} ` +
        `demands ${expectedCount} master(s) but produced ${masters.length}. Refusing to store a ` +
        'misaligned set (SC-005).',
    );
  }

  return masters;
}
