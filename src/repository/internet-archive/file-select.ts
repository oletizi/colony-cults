/**
 * `selectSourceFiles` -- deterministic source-file selection over an
 * archive.org item's `files[]` list, for the Internet Archive acquisition
 * adapter's `resolve` step (specs/013-archiveorg-acquisition-path,
 * FR-003 / SC-006 / IA-INV-A).
 *
 * Fail-loud, no guessing: an ambiguous (multiple equally-eligible) or absent
 * PDF THROWS rather than picking arbitrarily. `scandata` and `imageSet` are
 * optional -- their absence is not an error, only ambiguity is.
 */

import type { ItemFile } from '@/repository/internet-archive/metadata';

/** The source files `resolve` needs to acquire an Internet Archive item. */
export interface SelectedFiles {
  /** The primary page-image PDF. */
  pdf: ItemFile;
  /** The `<id>_scandata.xml` file, if present. */
  scandata?: ItemFile;
  /** The full-res page-image set: `<id>_jp2.zip` or `<id>_tif.zip`. */
  imageSet?: ItemFile;
}

/**
 * archive.org `format` substrings that identify a page-image PDF (one whose
 * pages are full-page raster images, with or without an OCR text overlay).
 * "Additional Text PDF" is matched via the "Text PDF" substring.
 */
const PAGE_IMAGE_PDF_FORMAT_MARKERS = ['Image Container PDF', 'Text PDF'];

/** Signals restriction/encryption in a file's `format` or `name` -- reject rather than guess. */
const RESTRICTED_PATTERN = /restrict|encrypt/i;

function isPdfFile(file: ItemFile): boolean {
  return file.name.toLowerCase().endsWith('.pdf');
}

function isRestricted(file: ItemFile): boolean {
  return RESTRICTED_PATTERN.test(file.format) || RESTRICTED_PATTERN.test(file.name);
}

function isPageImagePdf(file: ItemFile): boolean {
  return PAGE_IMAGE_PDF_FORMAT_MARKERS.some((marker) => file.format.includes(marker));
}

function isScandata(file: ItemFile): boolean {
  return file.format === 'Scandata' || file.name.toLowerCase().endsWith('_scandata.xml');
}

function isJp2ImageSet(file: ItemFile): boolean {
  return (
    file.format === 'Single Page Processed JP2 ZIP' || file.name.toLowerCase().endsWith('_jp2.zip')
  );
}

function isTifImageSet(file: ItemFile): boolean {
  return (
    file.format === 'Single Page Processed TIFF ZIP' || file.name.toLowerCase().endsWith('_tif.zip')
  );
}

/**
 * Select the primary page-image PDF. Restricted/encrypted files are never
 * eligible. An OCR-only PDF (a `.pdf` file that does not match a page-image
 * format marker) is rejected whenever an eligible page-image PDF exists;
 * if no PDF is page-image-eligible, this throws rather than falling back to
 * an OCR-only file.
 *
 * When more than one page-image PDF is eligible, prefer the canonical
 * page-image master -- the `Image Container PDF` (full-page raster scans) --
 * over a supplementary `Additional Text PDF`/`Text PDF` (a searchable-text
 * derivative). Newspaper items commonly carry BOTH; a book typically carries
 * only one (de Groote: Image Container only; Clifford: Text PDF only). This
 * preference is a principled selection rule, not a guess. Only when the
 * preference cannot single out exactly one master -- several eligible PDFs
 * with zero or multiple `Image Container PDF`s -- is the choice genuinely
 * ambiguous, and the selection fails loud (IA-INV-A).
 */
function selectPdf(files: readonly ItemFile[]): ItemFile {
  const pdfFiles = files.filter(isPdfFile);
  const eligible = pdfFiles.filter((file) => !isRestricted(file) && isPageImagePdf(file));

  if (eligible.length === 1) {
    return eligible[0];
  }

  if (eligible.length > 1) {
    const imageContainers = eligible.filter((file) => file.format.includes('Image Container PDF'));
    if (imageContainers.length === 1) {
      return imageContainers[0];
    }
    throw new Error(
      'selectSourceFiles: ambiguous page-image PDF selection -- multiple equally-eligible PDFs found ' +
        'with no single "Image Container PDF" master to prefer: ' +
        eligible.map((file) => `${file.name} (${file.format})`).join(', '),
    );
  }

  if (pdfFiles.length === 0) {
    throw new Error('selectSourceFiles: no PDF file found among the item\'s files.');
  }

  throw new Error(
    'selectSourceFiles: no eligible page-image PDF found -- only OCR-only/restricted PDFs present: ' +
      pdfFiles.map((file) => `${file.name} (${file.format})`).join(', '),
  );
}

/** Select the `<id>_scandata.xml` file. Absence is not an error; multiple matches is. */
function selectScandata(files: readonly ItemFile[]): ItemFile | undefined {
  const matches = files.filter(isScandata);
  if (matches.length > 1) {
    throw new Error(
      'selectSourceFiles: ambiguous scandata selection -- multiple scandata files found: ' +
        matches.map((file) => file.name).join(', '),
    );
  }
  return matches[0];
}

/**
 * Select the full-res page-image set. JP2 is preferred over TIFF when both
 * exist. Absence of either kind is not an error; multiple equally-eligible
 * files of the *same* kind is.
 */
function selectImageSet(files: readonly ItemFile[]): ItemFile | undefined {
  const jp2Matches = files.filter(isJp2ImageSet);
  if (jp2Matches.length > 1) {
    throw new Error(
      'selectSourceFiles: ambiguous image-set selection -- multiple JP2 image-set zips found: ' +
        jp2Matches.map((file) => file.name).join(', '),
    );
  }
  if (jp2Matches.length === 1) {
    return jp2Matches[0];
  }

  const tifMatches = files.filter(isTifImageSet);
  if (tifMatches.length > 1) {
    throw new Error(
      'selectSourceFiles: ambiguous image-set selection -- multiple TIFF image-set zips found: ' +
        tifMatches.map((file) => file.name).join(', '),
    );
  }
  return tifMatches[0];
}

/**
 * Select the source files needed to acquire an Internet Archive item:
 * the primary page-image PDF (required), the scandata file (optional),
 * and the full-res image-set zip (optional, only fetched later if fidelity
 * demands it).
 */
export function selectSourceFiles(files: readonly ItemFile[]): SelectedFiles {
  const pdf = selectPdf(files);
  const scandata = selectScandata(files);
  const imageSet = selectImageSet(files);

  const result: SelectedFiles = { pdf };
  if (scandata) {
    result.scandata = scandata;
  }
  if (imageSet) {
    result.imageSet = imageSet;
  }
  return result;
}
