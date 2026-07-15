/**
 * RepositoryAdapter interface and related types.
 *
 * Defines the contract for repository-specific acquisition: resolving locators,
 * collecting rights evidence, and acquiring assets. Each concrete adapter
 * (Gallica, New Italy Museum) implements this interface.
 *
 * See specs/011-museum-acquisition-path/contracts/repository-adapter.md.
 */

import type { AcquiredAsset } from '@/model/acquired-asset';
import type { CopyIdentifier } from '@/model/repository-record';
import type { RepositoryRecord } from '@/model/repository-record';
import type {
  GroundedExtraction,
  GroundedField,
  MuseumItemFields,
} from '@/extraction/structured-extractor';

/**
 * Name of a supported repository.
 * Extensible string-literal union.
 */
export type RepositoryName = 'gallica' | 'new-italy-museum';

/**
 * A raw locator the operator supplies to `resolve`.
 * Identifies a specific item within a repository.
 */
export interface RepositoryLocator {
  /** Repository name. */
  repository: RepositoryName;
  /** The locator value: an ARK, a Musarch URL/accession, etc. */
  value: string;
}

/**
 * Minimal context for resolving a repository item.
 * Extensible for future needs (e.g., authentication, rate-limit state).
 */
export interface ResolutionContext {
  // Placeholder for future context fields
  // e.g., archiveRoot?: string; objectStore?: boolean;
}

/**
 * Minimal context for acquiring a repository record.
 * Extensible for future needs (e.g., concurrency limits, storage destination).
 */
export interface AcquisitionContext {
  /**
   * When true, validate the item read-only but perform NO acquisition side
   * effect -- no asset download, no object-store write. A genuinely shared
   * (not Gallica-specific) acquisition concern: the Gallica adapter forwards it
   * to the shipped fetcher's `--dry-run`; the museum adapter returns empty
   * assets without mirroring the master to B2. Defaults to `false`.
   */
  dryRun?: boolean;
}

/**
 * An asset's download locator.
 * Represents a downloadable representation of a repository item.
 */
export interface AssetLocator {
  /** URL of the downloadable asset. */
  url: string;
  /** Role within a multi-asset item, e.g. `front` / `reverse` / `page`. */
  role?: string;
  /** Order within the item, for multi-page/multi-asset items. */
  sequence?: number;
}

/**
 * A resolved item from a repository.
 * Produced by `RepositoryAdapter.resolve`.
 */
export interface ResolvedRepositoryItem {
  /** Repository name. */
  repository: RepositoryName;
  /** Copy-level identifiers (never fabricated). */
  identifiers: CopyIdentifier[];
  /** Detail-page URL at the repository. */
  sourceUrl: string;
  /**
   * A deterministic, mechanically-derived display title for the item -- e.g.
   * the New Italy Museum's `#objectdesc` DOM span (`parseMusarchItem`'s
   * `description`), or Gallica's `dc:title`. This is DISTINCT from the
   * OPTIONAL, LLM-grounded `metadata.description`/`metadata.creator` fields:
   * `title` is derived mechanically (never a model call) and, by each
   * adapter's `resolve` contract, is always a non-empty string when
   * `resolve` succeeds at all -- it never depends on an extractor grounding
   * an optional field. Callers that need a required, non-fabricated title
   * for a new `Source` (e.g. `@/sourcegroup/museum-inventory`) MUST derive
   * from this field, not from the optional grounded `metadata`.
   */
  title: string;
  /** Downloadable asset locators. */
  assetLocators: AssetLocator[];
  /** Grounded prose metadata extracted from the repository document. */
  metadata: GroundedExtraction<MuseumItemFields>;
}

/**
 * Evidence for rights assessment.
 *
 * This interface PROPOSES rights evidence; it never authors the rights judgment.
 * A concrete judgment (`RightsAssessment`) is operator-verified and distinct from
 * this evidence. The adapter collects and grounds evidence only; the rights
 * assessment is made separately via the rights workflow.
 *
 * See specs/004-canonical-source-metadata/data-model.md and
 * contracts/repository-adapter.md INV-B.
 */
export interface RightsEvidence {
  /** Raw rights statement from the repository. */
  rightsRaw?: string;
  /** Date grounded in repository metadata (e.g., creation date). */
  date?: GroundedField<string>;
  /** Creator or artist grounded in repository metadata. */
  creator?: GroundedField<string>;
  /** Repository's stated publication status. */
  publicationStatus?: string;
  /** Repository's rights policy or license. */
  repositoryPolicy?: string;
  /** Jurisdiction of the repository or copyright holder. */
  jurisdiction?: string;
}

/**
 * A snapshot of raw metadata returned by a repository at acquisition time.
 * Immutable once recorded; reacquisition appends a new snapshot.
 *
 * Contrast with `MetadataSnapshotRef` (used in `RepositoryRecord`), which
 * references a persisted snapshot file. This interface models the snapshot
 * payload itself.
 */
export interface MetadataSnapshot {
  /** The raw response body from the repository. */
  raw: string;
  /** ISO timestamp of retrieval. */
  retrievedAt: string;
}

/**
 * The result of acquiring assets from a repository.
 * Produced by `RepositoryAdapter.acquire`.
 */
export interface AcquisitionResult {
  /** ID of the persisted RepositoryRecord. */
  repositoryRecordId: string;
  /** Acquired asset representations. */
  assets: AcquiredAsset[];
  /** Snapshot of the raw repository response at acquire time. */
  metadataSnapshot: MetadataSnapshot;
  /** Whether acquisition retrieved a complete item. */
  complete: boolean;
  /** Whether post-acquisition reconciliation is required. */
  reconciliationRequired: boolean;
}

/**
 * Contract for repository-specific acquisition.
 *
 * Each concrete adapter (Gallica, New Italy Museum, etc.) implements this
 * interface to provide repository-specific logic for:
 * - Resolving locators to items
 * - Collecting grounded rights evidence
 * - Acquiring and storing assets
 *
 * Invariants:
 * - INV-A (resolve, no fabrication): Throws on unverifiable candidates; no identifiers invented.
 * - INV-B (rights fail-closed): Only reachable if the record's `rights.rightsStatus === 'public-domain'`.
 * - INV-C (typed result): Returns an `AcquisitionResult`; callers never infer success from side effects.
 * - INV-D (dispatch): Registry returns exactly one adapter or throws.
 * - INV-E (idempotent): Detects already-acquired assets by object-store key + checksum.
 * - INV-F (never migrate): Loop never invokes `bib migrate`.
 *
 * See specs/011-museum-acquisition-path/contracts/repository-adapter.md.
 */
export interface RepositoryAdapter {
  /** Repository name. */
  readonly repository: RepositoryName;

  /**
   * Resolve a repository locator to a concrete item.
   *
   * Throws on any unverifiable candidate. No identifier is ever invented.
   *
   * @param locator The operator-supplied locator.
   * @param ctx Resolution context.
   * @returns Promise resolving to the resolved item.
   * @throws If the locator cannot be verified or an identifier cannot be resolved.
   */
  resolve(
    locator: RepositoryLocator,
    ctx: ResolutionContext,
  ): Promise<ResolvedRepositoryItem>;

  /**
   * Collect rights evidence from a resolved item.
   *
   * This method PROPOSES evidence; it never authors the rights judgment.
   * Grounded fields evidence operator-verifiable facts; interpretation is a
   * model claim only, never authoritative.
   *
   * @param item The resolved repository item.
   * @returns Promise resolving to grounded rights evidence.
   */
  collectRightsEvidence(item: ResolvedRepositoryItem): Promise<RightsEvidence>;

  /**
   * Acquire assets for a repository record.
   *
   * Only reachable if the record's `rights.rightsStatus === 'public-domain'`.
   * Detects already-acquired assets by object-store key + checksum; re-acquisition
   * continues from persisted state. A remote content change (recorded asset's bytes
   * no longer match checksum) throws and writes nothing for that asset.
   *
   * @param record The RepositoryRecord to acquire for.
   * @param ctx Acquisition context.
   * @returns Promise resolving to the typed acquisition result.
   * @throws If any asset cannot be acquired or if a remote content change is detected.
   */
  acquire(
    record: RepositoryRecord,
    ctx: AcquisitionContext,
  ): Promise<AcquisitionResult>;
}
