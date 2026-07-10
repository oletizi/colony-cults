/**
 * Splits an issue's raw OCR blob (`issue.txt`) into per-page segments.
 *
 * `issue.txt` is a single form-feed (`\f`)-delimited text covering every
 * page of an issue (see specs/005-corpus-browser/data-model.md, "Page
 * splitting"). This module is the pure derivation step: it does not touch
 * the filesystem and does not know about page counts, images, or
 * translations -- callers (`src/browser/load/corpus.ts`) are responsible for
 * cross-checking the returned segment count against the image/translation
 * counts (loader G-1).
 */

/**
 * A degraded-OCR note phrase that, when present in a page's raw OCR (case-
 * insensitively), marks that page's `ocrCondition` so the reading view can
 * frame the OCR as noisy (data-model.md PageView.ocrCondition).
 */
const OCR_CONDITION_PHRASES: readonly string[] = ['Contraste insuffisant', 'illisible'];

/**
 * One page's raw OCR, split out of an issue's `issue.txt`.
 */
export interface PageOcr {
  /** Raw French OCR for this page (the form-feed segment, unaltered). */
  ocrFrench: string;
  /**
   * The matched degraded-OCR note phrase when the segment names one
   * (case-insensitive), else `null`.
   */
  ocrCondition: string | null;
}

/**
 * Splits `issueText` on form-feed (`\f`) characters into one {@link PageOcr}
 * per page, in order.
 *
 * A trailing empty segment produced when `issueText` ends with a form-feed
 * is dropped (it is a delimiter artifact, not a page). Each segment's
 * `ocrCondition` is set to the first known degraded-OCR phrase (see
 * {@link OCR_CONDITION_PHRASES}) found in that segment, case-insensitively,
 * or `null` when none is found. `ocrFrench` preserves the segment's text
 * exactly -- it is not stripped of the condition-note text.
 *
 * @throws Error if `issueText` is empty or whitespace-only -- that is a real
 *   defect in the source OCR file, not a legitimate zero-page issue.
 */
export function splitIssueOcr(issueText: string): PageOcr[] {
  if (issueText.trim().length === 0) {
    throw new Error(
      'splitIssueOcr: issueText is empty or whitespace-only. ' +
        'This indicates a missing or corrupt issue.txt, not a zero-page issue.'
    );
  }

  const rawSegments = issueText.split('\f');

  // A trailing form-feed produces one trailing empty segment; that is a
  // delimiter artifact, not a page, so drop it. Any other empty segment
  // (e.g. a genuinely blank page) is preserved.
  if (rawSegments.length > 1 && rawSegments[rawSegments.length - 1] === '') {
    rawSegments.pop();
  }

  return rawSegments.map((segment) => ({
    ocrFrench: segment,
    ocrCondition: detectOcrCondition(segment),
  }));
}

function detectOcrCondition(segment: string): string | null {
  const lowerSegment = segment.toLowerCase();
  for (const phrase of OCR_CONDITION_PHRASES) {
    if (lowerSegment.includes(phrase.toLowerCase())) {
      return phrase;
    }
  }
  return null;
}
