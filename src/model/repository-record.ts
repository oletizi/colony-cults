import type { ObjectStoreLocation } from '@/archive/provenance';
import type { AcquiredAsset } from '@/model/acquired-asset';
import type { Asset } from '@/model/asset';
import type { CopyLevelIdentifierType } from '@/model/identifiers';
import type { ExcludedLeaf, QualityAssessment } from '@/model/quality-assessment';
import type { Rights, RightsAssessment } from '@/model/rights';

/**
 * A specific held copy of a {@link Source} at a given archive. Keyed by
 * `(sourceId, sourceArchive)` -- a work may be held (and mirrored) by more
 * than one archive.
 *
 * See specs/004-canonical-source-metadata/data-model.md § Repository Record.
 */
export interface RepositoryRecord {
  /** Foreign key to the owning `Source`. */
  sourceId: string;
  /** Holding archive, e.g. `Gallica / BnF`, `State Library of Queensland`. */
  sourceArchive: string;
  /** Copy-level identifiers (ark/IIIF manifest/scan DOI). */
  identifiers?: CopyIdentifier[];
  /**
   * Folio numbers of the document at this record's ark that the held copy
   * actually comprises (specs/012). Present ⇒ the copy is an EXCERPT of
   * exactly these folios (e.g. PB-P054's 3-page arrêt within a large serial
   * fascicule); absent ⇒ a whole-document holding (unchanged default
   * behavior). When present it MUST be non-empty, strictly ascending,
   * duplicate-free, and every value `>= 1` -- enforced at load time
   * (`@/bibliography/load-fields`'s `validateFolios`).
   */
  folios?: number[];
  /** Rights determination for this copy. */
  rights?: Rights;
  /**
   * The authoritative, operator-authored copy-level rights judgment (T004,
   * `@/model/rights`). Distinct from `rights` (the automated Gallica
   * OAIRecord gate result): `rightsAssessment` is repository-agnostic and is
   * what the museum path (and any future non-OAI repository) records, since
   * a museum record has no ark/OAIRecord to hang a `Rights` value off of.
   * Only a recorded `rightsStatus === 'public-domain'` permits mirroring an
   * asset for this copy -- enforced at `acquire` time (a later task; see
   * contracts/repository-adapter.md INV-B), not here.
   */
  rightsAssessment?: RightsAssessment;
  /**
   * The durable operator scan-quality judgment for this copy's staged
   * source file (specs/013-archiveorg-acquisition-path/data-model.md §
   * QualityAssessment, FR-008) -- canonical provenance, not session state.
   * Only a recorded `status === 'sound'` lets `acquire` proceed; `acquire`
   * re-verifies the staged file's sha256 against `sourceFileChecksum`
   * before acting, throwing on a mismatch.
   */
  qualityAssessment?: QualityAssessment;
  /**
   * Leaves omitted from the `page-master` reading assets but retained in
   * the preserved `repository-source` PDF (specs/013-archiveorg-acquisition-path/data-model.md
   * § ExcludedLeaf, FR-011) -- e.g. scanner notices, covers, color cards.
   */
  excludedLeaves?: ExcludedLeaf[];
  /** Catalog / landing page URL at the holding archive. */
  catalogUrl?: string;
  /** Original URL the copy was retrieved from. */
  originalUrl?: string;
  /**
   * Catalogue/asset-page locator for this copy, e.g. a Musarch detail-page
   * URL. NOT identity: copy identity is carried by `identifiers` (e.g. an
   * `accession` `CopyIdentifier`), which is durable across a URL changing.
   */
  sourceUrl?: string;
  /** Acquired representations of this copy (adapter `acquire` output). */
  assets?: AcquiredAsset[];
  /** Retrieval timestamp (ISO). */
  retrievedAt?: string;
  /**
   * Acquisition status; validated against the closed
   * `RepositoryAcquisitionStatus` vocab at runtime
   * (`@/bibliography/vocab`'s `REPOSITORY_ACQUISITION_STATUS_VALUES`, via
   * `validateVocab`) -- a distinct state machine from a `Source`'s own
   * lifecycle status. Kept as plain `string` here (not the narrower union)
   * because this field is also used to carry the loader's `''` unset
   * sentinel for a derived-only record with no authored acquisition data
   * (see `@/bibliography/derive`); narrowing to `RepositoryAcquisitionStatus`
   * would make that sentinel unrepresentable without a cast.
   */
  status: string;
  /** Where this copy's mirrored assets live (storage axis). */
  manifest?: AssetManifestRef;
  /** Derived per-issue breakdown; present only when `kind === 'periodical'`. */
  issues?: IssueRef[];
  /**
   * Reference to the immutable raw-response snapshot this record's
   * normalized fields were derived from. Additive optional field
   * (specs/006-source-group-acquisition/data-model.md § MetadataSnapshot,
   * D-07) -- absent on records that predate it.
   */
  metadataSnapshot?: MetadataSnapshotRef;
  /**
   * The recorded verdict from `promote`'s rerun verification. Additive
   * optional field (specs/006-source-group-acquisition/data-model.md §
   * VerificationVerdict, D-03) -- absent until a member has been promoted.
   */
  verification?: VerificationVerdict;
}

/**
 * A reference to one immutable raw repository response, written once and
 * never overwritten (re-inventory appends a new snapshot rather than
 * mutating this one).
 *
 * See specs/006-source-group-acquisition/data-model.md § MetadataSnapshot.
 */
export interface MetadataSnapshotRef {
  /** Location of the stored raw response, under `bibliography/`. */
  path: string;
  /** ISO timestamp of retrieval. */
  retrievedAt: string;
  /** The discovery/repository endpoint used. */
  endpoint: string;
  /** The normalization scheme version applied to derive normalized fields. */
  normalizationVersion: number;
}

/** One verification check's pass/fail outcome. */
export type VerificationCheckResult = 'passed' | 'failed';

/**
 * The recorded verdict from `promote`'s rerun verification -- `promote`
 * records a verdict only on a pass; a failing rerun aborts and records
 * nothing (D-03).
 *
 * See specs/006-source-group-acquisition/data-model.md § VerificationVerdict.
 */
export interface VerificationVerdict {
  /** `promote` only ever records a passing verdict. */
  result: 'passed';
  /** ISO timestamp of the rerun. */
  verifiedAt: string;
  /** Per-check outcomes. */
  checks: {
    identifierResolved: VerificationCheckResult;
    rights: VerificationCheckResult;
    requiredMetadata: VerificationCheckResult;
    hardDuplicate: VerificationCheckResult;
    /** A possible (soft) duplicate is either cleared or flagged for human review. */
    possibleDuplicate: 'passed' | 'review-required';
  };
  /** The `metadataSnapshot` this verdict was computed against (ties verdict to evidence). */
  snapshotRef: string;
}

/** A copy-level identifier (ark/IIIF manifest/scan DOI). */
export interface CopyIdentifier {
  /** Identifier type; must classify as `'copy'` via `classifyIdentifier`. */
  type: CopyLevelIdentifierType;
  /** The identifier value, e.g. a Gallica ark. */
  value: string;
}

/**
 * Where a `RepositoryRecord`'s mirrored assets live -- the storage axis,
 * distinct from the acquisition axis (`status`, `retrievedAt`, ...).
 */
export interface AssetManifestRef {
  /** Path to the manifest file describing the mirrored assets, if any. */
  manifestPath?: string;
  /** Derived count of mirrored assets. */
  assetCount: number;
  /** Object-store master location, or `null` for legacy/local-only copies. */
  objectStore: ObjectStoreLocation | null;
  /** Git-cache fallback path, used when `objectStore` is `null`. */
  localPath?: string;
}

/** One issue of a periodical `RepositoryRecord`, derived from its census. */
export interface IssueRef {
  /** Issue ark. */
  ark: string;
  /** Normalized `YYYY-MM-DD` date. */
  date: string;
  /** Host's human date label. */
  label: string;
  /** Page count. */
  pageCount: number;
  /** Assets mirrored for this issue. */
  assets: Asset[];
}
