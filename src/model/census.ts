/**
 * The enumerated issues of a periodical source (public artifact).
 *
 * See specs/001-gallica-fetcher/data-model.md § Census.
 */
export interface Census {
  /** Back-reference to the owning source. */
  sourceId: string;
  /** Periodical ark. */
  gallicaArk: string;
  /** ISO date; passed in so deterministic runs stamp externally. */
  builtAt: string;
  /** Total issue count from the `Issues` service. */
  totalIssues: number;
  /** Ordered by `date` ascending. */
  issues: CensusIssue[];
}

/**
 * One issue within a {@link Census}.
 */
export interface CensusIssue {
  /** Issue ark. */
  ark: string;
  /** Normalized `YYYY-MM-DD` date. */
  date: string;
  /** Host's human date, e.g. `15 juillet 1879`. */
  label: string;
  /** Page count from `Pagination` (`nbVueImages`). */
  pageCount: number;
}
