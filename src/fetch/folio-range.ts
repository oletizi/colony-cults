/**
 * Pure `--pages` spec parser (spec 012, T002/T003). Parses a comma-separated
 * list of single folios and inclusive `lo-hi` ranges into a de-duplicated,
 * ascending array of positive integers (IIIF folios).
 *
 * Deliberately PURE: no I/O, no document knowledge -- it does NOT check the
 * result against a real `pageCount` bound. That bounds check belongs to the
 * caller, once the document's actual page count is known. Every malformed
 * input throws a descriptive error naming the offending token and why (fail
 * loud, no silent fallback).
 */

/**
 * Parses one folio number out of `raw`, reporting errors against `context`
 * (the whole token the caller is working through, so a thrown message names
 * what was actually typed). `allowSign` accepts a leading `-` -- used only
 * for a standalone token like `"-1"`, so it reports the semantically correct
 * "below 1" reason rather than being mistaken for a range with a missing low
 * bound; range endpoints (`lo`/`hi` of `"lo-hi"`) never allow a sign.
 */
function parseFolioNumber(raw: string, context: string, allowSign: boolean): number {
  const pattern = allowSign ? /^-?\d+$/ : /^\d+$/;
  if (!pattern.test(raw)) {
    throw new Error(
      `parseFolioRange: non-integer folio "${raw}" in token "${context}"`,
    );
  }
  const folio = Number.parseInt(raw, 10);
  if (folio < 1) {
    throw new Error(
      `parseFolioRange: folio ${folio} in token "${context}" is below 1 -- folios are 1-indexed`,
    );
  }
  return folio;
}

/**
 * Parses one comma-separated segment of a `--pages` spec, trimmed. A hyphen
 * that appears AFTER the first character marks a range (`"lo-hi"`); a hyphen
 * only at position 0 is treated as the sign of a single negative number
 * (which then fails the "below 1" check with a clear reason) rather than as
 * a range delimiter.
 */
function parseToken(token: string): number[] {
  const hyphenIndex = token.indexOf('-', 1);
  if (hyphenIndex === -1) {
    return [parseFolioNumber(token, token, true)];
  }

  const loRaw = token.slice(0, hyphenIndex).trim();
  const hiRaw = token.slice(hyphenIndex + 1).trim();
  if (loRaw === '' || hiRaw === '') {
    throw new Error(
      `parseFolioRange: malformed range token "${token}" -- expected "<lo>-<hi>"`,
    );
  }

  const lo = parseFolioNumber(loRaw, token, false);
  const hi = parseFolioNumber(hiRaw, token, false);
  if (lo > hi) {
    throw new Error(
      `parseFolioRange: reversed range "${token}" -- start (${lo}) is greater than end (${hi})`,
    );
  }

  const folios: number[] = [];
  for (let folio = lo; folio <= hi; folio += 1) {
    folios.push(folio);
  }
  return folios;
}

/**
 * Parses a `--pages` spec string, e.g. `"48-50,55"`, into a de-duplicated,
 * ascending array of positive folio numbers. Whitespace around tokens,
 * hyphens, and commas is tolerated. Throws on any empty selection, empty
 * token, malformed range, non-integer folio, folio below 1, or reversed
 * range.
 */
export function parseFolioRange(spec: string): number[] {
  const trimmedSpec = spec.trim();
  if (trimmedSpec === '') {
    throw new Error('parseFolioRange: empty selection -- no folios specified');
  }

  const rawTokens = trimmedSpec.split(',');
  const folios = new Set<number>();

  for (const rawToken of rawTokens) {
    const token = rawToken.trim();
    if (token === '') {
      throw new Error(
        `parseFolioRange: empty token in spec "${spec}" -- check for stray or doubled commas`,
      );
    }
    for (const folio of parseToken(token)) {
      folios.add(folio);
    }
  }

  return [...folios].sort((a, b) => a - b);
}
