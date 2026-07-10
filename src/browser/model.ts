/**
 * The corpus-browser view-model -- the normalized, in-memory shape the Astro
 * site renders. Derived at build time from the archive clone + bibliography
 * SSOT (see `src/browser/load/corpus.ts`); never persisted.
 *
 * Pure type definitions only -- no runtime logic lives here.
 *
 * See specs/005-corpus-browser/data-model.md and
 * specs/005-corpus-browser/contracts/{corpus-loader,image-provider,search-document}.md.
 */

/**
 * The whole browsable corpus for a build.
 *
 * Validation (enforced by the loader, not this type): at least one source;
 * every source resolvable end-to-end or the build throws.
 */
export interface CorpusView {
  /** One per source populated in this build (v1: PB-P001 only). */
  sources: SourceView[];
}

/**
 * One scanned issue directory the loader deliberately SKIPPED because a whole
 * required layer was entirely absent (never collected / incomplete), rather
 * than throwing. Distinct from a collected-but-corrupt issue (a present layer
 * that is internally inconsistent), which still fails the build loud.
 *
 * Every skip is reported (never silently dropped): the loader records one of
 * these and emits a `console.warn` line so a build visibly reports its caps.
 */
export interface SkippedIssue {
  /** Stable slug of the skipped issue directory (e.g. `1883-12-16_bpt6k5606895j`). */
  issueId: string;
  /** The source the skipped issue belongs to (e.g. `PB-P001`). */
  sourceId: string;
  /** Human-readable explanation naming the absent layer(s). */
  reason: string;
}

/**
 * The result of {@link CorpusView} loading: the corpus of complete issues plus
 * the report of issues that were skipped because they were not fully collected.
 * Corrupt issues never appear here -- they throw.
 */
export interface LoadResult {
  /** The complete, renderable corpus (skipped issues excluded). */
  corpus: CorpusView;
  /** Every not-collected/incomplete issue skipped during the load, across all sources. */
  skipped: SkippedIssue[];
}

/**
 * A source's kind, as reflected in the loaded view. A `'periodical'` resolves
 * to many issue directories under `newspapers/<slug>`; a `'monograph'` (a
 * book) resolves to exactly ONE unit -- its book directory under `books/` --
 * rendered as a single {@link IssueView}. `'source-group'` is not a loadable
 * corpus kind (it holds no assets of its own) and is not part of this union.
 */
export type SourceKind = 'periodical' | 'monograph';

/**
 * One bibliographic source (e.g. a periodical) and its issues.
 *
 * Validation: `ark` required when the active {@link ImageProviderConfig} is
 * `source-iiif`; `title` and `sourceId` required always.
 */
export interface SourceView {
  /** Canonical id, e.g. `PB-P001` (from the SSOT `sourceId`). */
  sourceId: string;
  /** Canonical title (SSOT `titles[role=canonical]`). */
  title: string;
  /** SSOT `kind` (`'periodical'` or `'monograph'`). */
  kind: SourceKind;
  /** Archival identifier (SSOT repository record / page sidecars); used by the `source-iiif` provider. */
  ark: string;
  /** Rights determination, e.g. `public-domain`. */
  rights: string;
  /** Ordered by date. */
  issues: IssueView[];
}

/**
 * One issue of a {@link SourceView}.
 *
 * Validation: `pageCount` MUST equal the image count, the OCR form-feed
 * segment count, and the `translation/pNNN.*` count, or the build throws
 * (corpus-loader G-1).
 */
export interface IssueView {
  /** Stable slug, derived from the issue directory name (e.g. `1879-08-15_bpt6k56068358`). */
  issueId: string;
  /** ISO date (`1879-08-15`) parsed from the directory / sidecar. */
  date: string;
  /** Order within the source. */
  sequence: number;
  /** Ordered by page number. */
  pages: PageView[];
  /** MUST equal `pages.length` and the underlying OCR/image/translation counts. */
  pageCount: number;
}

/**
 * The unit the reading view renders.
 *
 * Validation: `english` and `ocrFrench` required (throw if missing); `image`
 * must resolve or throw; `provenance` fully populated or throw
 * (corpus-loader G-2, G-3).
 */
export interface PageView {
  /** Stable page identifier within the issue (e.g. `p001`). */
  pageId: string;
  /** The image/view id (`f001`) -- distinct from `pageId` though 1:1 for observed issues. */
  folioId: string;
  /** Resolved by the active {@link ImageProviderConfig}. */
  image: ImageDescriptor;
  /** Raw French OCR for this page (a form-feed segment of `issue.txt`); may be noisy. */
  ocrFrench: string;
  /** Corrected French (`translation/pNNN.fr.txt`) when present. */
  correctedFrench: string | null;
  /** English translation (`translation/pNNN.en.txt`). */
  english: string;
  /** The provenance-rail facts. */
  provenance: ProvenanceRecord;
  /** A surfaced OCR-condition note (e.g. "Contraste insuffisant") when detected, so the reading view can frame noisy OCR. */
  ocrCondition: string | null;
}

/**
 * Provider-agnostic image handle the viewer consumes (FR-012). Built by the
 * active {@link ImageProviderConfig}; the viewer never knows which provider
 * produced it (image-provider contract G-3).
 */
export interface ImageDescriptor {
  /** Tile source (`iiif`) vs single image (`full-image`). */
  kind: 'iiif' | 'full-image';
  /** The IIIF info/image base (`iiif`) or the full-image URL (`full-image`). */
  url: string;
  /** Known image width, when available, for viewer sizing. */
  width?: number;
  /** Known image height, when available, for viewer sizing. */
  height?: number;
}

/**
 * Selects how {@link ImageDescriptor}s are built (FR-011; dependency
 * injection, no inheritance). A discriminated union so each variant's
 * required fields are enforced at the type level.
 *
 * Validation: the selected variant's required fields (e.g. `cdnBase`) MUST
 * be present or the build throws -- no fallback to the other provider
 * (FR-013; image-provider contract G-1).
 */
export type ImageProviderConfig =
  | { kind: 'source-iiif' }
  | { kind: 'b2-cdn'; cdnBase: string };

/**
 * The identifying facts rendered in the monospace provenance rail (FR-014),
 * assembled from the page sidecar + SSOT.
 *
 * Validation: all fields required per page; a missing field throws
 * (SC-004: no page missing its provenance).
 */
export interface ProvenanceRecord {
  sourceId: string;
  /** Archival identifier / catalog ARK. */
  ark: string;
  /** Issue date. */
  date: string;
  /** Rights determination, e.g. `public-domain`. */
  rights: string;
  /** Page identifier. */
  page: string;
  /** Content hash from the sidecar. */
  sha256: string;
}

/**
 * The SERIALIZABLE, image-UNRESOLVED corpus form: the raw text + metadata read
 * from the archive (or a committed snapshot), carrying each page's image
 * HANDLES (`folioId`, `ark`, `objectStoreKey`) but NOT a resolved
 * {@link ImageDescriptor}. `resolveImages(raw, provider)` (see
 * `src/browser/load/resolve-images.ts`) turns a {@link CorpusSnapshot} into the
 * rendered {@link CorpusView}. This is the shape written to `site/data/<sourceId>.json`
 * so the Astro build can run WITHOUT the private archive (see
 * `scripts/build-snapshot.ts`).
 */
export interface RawPage {
  /** Stable page identifier within the issue (e.g. `p001`). */
  pageId: string;
  /** The image/view id (`f001`). */
  folioId: string;
  /** The image-resolution ark (the ISSUE ark); handed to the provider as `PageInput.ark`. */
  ark: string;
  /** The archive `object_store` key for this page's image, or `null` when absent (used by `b2-cdn`). */
  objectStoreKey: string | null;
  /** Raw French OCR for this page (a form-feed segment of `issue.txt`); may be noisy. */
  ocrFrench: string;
  /** Corrected French (`translation/pNNN.fr.txt`) when present. */
  correctedFrench: string | null;
  /** English translation (`translation/pNNN.en.txt`). */
  english: string;
  /** A surfaced OCR-condition note when detected, else `null`. */
  ocrCondition: string | null;
  /** The provenance-rail facts. */
  provenance: ProvenanceRecord;
}

/** The image-unresolved form of {@link IssueView}. */
export interface RawIssue {
  /** Stable slug (e.g. `1879-08-15_bpt6k56068358`). */
  issueId: string;
  /** ISO date (`1879-08-15`). */
  date: string;
  /** Order within the source (1-based, over the LOADED/complete issues). */
  sequence: number;
  /** Ordered by page number. */
  pages: RawPage[];
}

/** The image-unresolved form of {@link SourceView}. */
export interface RawSource {
  /** Canonical id, e.g. `PB-P001`. */
  sourceId: string;
  /** Canonical title. */
  title: string;
  /** SSOT `kind` (`'periodical'` or `'monograph'`). */
  kind: SourceKind;
  /** Source-level archival identifier. */
  ark: string;
  /** Rights determination, e.g. `public-domain`. */
  rights: string;
  /** Ordered by date. */
  issues: RawIssue[];
}

/**
 * The serializable, image-unresolved corpus: the exact shape read from the
 * archive (`readRawCorpus`) and persisted as the committed public-domain
 * snapshot (`site/data/<sourceId>.json`). {@link resolveImages} converts it to
 * a {@link LoadResult}.
 */
export interface CorpusSnapshot {
  /** One per source in this snapshot. */
  sources: RawSource[];
  /** Issues skipped (not-collected/incomplete) while reading. */
  skipped: SkippedIssue[];
  /** Optional provenance of how this snapshot was generated (advisory; not rendered). */
  generatedFrom?: { sourceIds: string[]; note: string };
}

/**
 * One indexed unit fed to the Pagefind search index -- one per page, both
 * languages (FR-008..FR-010, OQ-5).
 *
 * Validation: `routeUrl` MUST resolve to an existing page route (search
 * contract G-3).
 */
export interface SearchDocument {
  pageId: string;
  issueId: string;
  sourceId: string;
  /** The page reading-view URL. */
  routeUrl: string;
  /** OCR (+ corrected French when present) for indexing. */
  french: string;
  /** English translation for indexing. */
  english: string;
}
