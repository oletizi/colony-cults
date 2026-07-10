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
 * A source's kind. `'periodical'` is the only value produced in v1; the
 * union is intentionally left open to widen with `'monograph' |
 * 'source-group'` later (OQ-7 deferred) without a breaking change to
 * `SourceView.kind`'s declared type.
 */
export type SourceKind = 'periodical';

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
  /** SSOT `kind`; v1 always produces `'periodical'`. */
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
