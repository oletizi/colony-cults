/**
 * FR-014 command scope — the `bib` subactions that are **exceptions**: they
 * run WITHOUT a selected corpus.
 *
 * This list is not re-derived here; it is transcribed from the authoritative
 * "Corpus-dependent command table (FR-014)" in
 * `specs/018-corpus-config-seam/plan.md`, including its "Resolution of the two
 * flagged ambiguities (controller decision, T002 review)" section. Every
 * OTHER registered subaction is corpus-dependent.
 *
 * - `discover` — a stateless BnF SRU catalogue query; touches none of FR-014's
 *   six corpus-dependent clauses. **Scheduled to flip** to corpus-dependent in
 *   epic spec 2, when discovery becomes pluggable (`discoveryMechanism`).
 * - `query-source` — `<source-id>` resolves against the external-repository
 *   *capability* registry (`@/sourcequery/source-config`), not a corpus
 *   bibliographic Source id, and its persisted captures land in the repo-wide
 *   `bibliography/repository-responses/` cache, which is not corpus data.
 * - `validate-config` — named verbatim in spec.md's exceptions list and in
 *   FR-008/FR-015. NOT YET REGISTERED (it lands in T018); listed here so it is
 *   an exception from the moment it is wired, with no retrofit.
 *
 * Generic help/version for both bins are also exceptions, but they are handled
 * structurally at each composition root (before any verb is classified) rather
 * than by name here.
 */
const BIB_EXCEPTION_SUBACTIONS: ReadonlySet<string> = new Set([
  'discover',
  'query-source',
  'validate-config',
]);

/**
 * Whether a `bib` subaction runs without a selected corpus (FR-014 exception).
 * Anything not named here — including an unrecognized verb, which the existing
 * usage errors reject before any command work — is NOT treated as an
 * exception by this predicate.
 */
export function isBibExceptionSubaction(subaction: string): boolean {
  return BIB_EXCEPTION_SUBACTIONS.has(subaction);
}

/** The exception subaction ids, for diagnostics and tests. */
export function bibExceptionSubactions(): readonly string[] {
  return [...BIB_EXCEPTION_SUBACTIONS];
}
