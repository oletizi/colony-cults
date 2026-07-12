import type { MachineAssistLabel } from '@/pdf/model';

/**
 * The affirmative, work-level rights determination the publish gate requires.
 *
 * Distinct from the copy-level `Rights` (`@/model/rights`, the per-ark Gallica
 * `dc:rights` classification on a `RepositoryRecord`): this is a controlled,
 * hand-authored, work-level value that the publish gate reads. Only affirmative
 * distributable members clear the gate; every other state (including absent
 * `rights`) fails closed (FR-002, Constitution IV, fail-closed).
 *
 * See specs/008-edition-publishing/data-model.md § 1 SourceRights.
 */
export type SourceRightsStatus =
  /** v1 affirmative / distributable value -- clears the publish gate. */
  | 'public-domain'
  // Documented-extensible, NOT yet cleared for v1 (non-blocking; the gate
  // treats only affirmative-distributable members -- currently just
  // `public-domain` -- as clearing):
  | 'openly-licensed'
  | 'gov-reusable';

/**
 * The affirmative publish-gate determination recorded on a `Source`.
 *
 * See specs/008-edition-publishing/data-model.md § 1 SourceRights.
 */
export interface SourceRights {
  /**
   * Controlled vocab (validated against `@/bibliography/vocab` at load).
   * Only affirmative-distributable values (v1: `public-domain`) clear the gate.
   */
  status: SourceRightsStatus;
  /**
   * Free-text justification, recorded as `Publication.rightsBasis` on the
   * cleared publication, e.g. "1881 imprint; French public domain" (FR-005).
   */
  basis: string;
  /** When the determination was made (ISO date). */
  determinedAt?: string;
}

/**
 * Reference to the per-issue integrity manifest file for one publication.
 *
 * Mirrors `AssetManifestRef` (`@/model/repository-record`): the lean on-source
 * entry points at a separate manifest file whose per-issue integrity lives
 * outside the source YAML (FR-006).
 *
 * See specs/008-edition-publishing/data-model.md § 2 PublicationManifestRef.
 */
export interface PublicationManifestRef {
  /** Repo-relative path to the manifest file under `bibliography/publications/`. */
  manifestPath: string;
  /** Derived count of published issues in the manifest. */
  issueCount: number;
}

/**
 * One published derivative edition (one variant, from one pinned snapshot),
 * an entry on `Source.publications[]`.
 *
 * A `Publication` is to `publications[]` what a `RepositoryRecord` is to
 * `repositoryRecords[]`: a lean entry whose per-issue integrity lives in a
 * referenced manifest file. Identified by `(variant, snapshotShort)`; a
 * re-publish of the identical version is a no-op, a changed rebuild produces a
 * new entry (never a mutation of the old; FR-004/FR-009).
 *
 * See specs/008-edition-publishing/data-model.md § 2 Publication.
 */
export interface Publication {
  /** Which edition variant was published (FR-012). */
  variant: 'parallel' | 'english-only';
  /** Publish date (ISO) (FR-005). */
  publishedAt: string;
  /**
   * The FULL pinned archive-commit ref the build came from
   * (`site/data/archive-source.json` `.ref`); the key uses its short form.
   */
  snapshot: string;
  /** The short form embedded in the versioned key (the version token, FR-003). */
  snapshotShort: string;
  /**
   * The recorded canonical CDN base (`${CORPUS_CDN_BASE}`), so per-issue URLs
   * are reconstructable and a future custom-domain move is a base rewrite
   * (FR-014).
   */
  cdnBase: string;
  /**
   * `versioned` for new publications; `legacy-flat` for the reconciled 72
   * (FR-013) -- makes the two coexisting URL shapes explicit in the record.
   */
  keyScheme: 'versioned' | 'legacy-flat';
  /** The `SourceRights.basis` that cleared the gate (FR-005). */
  rightsBasis: string;
  /**
   * Engine + date for machine-assisted translation. Modeled optional, but
   * REQUIRED for any variant carrying machine translation -- both in-scope
   * variants qualify (`english-only` = EN; `parallel` = FR OCR | EN), so both
   * MUST carry it (Constitution IV: translations MUST be labeled
   * machine-assisted unless human-reviewed). Absent ONLY for a hypothetical
   * pure-facsimile variant (none in v1 scope). Reuses `@/pdf/model`'s
   * `MachineAssistLabel` so the invariant stays consistent between the PDF
   * colophon and its publication record.
   */
  machineAssist?: MachineAssistLabel;
  /** Reference to the per-issue integrity manifest file (FR-006). */
  manifest: PublicationManifestRef;
}

/**
 * One published issue PDF's integrity record, an element of
 * `PublicationManifest.issues[]`.
 *
 * See specs/008-edition-publishing/data-model.md § 3 PublishedArtifactRef.
 */
export interface PublishedArtifactRef {
  /** The built item id (`build/pdf/<sourceId>/<issueId>.pdf`). */
  issueId: string;
  /** Canonical public CDN URL `${cdnBase}/${key}`; derived, never free-typed (FR-006/FR-014). */
  url: string;
  /** The object-store key (versioned or legacy-flat). */
  key: string;
  /** Lowercase-hex sha256 (64 chars) of the published PDF bytes (FR-007). */
  sha256: string;
  /**
   * The built PDF's page count. Source: the build's per-item
   * `<issueId>.input.json`, NOT parsed from PDF bytes.
   */
  pages: number;
}

/**
 * The per-issue integrity file referenced by `Publication.manifest.manifestPath`.
 *
 * A standalone file (NOT inlined in the source YAML) at
 * `bibliography/publications/<sourceId>-<variant>-<snapshotShort>.yml` (for the
 * reconciled 72: `<sourceId>-<variant>-legacy.yml`). Keeps the source YAML lean;
 * one manifest per published version. Emitted deterministically (fixed key
 * order, issues sorted by `issueId`) for idempotent re-serialization (SC-004).
 *
 * See specs/008-edition-publishing/data-model.md § 3 PublicationManifest.
 */
export interface PublicationManifest {
  /** Owning source (FK). */
  sourceId: string;
  /** Matches the owning publication entry. */
  variant: 'parallel' | 'english-only';
  /** Full ref; absent (or `legacy`) for the reconciled flat set. */
  snapshot?: string;
  /** One entry per published issue PDF. */
  issues: PublishedArtifactRef[];
}
