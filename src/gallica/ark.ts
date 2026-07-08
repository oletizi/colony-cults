/**
 * Gallica's bare document identifiers ("arks") are opaque alphanumeric tokens,
 * e.g. `bpt6k5603637g` (an issue) or `cb328261098` (a periodical). They never
 * contain path separators, dots, or whitespace.
 *
 * A bare ark is used verbatim to build filesystem paths under the private
 * archive (see `issueDir`/`monographDir`/`findIssueDir` in
 * `@/archive/location`). A malformed ark containing `/`, `..`, or other path
 * separators could therefore steer a write outside its intended directory, so
 * this validator is the UP-FRONT guard that rejects such values before any
 * path is constructed (`assertInsideArchive` remains the non-overridable
 * backstop).
 */
const BARE_ARK_PATTERN = /^[A-Za-z0-9]+$/;

/**
 * Assert that `bareArk` is a well-formed Gallica bare identifier (alphanumeric
 * only) and return it unchanged. Throws a descriptive Error for anything
 * containing `/`, `..`, whitespace, other path separators, or an empty value --
 * there is no fallback or sanitization, an invalid ark fails loud.
 */
export function assertValidArk(bareArk: string): string {
  if (!BARE_ARK_PATTERN.test(bareArk)) {
    throw new Error(
      `assertValidArk: refusing malformed ark ${JSON.stringify(bareArk)} -- ` +
        `a Gallica bare identifier must be alphanumeric (e.g. "bpt6k5603637g") ` +
        `with no "/", "..", whitespace, or path separators`,
    );
  }
  return bareArk;
}
