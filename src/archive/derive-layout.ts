import type { Source } from '@/model/source';

/**
 * The GENERIC archive-layout derivation (spec 018-corpus-config-seam, FR-017
 * step 3) plus the {@link SourceLayout} shape it produces.
 *
 * Extracted from `@/archive/location` by T013 so that the derivation stays a
 * PURE function of a `Source` -- no disk, no policy, no corpus config -- and
 * so that `@/corpus/policies` (which precomputes the per-sourceId derivation
 * when the `ArchiveLayoutPolicy` is built) can import it WITHOUT pulling in
 * the resolution/bootstrap machinery that imports `@/corpus/policies` back.
 * `@/archive/location` re-exports everything here, so its ~40 importers are
 * unaffected.
 */

/**
 * The archive-relative layout for a source. There is no fallback: an unknown
 * source ID throws (the layout is authoritative metadata, not a default).
 *
 * `kind` (FR-016) distinguishes a periodical (many dated issues, enumerated by
 * a census) from a monograph (a single Gallica document ark with no census --
 * one "issue" is the whole document). It determines which directory shape a
 * source's pages are written into: `issueDir` (dated per-issue
 * subdirectories) for `periodical`, `monographDir` (one flat directory)
 * for `monograph`.
 */
export interface SourceLayout {
  /** Case folder, e.g. `port-breton`. */
  case: string;
  /** Material-type folder, e.g. `newspapers`, `books`. */
  type: string;
  /** Source slug, e.g. `la-nouvelle-france`. */
  slug: string;
  /** Periodical (census-driven, dated issue dirs) or monograph (single doc). */
  kind: 'periodical' | 'monograph';
}

/** Structural equality for two {@link SourceLayout} values. */
export function layoutsEqual(a: SourceLayout, b: SourceLayout): boolean {
  return a.case === b.case && a.type === b.type && a.slug === b.slug && a.kind === b.kind;
}

/** Maximum length of a derived slug (see {@link deriveSourceLayout}). */
const MAX_DERIVED_SLUG_LENGTH = 80;

/**
 * Slugify free text into a lowercase, hyphen-separated archive slug: accents
 * transliterated to ASCII (`é` -> `e`) via Unicode NFD decomposition, lowercased,
 * any run of non-alphanumeric characters collapsed to a single `-`, leading/
 * trailing hyphens trimmed, and capped to {@link MAX_DERIVED_SLUG_LENGTH}
 * characters at a WORD boundary (never cutting mid-word or ending mid-hyphen).
 */
function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics: e-acute -> e
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= MAX_DERIVED_SLUG_LENGTH) {
    return slug;
  }
  // Truncate at the last word boundary within the cap so the slug never ends
  // mid-word (a bare `slice` can chop "sténographie" to "st-no").
  const capped = slug.slice(0, MAX_DERIVED_SLUG_LENGTH);
  const lastHyphen = capped.lastIndexOf('-');
  const trimmed = lastHyphen > 0 ? capped.slice(0, lastHyphen) : capped;
  return trimmed.replace(/-+$/g, '');
}

/**
 * Derive a source-group member's slug from its titles: prefers the `canonical`
 * title, falling back to the first title of any role; falls back to the
 * lowercased `sourceId` when the source has no titles at all (or its titles
 * slugify to an empty string, e.g. a title that is pure punctuation).
 */
function deriveSlug(source: Source): string {
  const canonical = source.titles.find((title) => title.role === 'canonical');
  const chosenTitle = canonical ?? source.titles[0];
  const fromTitle = chosenTitle !== undefined ? slugify(chosenTitle.text) : '';
  return fromTitle.length > 0 ? fromTitle : slugify(source.sourceId);
}

/**
 * Derive a {@link SourceLayout} for a source from its own data -- the GENERIC
 * rule (FR-017 step 3). Used two ways: precomputed per sourceId when the
 * `ArchiveLayoutPolicy` is constructed (`@/corpus/policies`'
 * `deriveArchiveLayoutPolicy`), and on demand to auto-register a RUNTIME
 * layout (via `registerSourceLayout`) for a source-group member created
 * mid-run by `bib inventory`, which no precomputed map can contain. A member
 * is always `monograph`, `periodical`, or `archival-item`, never
 * `source-group` (enforced by `Source.kind` elsewhere; this function does not
 * re-validate that).
 *
 * - `case`: `source.case` if present, else `fallbackCase` (e.g. the owning
 *   group's `case`). Throws (fail loud) if NEITHER is available -- a layout
 *   with no case cannot be placed in the archive's `cases/<case>/` tree.
 * - `type`: `newspapers` for a `periodical` source, `books` otherwise
 *   (including `archival-item`, which are discrete objects like monographs).
 * - `slug`: derived from the source's canonical (or first) title, lowercased
 *   with non-alphanumeric runs collapsed to `-`; falls back to the lowercased
 *   `sourceId` when the source has no usable title (see {@link deriveSlug}).
 * - `kind`: `periodical` for a STANDALONE periodical source (no `partOf`),
 *   `monograph` otherwise. `kind` here is a RESOLUTION STRATEGY (which
 *   directory shape the reader/OCR walk -- `issueDir`'s dated subdirectories
 *   vs `monographDir`'s flat directory), not a copy of the source's
 *   bibliographic `Source.kind`. A source-group MEMBER (`source.partOf` set)
 *   is filed FLAT on disk regardless of its bibliographic kind -- a
 *   periodical member's folios sit directly in its slug directory
 *   (`f001.yml..fNNN.yml`), with no per-issue census (the group itself is the
 *   organizing structure, not dated issues) -- so a member always derives
 *   `kind: 'monograph'` to route it at `monographDir`/flat resolution. Only a
 *   standalone periodical (no `partOf`) keeps `kind: 'periodical'`, since
 *   ONLY that shape is actually enumerated by a census into dated issue
 *   directories.
 */
export function deriveSourceLayout(source: Source, fallbackCase?: string): SourceLayout {
  const resolvedCase = source.case ?? fallbackCase;
  if (resolvedCase === undefined || resolvedCase.trim().length === 0) {
    throw new Error(
      `deriveSourceLayout: source "${source.sourceId}" has no "case" and no fallback case was ` +
        `given -- an archive layout cannot be derived without one`,
    );
  }
  const isPeriodical = source.kind === 'periodical';
  const isMember = source.partOf !== undefined;
  return {
    case: resolvedCase,
    type: isPeriodical ? 'newspapers' : 'books',
    slug: deriveSlug(source),
    kind: isPeriodical && !isMember ? 'periodical' : 'monograph',
  };
}
