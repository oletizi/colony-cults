/**
 * Corpus config seam — the shared vocabulary of the config validator
 * (`@/corpus/validate`, T005). See specs/018-corpus-config-seam/spec.md
 * (FR-002a, FR-007, FR-008, FR-015), data-model.md (§Validation rules) and
 * contracts/corpus-seam.md (§Config validator).
 *
 * WHY A RESULT AND NOT A THROW-ON-FIRST-FAILURE LOADER
 *
 * The loaders in `@/corpus/manifest` and `@/corpus/browser-profile` throw on
 * the first structural violation, which is right for them: they validate ONE
 * artifact and the caller cannot proceed without it. The config validator is
 * different in kind. It is surfaced as `bib validate-config` over EVERY
 * committed manifest (FR-015), and SC-005 grades it on rejecting *every*
 * failure condition *with a specific message*. A throw-on-first-failure
 * validator would report one violation per run, forcing the operator through
 * N fix-and-rerun cycles and hiding the shape of the problem.
 *
 * So validation ACCUMULATES {@link CorpusValidationFinding}s and returns them
 * all. This is emphatically NOT a soft/tolerant mode: nothing is defaulted,
 * repaired, or skipped, and `@/corpus/validate`'s `assertCorporaValid` is the
 * fail-loud front door that turns a non-empty finding list into a throw
 * listing every one of them. Collecting failures is about REPORTING
 * completeness, not about tolerating them.
 *
 * Every finding carries a machine-readable {@link CorpusValidationRule} (so
 * callers and tests can assert on the specific condition rather than
 * string-matching prose), a `subject` locating the offending artifact, and a
 * human message naming exactly what is wrong.
 */

/**
 * The closed set of conditions the validator checks. Each value maps to one
 * documented rule in data-model.md § Validation rules; the grouping comments
 * below follow that document's own sectioning.
 */
export type CorpusValidationRule =
  // --- Per-artifact structure (delegated to the shipped loaders) ---
  /** A committed manifest failed `loadCorpusManifest` (schema version, id/basename, case grammar, prefix grammar, padWidth range, override shape incl. a non-empty `reason`). */
  | 'manifest-unreadable'
  /** A committed browser profile failed `loadBrowserProfile`. Absence is fine (FR-005); a present-but-invalid profile is not. */
  | 'browser-profile-unreadable'
  // --- Repository-wide, across ALL committed manifests ---
  /** Two manifests declare the same corpus id. */
  | 'duplicate-corpus-id'
  /** One configured source-ID prefix equals, or is a leading substring of, another (FR-002a). */
  | 'prefix-not-disjoint'
  /** One case id appears in more than one manifest. */
  | 'duplicate-case-id'
  /** A browser profile's `corpus` names no committed manifest. */
  | 'profile-unknown-corpus'
  /**
   * A browser profile's `corpus` is not the corpus whose FILE it is — the
   * `<stem>` of `<stem>.browser.yml` (AUDIT-20). `loadBrowserProfile(root, id)`
   * keys on the FILENAME, so the stem decides which corpus gets these
   * defaults while `corpus:` only claims to; a divergence means the profile
   * hands one corpus's defaults to another. `profile-unknown-corpus` cannot
   * see it, because the claimed corpus is typically perfectly well-known.
   */
  | 'profile-corpus-filename-mismatch'
  /** Two browser profiles declare the same `id`. */
  | 'duplicate-profile-id'
  // --- Browser defaults vs. the corpus they belong to (FR-005, AUDIT-10) ---
  /**
   * A `defaultSources` id conforms to NONE of its corpus's `sourceIds`
   * policies (FR-002b) — i.e. the corpus could never allocate it, so it names
   * a Source of some OTHER corpus, or of none at all.
   */
  | 'profile-default-source-nonconforming'
  /**
   * A `defaultSources` id conforms to its corpus's policies but names no SSOT
   * record. Distinct from the rule above and neither implies the other: a
   * conforming-but-absent id passes conformance, and an existing id belonging
   * to another corpus passes existence.
   */
  | 'profile-unknown-default-source'
  // --- Archive-layout overrides (FR-007) ---
  /** An override keys a Source ID that exists in no SSOT record. */
  | 'override-unknown-source'
  /** An override keys a Source whose Case belongs to a different corpus. */
  | 'override-source-not-in-corpus'
  /** An override `relativePath` is absolute rather than archive-root-relative. */
  | 'override-path-not-relative'
  /** An override `relativePath` traverses out of the archive root. */
  | 'override-path-escapes-archive-root'
  /** An override `relativePath` is not of the form `archive/cases/<case>/<type>/<slug>` (AUDIT-05). */
  | 'override-path-malformed'
  /**
   * Two Sources resolve to one archive location — override vs override, OR an
   * override aimed at another Source's rule-DERIVED location (AUDIT-05). Both
   * shapes are the same violation of FR-007's "does not collide with another
   * Source's location", so they share one rule.
   */
  | 'override-duplicate-location'
  // --- Existing data, read from the injected sources dir ---
  /** A file under the sources dir could not be read as an identity record. */
  | 'source-identity-unreadable'
  /** Two SSOT files declare the same `sourceId` (global uniqueness, FR-002). */
  | 'duplicate-source-id'
  /**
   * An SSOT file's basename is not `<its declared sourceId>.yml` (AUDIT-04).
   * The allocator picks the next free id by scanning FILENAMES while the
   * next-id prediction scans DECLARED ids; the two agree only while this
   * holds, so a divergence lets the allocator mint an id another record
   * already declares.
   */
  | 'source-filename-id-mismatch'
  /** A Source declares no `case`, so no corpus owns it (FR-002: exactly one Case). */
  | 'source-missing-case'
  /** A Source's `case` is declared by no committed manifest, so its ID policy is undeterminable. */
  | 'source-case-not-in-any-corpus'
  /** A Source's ID does not match its owning corpus's `prefix` + `padWidth` policy (FR-002a). */
  | 'source-id-nonconforming'
  /** A corpus's next allocated ID would collide with an existing ID or another corpus's namespace (FR-002a). */
  | 'next-source-id-collision'
  // --- At selection (FR-008) ---
  /** A named required capability is not installed. */
  | 'capability-not-installed';

/** One specific, located config violation. */
export interface CorpusValidationFinding {
  /** Machine-readable condition; assert on this, not on message prose. */
  readonly rule: CorpusValidationRule;
  /**
   * The offending artifact, in the most specific stable form available: a
   * corpus id, a Source ID, a case id, or a `<corpus>/<sourceId>` pair for
   * an override. Never a synthesized index.
   */
  readonly subject: string;
  /** What is wrong, naming the offending values. */
  readonly message: string;
}

/** The outcome of a validation pass. `ok` is exactly `findings.length === 0`. */
export interface CorpusValidationResult {
  readonly ok: boolean;
  readonly findings: readonly CorpusValidationFinding[];
}

/**
 * The capability names actually installed in the running process, INJECTED
 * by the composition root.
 *
 * The corpus seam NAMES capabilities but never owns the registry
 * (data-model.md § Invariants), so this module — and every module in
 * `@/corpus` — must not import or reach into `RepositoryAdapterRegistry` /
 * `SourceQueryRegistry`. The composition root reads the registries once and
 * passes the resulting name lists down. Keeping this an injected value is
 * what keeps corpus config and capability registration orthogonal.
 */
export interface InstalledCapabilities {
  readonly repositories: readonly string[];
  readonly sourceQueries: readonly string[];
}

/** Build a finding. Centralized so every rule produces the same shape. */
export function finding(
  rule: CorpusValidationRule,
  subject: string,
  message: string,
): CorpusValidationFinding {
  return { rule, subject, message };
}

/** Render findings as one stable, greppable block, one line per finding. */
export function formatFindings(findings: readonly CorpusValidationFinding[]): string {
  return findings.map((f) => `  [${f.rule}] ${f.subject}: ${f.message}`).join('\n');
}
