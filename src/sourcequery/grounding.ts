/**
 * Separator-tolerant grounding (research R7 / FR-007).
 *
 * A count parsed out of source bytes must remain traceable back to those exact
 * bytes — that is what makes a returned fact evidence-grounded rather than a
 * guess. A naive `bytes.includes(String(count))` breaks the moment a source
 * renders a large count with a thousands separator ("12,345"): the parsed
 * plain-digit count `12345` is no longer a literal substring, so a genuinely
 * grounded fact would be wrongly rejected.
 *
 * The matcher below rebuilds a pattern from the count's own digits, allowing an
 * OPTIONAL single separator (`[,. \s]`) BETWEEN consecutive digits. So `12345`
 * matches "12,345", "12 345", "12.345", and "12345" — while staying tied to the
 * EXACT digit sequence: a different number cannot satisfy it. Digits are 0-9,
 * so no regex escaping is required.
 */

/** Count digits are 0-9; a single optional separator is allowed between them. */
const DIGIT_SEPARATOR = '[,. \\s]?';

/**
 * True when `count`'s digit sequence appears in `bytes`, allowing a single
 * optional separator between each pair of digits. Ties grounding to the exact
 * number while tolerating real-world thousands formatting.
 */
export function isCountGrounded(bytes: string, count: number): boolean {
  const digits = String(count).split('');
  const pattern = digits.join(DIGIT_SEPARATOR);
  return new RegExp(pattern).test(bytes);
}
