import type { ObjectStoreLocation } from '@/archive/provenance';
import type { Asset } from '@/model/asset';
import type { CopyLevelIdentifierType } from '@/model/identifiers';
import type { Rights } from '@/model/rights';

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
  /** Rights determination for this copy. */
  rights?: Rights;
  /** Catalog / landing page URL at the holding archive. */
  catalogUrl?: string;
  /** Original URL the copy was retrieved from. */
  originalUrl?: string;
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
