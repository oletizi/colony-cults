/**
 * Pure result of the mechanical Papers Past article parse (see `./parse.ts`).
 *
 * Mechanically extracted from the article page's DOM (never an LLM field).
 * `ocrText` is OPTIONAL: OCR is out of scope as an acquired asset for this
 * adapter -- the corpus's existing OCR/translation pipeline produces OCR from
 * the held page-image facsimile (clarified 2026-07-19). The field only
 * documents the on-page OCR text when present; it is never fabricated and is
 * not propagated to `acquire`.
 */
export interface ParsedArticle {
  /** The Papers Past article code / `oid`, e.g. `HNS18840103.2.19.3`. */
  articleId: string;
  /** The `h3` article-heading text (non-empty). */
  title: string;
  /** One per `/imageserver/...&area=<n>` GIF segment, in `area` order. */
  imageLocators: { url: string; sequence: number }[];
  /** Newspaper title, when parseable from the breadcrumb/heading. */
  newspaper?: string;
  /** Publication date, when parseable. */
  date?: string;
  /** Page reference, when parseable. */
  page?: string;
  /** Verbatim rights statement, e.g. "No known copyright (New Zealand)". */
  rightsRaw: string;
  /** OPTIONAL on-page OCR text (`#text-tab`); absent -> undefined. */
  ocrText?: string;
}
