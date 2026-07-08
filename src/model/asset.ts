/**
 * A single mirrored file in the private archive.
 *
 * See specs/001-gallica-fetcher/data-model.md § Asset.
 */
export interface Asset {
  /** The kind of mirrored file. */
  type: 'page-image' | 'pdf-a' | 'ocr-text';
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
