/**
 * A single mirrored file in the private archive.
 *
 * See specs/001-gallica-fetcher/data-model.md § Asset.
 */
export interface Asset {
  /**
   * The kind of mirrored file. `corrected-french-text`/`english-translation`
   * are derived text assets the real archive already carries alongside
   * `page-image`/`ocr-text` (see e.g. PB-P001's per-issue `issue.en.txt`).
   */
  type: 'page-image' | 'pdf-a' | 'ocr-text' | 'corrected-french-text' | 'english-translation';
  /** Absolute path; MUST be inside `../colony-cults-archive`. */
  localPath: string;
  /** Origin URL (IIIF image URL for pages; empty for derived PDF/text). */
  sourceUrl: string;
  /** Content checksum. */
  sha256: string;
  /** MIME type, e.g. `image/jpeg`, `application/pdf`, `text/plain`. */
  format: string;
  /** Ordinal for page images; `null` for derived assets. */
  pageOrdinal: number | null;
}
