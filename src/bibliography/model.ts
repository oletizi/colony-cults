import type {
  CopyIdentifier,
  MetadataSnapshotRef,
  RepositoryRecord,
  VerificationVerdict,
} from '@/model/repository-record';
import type { Rights, RightsAssessment } from '@/model/rights';
import type { Source } from '@/model/source';

/**
 * An identifier placed at the wrong level in an SSOT file -- a copy-level
 * type (ark/iiif-manifest/scan-doi) under a Source's `identifiers:`, or a
 * work-level type (isbn/issn/oclc) under a `repositoryRecord`'s
 * `identifiers:`. Structurally valid (a *known* identifier type), just
 * misplaced -- so `bib validate` reports it as an `identifier-leak` finding
 * (exit 1), rather than the loader failing loud (exit 2).
 *
 * See specs/004-canonical-source-metadata/contracts/source-record.md rule 3
 * and contracts/validation.md.
 */
export interface IdentifierLeak {
  /** Which container the misplaced identifier was found on. */
  onLevel: 'source' | 'record';
  sourceId: string;
  /** Present when `onLevel === 'record'`. */
  sourceArchive?: string;
  /** The misplaced identifier's type, e.g. `'ark'`. */
  type: string;
  value: string;
  /** Where this type actually belongs. */
  expectedLevel: 'work' | 'copy';
}

/**
 * The in-memory aggregate `bibliography/derive.ts` produces and
 * `regenerate.ts`/`validate.ts` consume.
 *
 * See specs/004-canonical-source-metadata/data-model.md § Derived collection.
 */
export interface CanonicalModel {
  /** From the SSOT (`bibliography/sources/PB-###.yml`). */
  sources: Source[];
  /** Derived + authored overrides, keyed `(sourceId, sourceArchive)`. */
  repositoryRecords: RepositoryRecord[];
  /** Identifiers found at the wrong level -- see {@link IdentifierLeak}. */
  identifierLeaks: IdentifierLeak[];
}

/**
 * The acquisition fields a human authors in the SSOT for one archive copy of
 * a {@link Source} -- a `RepositoryRecord` WITHOUT the derived storage/issue
 * fields (`manifest`, `issues`), plus a `census` path pointer (serials only).
 *
 * `sourceId` is not repeated here: it is implied by the owning SSOT file (see
 * contracts/source-record.md), same as the on-disk shape under
 * `repositoryRecords:`.
 */
export interface AuthoredRepositoryRecord {
  /** Holding archive, e.g. `Gallica / BnF`. Part of the `(sourceId, sourceArchive)` key. */
  sourceArchive: string;
  /**
   * Acquisition status; validated against the closed
   * `RepositoryAcquisitionStatus` vocab at runtime
   * (`@/bibliography/vocab`'s `REPOSITORY_ACQUISITION_STATUS_VALUES`, via
   * `validateVocab`) -- a distinct state machine from a `Source`'s own
   * lifecycle status. Kept as plain `string` (parsed unvalidated at the YAML
   * boundary in `@/bibliography/load-fields`; the closed-vocab check runs
   * later, at `bib validate` time).
   */
  status: string;
  /** Catalog / landing page URL at the holding archive. */
  catalogUrl?: string;
  /** Original URL the copy was retrieved from. */
  originalUrl?: string;
  /**
   * Catalogue/asset-page locator for this copy, e.g. a Musarch detail-page
   * URL (specs/011-museum-acquisition-path). NOT identity: copy identity is
   * carried by `identifiers` (e.g. an `accession` `CopyIdentifier`). Mirrors
   * `RepositoryRecord.sourceUrl` (`@/model/repository-record`).
   */
  sourceUrl?: string;
  /** Retrieval timestamp (ISO). */
  retrievedAt?: string;
  /** Copy-level identifiers (ark/IIIF manifest/scan DOI). */
  identifiers?: CopyIdentifier[];
  /** Rights determination for this copy. */
  rights?: Rights;
  /**
   * The authoritative, operator-authored copy-level rights judgment (T018,
   * `bib rights-assess`). Distinct from `rights` (the automated Gallica
   * OAIRecord gate result) -- see `@/model/rights`'s `RightsAssessment` doc
   * comment for the full rationale. Additive optional field -- absent until
   * an operator has run `bib rights-assess --status ...` on this copy.
   */
  rightsAssessment?: RightsAssessment;
  /** Path to the census JSON this record's issues derive from (serials only). */
  census?: string;
  /** Reference to the immutable raw-response snapshot (D-07). Additive optional. */
  metadataSnapshot?: MetadataSnapshotRef;
  /** The recorded verdict from promote's rerun verification (D-03). Additive optional. */
  verification?: VerificationVerdict;
}
