/**
 * Serializes an `Edition` (the PDF view model, `@/pdf/model`) into the JSON
 * data structure the Typst facing-page template consumes
 * (specs/007-corpus-print-pdf/contracts/typst-template.md, G-1/G-2/G-3/G-4).
 *
 * `toTypstInput` is a pure mapping -- it trusts an already-built `Edition`
 * (the edition builder is responsible for the structural/content validation
 * documented on `@/pdf/model`'s types) and reshapes it into the
 * verso-image/recto-FR-EN facing-page structure the template renders.
 *
 * `serializeTypstInput` mirrors `@/browser/load/snapshot`'s
 * `serializeSnapshot`: sorted object keys, preserved array order, so
 * identical `Edition`s serialize byte-identically (G-4, a precondition for
 * reproducible PDFs -- SC-004).
 */

import path from 'node:path';

import type { ColophonMeta, Edition, MachineAssistLabel, TitlePageMeta } from '@/pdf/model';

/**
 * The Typst template's input document: front matter, ordered facing-page
 * spreads (verso facsimile + recto FR/EN), and colophon back matter --
 * everything `pdf/template/edition.typ` needs to compose one PDF (G-1).
 */
export interface TypstInput {
  /** The built unit's id. Carried verbatim from `Edition.itemId`. */
  itemId: string;
  /** Drives front-matter wording. Carried verbatim from `Edition.kind`. */
  kind: 'issue' | 'monograph';
  /** Title-page provenance, carried verbatim (G-3, FR-004). */
  titlePage: TitlePageMeta;
  /** Ordered facing-page spreads, one per source page, in page order (G-1). */
  pages: TypstPage[];
  /** Colophon provenance, carried verbatim (G-3, FR-005). */
  colophon: ColophonMeta;
}

/**
 * One facing-page spread: a verso facsimile image paired with its recto FR
 * OCR / EN translation. Verso and recto for a page are never split across
 * non-facing leaves (G-1) -- they are always the two halves of one
 * `TypstPage`, in the same position in `TypstInput.pages`.
 */
export interface TypstPage {
  /** Stable page identifier within the item (e.g. `p001`). */
  pageId: string;
  /** Image/view id (e.g. `f001`), used for the running head. */
  folioId: string;
  /** The verso: the authoritative facsimile scan (G-2). */
  verso: TypstVerso;
  /** The recto: the machine-derived OCR/translation apparatus (G-2). */
  recto: TypstRecto;
}

/**
 * The verso's facsimile image reference. `imagePath` is a STABLE filename
 * (derived from `folioId`, not the volatile build-temp `ImageAsset.bytesPath`)
 * so `serializeTypstInput` stays byte-identical across builds run from
 * different temp directories (G-4) -- the template resolves it relative to
 * `CompileRequest.imageDir`.
 */
export interface TypstVerso {
  /** Filename under `CompileRequest.imageDir`, e.g. `f001.jpg`. */
  imagePath: string;
  /** Content checksum of the image bytes (reproducibility cross-check). */
  sha256: string;
}

/**
 * The recto's parallel-text apparatus: French OCR left column, English
 * translation right column, both explicitly labeled machine-derived via
 * `machineAssist` so the template can render the "machine-derived" apparatus
 * labeling required by FR-003/SC-003 -- the scan (verso) remains the page's
 * unlabeled, authoritative element (G-2).
 */
export interface TypstRecto {
  /** Left column: corrected-if-available French OCR text. */
  ocrFrench: string;
  /** Right column: the page-adjacent English translation. */
  english: string;
  /** Surfaced OCR-condition apparatus note, or `null`. */
  ocrCondition: string | null;
  /** The machine-assisted-translation label (engine + date), carried per page. */
  machineAssist: MachineAssistLabel;
}

/**
 * Maps a built `Edition` to its `TypstInput` (G-1/G-2/G-3). Page order is
 * preserved verbatim from `Edition.pages`. Fails loud if the edition has no
 * pages -- a facing-page edition with zero spreads cannot be rendered, and
 * this module does not silently emit an empty document.
 *
 * @throws Error if `edition.pages` is empty
 */
export function toTypstInput(edition: Edition): TypstInput {
  if (edition.pages.length === 0) {
    throw new Error(
      `toTypstInput: Edition ${JSON.stringify(edition.itemId)} has zero pages -- a facing-page ` +
        'edition requires at least one page.'
    );
  }

  const machineAssist = edition.colophon.translation;

  const pages: TypstPage[] = edition.pages.map((page) => ({
    pageId: page.pageId,
    folioId: page.folioId,
    verso: {
      imagePath: versoImagePath(page.folioId, page.image.bytesPath),
      sha256: page.image.sha256,
    },
    recto: {
      ocrFrench: page.ocrFrench,
      english: page.english,
      ocrCondition: page.ocrCondition,
      machineAssist,
    },
  }));

  return {
    itemId: edition.itemId,
    kind: edition.kind,
    titlePage: edition.titlePage,
    pages,
    colophon: edition.colophon,
  };
}

/**
 * Derives a stable verso image filename from `folioId` + the source image's
 * extension. Deliberately ignores the rest of `bytesPath` (a build-temp
 * directory that differs run to run) so two builds of the same `Edition`
 * produce the same `imagePath` (G-4).
 */
function versoImagePath(folioId: string, bytesPath: string): string {
  const ext = path.extname(bytesPath) || '.jpg';
  return `${folioId}${ext}`;
}

/**
 * Serializes a {@link TypstInput} to a deterministic JSON string: object keys
 * sorted, array order preserved, 2-space indented -- mirrors
 * `@/browser/load/snapshot`'s `serializeSnapshot` (G-4). Identical
 * `TypstInput`s (by value) serialize byte-identically regardless of object
 * key insertion order.
 */
export function serializeTypstInput(input: TypstInput): string {
  return `${stableStringify(input, 0)}\n`;
}

const INDENT = '  ';

function stableStringify(value: unknown, depth: number): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return stringifyArray(value, depth);
  }
  if (typeof value === 'object') {
    return stringifyObject(value, depth);
  }
  // `undefined`, function, symbol -- not expected in a TypstInput; drop to
  // null so the output stays valid JSON and the defect is visible on read.
  return 'null';
}

function stringifyArray(value: unknown[], depth: number): string {
  if (value.length === 0) {
    return '[]';
  }
  const pad = INDENT.repeat(depth + 1);
  const items = value.map((item) => `${pad}${stableStringify(item, depth + 1)}`);
  return `[\n${items.join(',\n')}\n${INDENT.repeat(depth)}]`;
}

function stringifyObject(value: object, depth: number): string {
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length === 0) {
    return '{}';
  }
  const pad = INDENT.repeat(depth + 1);
  const lines = entries.map(
    ([key, v]) => `${pad}${JSON.stringify(key)}: ${stableStringify(v, depth + 1)}`
  );
  return `{\n${lines.join(',\n')}\n${INDENT.repeat(depth)}}`;
}
