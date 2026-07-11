/**
 * The PDF Edition view model -- the pure, in-memory shape the PDF builder
 * assembles from the pinned snapshot + bibliography SSOT, then serializes to the
 * Typst input JSON. One `Edition` per bibliographic item (one PDF).
 *
 * Pure type definitions only -- no runtime logic lives here.
 *
 * Source of each field (per specs/007-corpus-print-pdf/data-model.md
 * "Source of each field"):
 *  - Snapshot (`@/browser/load/snapshot`): title, rights, ark(issue), page
 *    structure, ocrFrench, english, objectStoreKey, sha256, machine-assist label.
 *  - Bibliography SSOT (`@/bibliography`): creator, catalogUrl, source-level ark.
 *  - Pin file (`site/data/archive-source.json`): archiveRef.
 *  - B2 / IIIF at build: ImageAsset.bytesPath (+ width/height), sha256-verified.
 *
 * See specs/007-corpus-print-pdf/data-model.md for the full field + validation
 * spec. These are the OUTPUT view-model types; they are intentionally
 * self-contained and do not depend on `@/browser/model`.
 */

/**
 * The complete artifact model for ONE bibliographic item (one PDF): front
 * matter, ordered facing-page spreads, and reproducibility back matter.
 *
 * Validation (enforced by the builder, not this type): `pages.length >= 1`
 * (zero pages fails loud), `pages` ordered by source sequence, `itemId`
 * non-empty. `kind` is derived from `RawSource.kind` (`periodical` ->
 * per-issue `issue`; `monograph` -> `monograph`).
 */
export interface Edition {
  /** The built unit's id: issue id for a periodical issue; source id for a monograph. Source: snapshot. */
  itemId: string;
  /** Drives front-matter wording and the built-unit rule. Derived from snapshot `RawSource.kind`. */
  kind: 'issue' | 'monograph';
  /** Front-matter metadata. Source: snapshot `RawSource`/`RawIssue` + bibliography SSOT. */
  titlePage: TitlePageMeta;
  /** Ordered facing-page spreads (one per source page). Source: snapshot pages. */
  pages: EditionPage[];
  /** Reproducibility + framing back matter. Source: pin file + snapshot + fixed framing. */
  colophon: ColophonMeta;
}

/**
 * Front-matter source metadata (FR-004).
 *
 * Validation: `title` and `rights` non-empty (fail loud if absent).
 * `creator`/`ark`/`catalogUrl` may be `null` and render as "--"; they never
 * block the build (catalog completeness is not this feature's job).
 */
export interface TitlePageMeta {
  /** Canonical title. Source: snapshot `RawSource.title` (required). */
  title: string;
  /** Creator; `null` only if the SSOT omits it. Source: bibliography SSOT `Source.creator`. */
  creator: string | null;
  /** Issue date (`RawIssue.date`) for an issue; source date for a monograph. Source: snapshot. */
  date: string;
  /** Rights determination; must be present. Source: snapshot `RawSource.rights`. */
  rights: string;
  /** Stable identifier; issue-level ark from snapshot `RawPage.ark`, source ark via SSOT; `null` if absent. */
  ark: string | null;
  /** Catalog URL; `null` if absent. Source: bibliography SSOT `RepositoryRecord.catalogUrl`. */
  catalogUrl: string | null;
}

/**
 * One facing-page spread: verso facsimile, recto FR OCR | EN translation
 * (FR-002, FR-011).
 *
 * Validation: `english` non-empty -- a page without per-page EN FAILS LOUD
 * (FR-011; no issue-level fallback). `ocrFrench` non-empty. `image` present and
 * sha256-verified (see {@link ImageAsset}).
 */
export interface EditionPage {
  /** Stable page identifier within the issue (e.g. `p001`). Source: snapshot `RawPage.pageId`. */
  pageId: string;
  /** Image/view id (e.g. `f001`), used for the image request + running head. Source: snapshot `RawPage.folioId`. */
  folioId: string;
  /** The fetched, sha256-verified print-resolution scan (verso). Source: B2/IIIF at build. */
  image: ImageAsset;
  /** Recto left column: `RawPage.correctedFrench ?? RawPage.ocrFrench` (required). Source: snapshot. */
  ocrFrench: string;
  /** Recto right column: the per-page English translation (required). Source: snapshot `RawPage.english`. */
  english: string;
  /** Surfaced OCR-condition apparatus note, or `null`. Source: snapshot `RawPage.ocrCondition`. */
  ocrCondition: string | null;
}

/**
 * The print-resolution page scan embedded on the verso.
 *
 * Validation: `objectStoreKey` non-null/non-empty (a page with no key fails
 * loud -- FR-009); the fetched bytes' sha256 MUST equal `sha256` (mismatch
 * fails loud -- Principle III).
 */
export interface ImageAsset {
  /** B2 key; must be non-null. Source: snapshot `RawPage.objectStoreKey`. */
  objectStoreKey: string;
  /** Expected checksum. Source: snapshot `RawPage.provenance.sha256`. */
  sha256: string;
  /** Local path to the fetched, verified image (build temp dir). Source: B2/IIIF at build. */
  bytesPath: string;
  /** Which source served the bytes. Source: B2/IIIF at build. */
  provider: 'b2-cdn' | 'source-iiif';
  /** Pixel width if known, else `null`. Source: B2/IIIF at build. */
  width: number | null;
  /** Pixel height if known, else `null`. Source: B2/IIIF at build. */
  height: number | null;
}

/**
 * Reproducibility + critical framing back matter (FR-005, FR-016).
 *
 * Validation: `archiveRef` non-empty (no pin -> fail loud, not reproducible
 * without it); `images` covers every embedded image; `translation.engine` +
 * `translation.retrieved` present (the machine-assist label is mandatory --
 * Principle III / IV translation policy).
 */
export interface ColophonMeta {
  /** The pinned archive commit. Source: pin file `site/data/archive-source.json` `.ref`. */
  archiveRef: string;
  /** The built source id. Source: snapshot. */
  snapshotSourceId: string;
  /** Per embedded image: folio id + B2 key + checksum. Source: snapshot. */
  images: ColophonImage[];
  /** The machine-assisted translation label. Source: snapshot per-page translation provenance. */
  translation: MachineAssistLabel;
  /** The fixed critical-framing statement (propaganda held as evidence). Source: fixed constant. */
  framing: string;
}

/**
 * One embedded image's reproducibility record in the colophon.
 * Source: snapshot (per {@link EditionPage.image}).
 */
export interface ColophonImage {
  /** Image/view id (e.g. `f001`). Source: snapshot `RawPage.folioId`. */
  folioId: string;
  /** B2 key. Source: snapshot `RawPage.objectStoreKey`. */
  objectStoreKey: string;
  /** Content checksum. Source: snapshot `RawPage.provenance.sha256`. */
  sha256: string;
}

/**
 * The mandatory machine-assisted translation label (research Decision 3).
 * Source: snapshot per-page translation provenance (post-extension).
 *
 * Validation: `engine` and `retrieved` present (mandatory label).
 */
export interface MachineAssistLabel {
  /** Translation engine, e.g. `claude-code-cli` / `codex-cli`. Source: snapshot translation provenance. */
  engine: string;
  /** Model id if recorded, else `null`. Source: snapshot translation provenance. */
  model: string | null;
  /** ISO date the translation was produced. Source: snapshot translation provenance. */
  retrieved: string;
}
