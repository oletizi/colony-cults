/**
 * `PopplerRunnerImpl` -- an injected wrapper around the poppler-utils CLI
 * (`pdfimages`, `pdfinfo`, `pdftoppm`), composed on the shipped injectable
 * exec runner (`@/ocr/exec`'s `execCommand`, the ONLY sanctioned shell-out --
 * Principle VI). No method here ever spawns a real process directly: the
 * constructor takes a `CommandRunner` (structurally satisfied by
 * `execCommand`), so tests inject a fake and assert either the parsed return
 * value or the exact argv handed to the runner.
 *
 * FAIL LOUD (Principle V, no fallbacks): a non-zero `exitCode` from the
 * injected runner, or output that does not match the expected poppler shape,
 * throws a descriptive `Error` naming the command and (when available) the
 * captured stderr -- never a silently empty/default result.
 */

import type { ExecResult } from '@/ocr/exec';

/** One row of `pdfimages -list` -- the subset of columns this wrapper's callers need. */
export interface PageImageInfo {
  /** 1-based page number the image appears on. */
  page: number;
  /** The image's index within its page (poppler's `num` column). */
  num: number;
  /** Image width in pixels. */
  width: number;
  /** Image height in pixels. */
  height: number;
  /**
   * The PDF object number backing this image (poppler's "object ID" column's
   * `object` sub-value; the generation number, always `0` in observed
   * output, is not carried separately). Kept as a `string` since it is an
   * identifier, never arithmetic.
   */
  objectId: string;
  /**
   * The image's horizontal resolution in pixels-per-inch (poppler's `x-ppi`
   * column) -- the embedded image's ACTUAL scan resolution, used to rasterise
   * a multi-image page at native DPI rather than downsampling. `undefined` when
   * poppler reports no ppi (e.g. `0`), so callers fall back explicitly.
   */
  xPpi?: number;
}

/** The minimal command-runner surface this wrapper depends on -- `execCommand`'s shape, minus `stdin`. */
export type CommandRunner = (command: string, args: string[]) => Promise<ExecResult>;

/** The poppler-utils operations this wrapper exposes, all composed on an injected `CommandRunner`. */
export interface PopplerRunner {
  /** List every image XObject in `pdfPath`, parsed from `pdfimages -list`. */
  imagesList(pdfPath: string): Promise<PageImageInfo[]>;
  /** The document's page count, parsed from `pdfinfo`'s `Pages:` line. */
  info(pdfPath: string): Promise<{ pages: number }>;
  /** Losslessly extract every image XObject on `page` via `pdfimages -all`. */
  extractImage(pdfPath: string, page: number, outPrefix: string): Promise<void>;
  /** Rasterise `page` to a PNG at `dpi` via `pdftoppm`. */
  rasterise(pdfPath: string, page: number, dpi: number, outPrefix: string): Promise<void>;
}

/** The row-count `pdfimages -list` data rows are expected to have (see column note below). */
const IMAGES_LIST_COLUMN_COUNT = 16;

/**
 * `pdfimages -list`'s header prints "object ID" as a single two-word label,
 * but the underlying columns are two separate values -- the object number
 * and its generation -- so a genuine data row has 16 whitespace-delimited
 * tokens, not the 15 the header's word-count would suggest:
 *   page num type width height color comp bpc enc interp object ID x-ppi y-ppi size ratio
 * Column indices (0-based) into a split data row used by this parser:
 */
const COL_PAGE = 0;
const COL_NUM = 1;
const COL_WIDTH = 3;
const COL_HEIGHT = 4;
const COL_OBJECT = 10;
// object ID spans two tokens (object number + generation, index 10 + 11), so
// the resolution columns follow at 12 (x-ppi) / 13 (y-ppi).
const COL_XPPI = 12;

/** Run `command args` via the injected runner, throwing a descriptive error on a non-zero exit. */
async function runOrThrow(
  run: CommandRunner,
  command: string,
  args: string[],
): Promise<ExecResult> {
  const result = await run(command, args);
  if (result.exitCode !== 0) {
    throw new Error(
      `PopplerRunner: "${command} ${args.join(' ')}" exited ${result.exitCode} -- ${
        result.stderr.trim().length > 0 ? result.stderr.trim() : '(no stderr)'
      }`,
    );
  }
  return result;
}

/** Parse an integer column, failing loud (naming the command + raw value) rather than returning `NaN`. */
function parseIntColumn(command: string, raw: string, columnName: string, pdfPath: string): number {
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) {
    throw new Error(
      `PopplerRunner: "${command}" output for "${pdfPath}" has a non-numeric ${columnName} ` +
        `column ("${raw}") -- refusing to guess.`,
    );
  }
  return value;
}

/** Real implementation of {@link PopplerRunner}, composed on an injected {@link CommandRunner}. */
export class PopplerRunnerImpl implements PopplerRunner {
  constructor(private readonly run: CommandRunner) {
    if (typeof run !== 'function') {
      throw new Error('PopplerRunnerImpl: run (the injected CommandRunner) is required.');
    }
  }

  async imagesList(pdfPath: string): Promise<PageImageInfo[]> {
    const { stdout } = await runOrThrow(this.run, 'pdfimages', ['-list', pdfPath]);

    const lines = stdout.split('\n');
    const separatorIndex = lines.findIndex((line) => /^-{5,}$/.test(line.trim()));
    if (separatorIndex === -1) {
      throw new Error(
        `PopplerRunner: "pdfimages -list ${pdfPath}" produced output with no recognizable ` +
          `header separator row -- refusing to guess at its shape. Got: ${JSON.stringify(stdout)}`,
      );
    }

    const dataLines = lines.slice(separatorIndex + 1).filter((line) => line.trim().length > 0);
    return dataLines.map((line) => {
      const tokens = line.trim().split(/\s+/);
      if (tokens.length < IMAGES_LIST_COLUMN_COUNT) {
        throw new Error(
          `PopplerRunner: "pdfimages -list ${pdfPath}" data row has ${tokens.length} columns ` +
            `(expected at least ${IMAGES_LIST_COLUMN_COUNT}): "${line.trim()}"`,
        );
      }
      const xPpi = parseIntColumn('pdfimages -list', tokens[COL_XPPI], 'x-ppi', pdfPath);
      const row: PageImageInfo = {
        page: parseIntColumn('pdfimages -list', tokens[COL_PAGE], 'page', pdfPath),
        num: parseIntColumn('pdfimages -list', tokens[COL_NUM], 'num', pdfPath),
        width: parseIntColumn('pdfimages -list', tokens[COL_WIDTH], 'width', pdfPath),
        height: parseIntColumn('pdfimages -list', tokens[COL_HEIGHT], 'height', pdfPath),
        objectId: tokens[COL_OBJECT],
      };
      // poppler prints `0` ppi when it cannot determine resolution -- treat that
      // as "unknown" rather than a real 0-DPI value the caller might rasterise at.
      if (xPpi > 0) {
        row.xPpi = xPpi;
      }
      return row;
    });
  }

  async info(pdfPath: string): Promise<{ pages: number }> {
    const { stdout } = await runOrThrow(this.run, 'pdfinfo', [pdfPath]);

    const pagesLine = stdout.split('\n').find((line) => line.trim().startsWith('Pages:'));
    if (pagesLine === undefined) {
      throw new Error(
        `PopplerRunner: "pdfinfo ${pdfPath}" produced no "Pages:" line -- refusing to guess ` +
          `the page count. Got: ${JSON.stringify(stdout)}`,
      );
    }
    const raw = pagesLine.split(':')[1]?.trim() ?? '';
    return { pages: parseIntColumn('pdfinfo', raw, 'Pages', pdfPath) };
  }

  async extractImage(pdfPath: string, page: number, outPrefix: string): Promise<void> {
    await runOrThrow(this.run, 'pdfimages', [
      '-f',
      String(page),
      '-l',
      String(page),
      '-all',
      pdfPath,
      outPrefix,
    ]);
  }

  async rasterise(pdfPath: string, page: number, dpi: number, outPrefix: string): Promise<void> {
    await runOrThrow(this.run, 'pdftoppm', [
      '-f',
      String(page),
      '-l',
      String(page),
      '-r',
      String(dpi),
      '-png',
      pdfPath,
      outPrefix,
    ]);
  }
}
