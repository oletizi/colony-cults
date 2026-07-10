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
  /**
   * The holding archive's verbatim rights statement (evidence), distinct
   * from `status`'s normalized `public-domain` | `other` classification.
   * Additive optional field (specs/006-source-group-acquisition/data-model.md
   * § Rights, D-07) -- absent on rights determinations that predate it.
   */
  raw?: string;
}
