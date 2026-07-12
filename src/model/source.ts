import type { CitedKind, EvidenceClass, SourceLifecycleStatus } from '@/bibliography/vocab';
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
  /**
   * The discovery/acquisition-handoff lifecycle status of this Source itself
   * (US3), e.g. `discovered` on a member stub not yet reviewed for inclusion.
   * A DIFFERENT, narrower state machine from a RepositoryRecord's own
   * `status` (`RepositoryAcquisitionStatus`), which tracks the acquisition
   * state of one held copy at one archive; this field tracks the work-level
   * source, independent of any repository record, and ends where a
   * RepositoryRecord's status picks up (`approved-for-acquisition` ->
   * `wanted`/`to-collect`). An acquisition-only value (e.g. `archived`) is
   * REJECTED here as cross-domain (see `@/bibliography/load`). Absent on a
   * fully-processed Source with no lifecycle tracking needed.
   */
  status?: SourceLifecycleStatus;
  /** Author/editor of the work, if known. */
  creator?: string;
  /** Primary language of the work, e.g. `French`. */
  language?: string;
  /** Work-level identifiers (ISBN/ISSN/OCLC); copy-level ids live elsewhere. */
  identifiers: WorkIdentifier[];
  /** Corpus grouping, e.g. `port-breton`. */
  case?: string;
  /**
   * The genre/evidence class of this work, e.g. `pamphlet` or `trial-record`.
   * Orthogonal to the structural `kind` (a `monograph` may be a `pamphlet`,
   * `prospectus`, ...) -- this describes what kind of evidence the work IS,
   * not its structural role in the corpus. Absent -> counted *unclassified*
   * by the coverage report; that is expected, not an error.
   */
  evidenceClass?: EvidenceClass;
  /**
   * Citations mined FROM this source -- works this Source cites, quotes, or
   * otherwise points to, whether or not that cited work has been identified
   * in the corpus. Absent/empty means no citations have been mined yet, not
   * that the work cites nothing.
   */
  references?: Reference[];
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

/**
 * One citation mined FROM a {@link Source} -- a work this Source cites,
 * quotes, or otherwise points to. A `Reference` without `resolvedTo` is the
 * *referenced-but-unidentified* population: it is known that the citing
 * Source points to something, but that something has not yet been matched
 * to a `sourceId` in the corpus. Gaining a `resolvedTo` edge later is a
 * plain, hand-authored field edit, not a state-machine transition.
 */
export interface Reference {
  /** How the cited work appears in the citation, verbatim or near-verbatim. */
  citedAs: string;
  /** The kind of thing cited (journal/book/newspaper/...), if known. */
  citedKind?: CitedKind;
  /**
   * FREE-FORM prose explaining how/why this citation was made or found, e.g.
   * `"advertised in the colony's promotional matter"`. Deliberately NOT
   * validated against a vocabulary -- unlike `citedKind`, this is open text.
   */
  basis?: string;
  /**
   * The `sourceId` of the Source this citation has been identified as, once
   * discovered. Its absence means the citation is referenced-but-unidentified;
   * its presence is provenance for "how this source was found" -- i.e. this
   * Source was located BECAUSE the citing work pointed to it.
   */
  resolvedTo?: string;
  /** Free-text notes. */
  notes?: string;
}
