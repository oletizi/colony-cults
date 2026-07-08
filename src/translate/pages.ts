/**
 * Splits issue text on the form-feed character (\f, 0x0C).
 * Drops any trailing empty element (common when text ends with \f).
 *
 * PageChunk derivation (per data-model.md):
 * splitPages(issueText) = issueText.split('\f'), dropping a trailing empty final element.
 * Chunk index i → pageNumber i+1 (1-based).
 *
 * @param issueText - Raw OCR text with pages delimited by form-feed characters
 * @returns Array of page texts, with no trailing empty element
 */
export function splitPages(issueText: string): string[] {
  const pages = issueText.split('\f');

  // Drop trailing empty element if present
  if (pages.length > 0 && pages[pages.length - 1] === '') {
    pages.pop();
  }

  return pages;
}

/**
 * Assembles page texts back into a single issue text.
 * Inverse of splitPages: join with '\f' (form-feed) to reconstruct the original sequence.
 *
 * Round-trip property: assemble(splitPages(x)) === x
 *
 * @param pages - Array of page texts in order
 * @returns Issue text with pages joined by form-feed characters
 */
export function assemble(pages: string[]): string {
  return pages.join('\f');
}
