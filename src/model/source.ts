import type { WorkLevelIdentifierType } from '@/model/identifiers';

/**
 * An archive-independent work. A `Source` describes the work itself; the
 * concrete held copy at a given archive (ark, rights, assets, ...) lives in
 * a separate `RepositoryRecord` keyed by `sourceId`.
 *
 * See specs/004-canonical-source-metadata/data-model.md § Source.
 */
export interface Source {
  /** Colony Cults ID, e.g. `PB-P001`. Primary key. */
  sourceId: string;
  /** One or more titles; none is authoritative (FR-003). */
  titles: Title[];
  /**
   * Determines whether a census is built. A `source-group` (FR-001) is a
   * research-defined container of member Sources -- it is never fetchable and
   * holds no repository records; its members are derived from their `partOf`
   * edges, not listed here.
   */
  kind: 'periodical' | 'monograph' | 'source-group';
  /**
   * The `sourceId` of the source-group this Source is a member of (FR-006).
   * Present only on members; absent on standalone sources and on the group
   * itself. Its presence does NOT change the member's own kind -- a member is
   * still a `monograph`/`periodical`. Group membership is derived from these
   * edges (a group holds no member list).
   */
  partOf?: string;
  /** Author/editor of the work, if known. */
  creator?: string;
  /** Primary language of the work, e.g. `French`. */
  language?: string;
  /** Work-level identifiers (ISBN/ISSN/OCLC); copy-level ids live elsewhere. */
  identifiers: WorkIdentifier[];
  /** Corpus grouping, e.g. `port-breton`. */
  case?: string;
  /** Free-text notes. */
  notes?: string;
}

/**
 * One title of a {@link Source}. Multiple titles may coexist (canonical,
 * archive-supplied, alternate, translated) with no single one marked
 * authoritative -- deliberate per FR-003.
 */
export interface Title {
  /** The title text. */
  text: string;
  /** How this title relates to the work. */
  role: 'canonical' | 'archive' | 'alternate' | 'translated';
  /** Language of this title, if different from the work's primary language. */
  language?: string;
}

/** A work-level identifier (ISBN/ISSN/OCLC). */
export interface WorkIdentifier {
  /** Identifier type; must classify as `'work'` via `classifyIdentifier`. */
  type: WorkLevelIdentifierType;
  /** The identifier value, e.g. `978-0-000-00000-0`. */
  value: string;
}
