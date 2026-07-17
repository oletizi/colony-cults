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

/**
 * The authoritative, operator-authored, copy-level rights judgment for a
 * mirrored representation.
 *
 * Distinct from `Rights` (above): `Rights` is the automated Gallica
 * OAIRecord rights *gate result* (ark-keyed, machine-derived from
 * `dc:rights`). `RightsAssessment` is repository-agnostic and belongs to no
 * particular source system -- it is the human judgment call the museum path
 * (and any future non-OAI repository) needs, since a museum record has no
 * ark/OAIRecord to hang a `Rights` value off of. An adapter may propose
 * evidence (e.g. a scraped credit line), but it never authors this
 * assessment -- only an operator does (`assessedBy: 'operator'`); a
 * model/automated value is not a legal type. This interface lives here
 * because it is repository-agnostic; a later task adds it as an optional
 * field on `RepositoryRecord` (copy-level, alongside `rights`).
 *
 * See specs/011-museum-acquisition-path/data-model.md § Rights.
 */
export interface RightsAssessment {
  /** Verbatim stated rights/credit text collected from the source page (evidence). */
  rightsRaw?: string;
  /** The authoritative status; only `public-domain` permits mirroring. */
  rightsStatus: 'public-domain' | 'restricted' | 'uncertain';
  /**
   * Justification for `rightsStatus`, e.g. "Photograph created before 1955;
   * Australian pre-1969 term". Required whenever an assessment exists -- an
   * assessment cannot exist without a basis.
   */
  rightsBasis: string;
  /** Jurisdiction the term analysis was made under, e.g. "AU". */
  rightsJurisdiction?: string;
  /** Who authored the assessment; always the operator, never a model/automated value. */
  assessedBy: 'operator';
  /** ISO timestamp of when the assessment was made. */
  assessedAt: string;
}
