/**
 * Result of the OAIRecord rights gate.
 *
 * See specs/001-gallica-fetcher/data-model.md § Rights.
 */
export interface Rights {
  /** Issue ark the rights were resolved for. */
  ark: string;
  /** Derived from `dc:rights`; only `public-domain` permits download. */
  status: 'public-domain' | 'other';
  /** Full OAIRecord XML, stored in provenance. */
  rawResponse: string;
  /** The parsed `dc:rights` values. */
  dcRights: string[];
}
