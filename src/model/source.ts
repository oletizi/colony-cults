import type { CitedKind, EvidenceClass, SourceLifecycleStatus } from '@/bibliography/vocab';
import type { WorkLevelIdentifierType } from '@/model/identifiers';
import type { Publication, SourceRights } from '@/model/publication';

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
   * The affirmative, work-level rights determination the publish gate reads
   * (FR-002/FR-005). Only affirmative-distributable values (v1:
   * `public-domain`) clear the gate; absence fails closed. See
   * {@link SourceRights}.
   */
  rights?: SourceRights;
  /**
   * Citations mined FROM this source -- works this Source cites, quotes, or
   * otherwise points to, whether or not that cited work has been identified
   * in the corpus. Absent/empty means no citations have been mined yet, not
   * that the work cites nothing.
   */
  references?: Reference[];
  /**
   * The believed TOTAL extent of this source-group -- the denominator the
   * coverage report measures actual members (derived from `partOf` edges)
   * against. Valid ONLY on `kind: 'source-group'`; authoring it on any other
   * kind is an error (enforced by a later validation task, not the loader).
   * Distinct from the *derived* actual count: this is the hand-authored belief
   * about how many members SHOULD exist. The literal string `'unknown'` is
   * first-class and deliberately distinct from an incomplete group and from a
   * count of `0` -- `unknown != incomplete != 0`. Absent means the extent has
   * not been asserted (treated as `'unknown'` by the report).
   */
  knownMemberCount?: number | 'unknown';
  /**
   * Inferred, uncited pre-discovery gaps in this source-group -- works
   * suspected to exist from publication pattern, testimony, or indirect
   * mention, but NOT via a direct citation by an acquired source. Group-only
   * (valid on `kind: 'source-group'`). The boundary with {@link Reference}: a
   * gap whose basis IS a direct citation belongs in the citing Source's
   * `references[]` (the referenced-but-unidentified population), not here.
   */
  suspected?: SuspectedGap[];
  /** Free-text notes. */
  notes?: string;
  /**
   * Published derivative editions of this Source (FR-005). Distinct from
   * `repositoryRecords[]`: a `repositoryRecords[]` entry is another archive's
   * held copy of the work, while a `publications[]` entry is a derivative
   * edition WE published (built + rights-cleared + distributed by us). See
   * {@link Publication}.
   */
  publications?: Publication[];
  /**
   * Thread ids (`{kind:'thread'}` ScopeRef referents) this Source belongs to
   * -- a many-to-many, one-directional edge authored ONLY on the Source
   * (the existing `partOf` precedent; no fact stored twice, see
   * specs/010-corpus-model-coherence/data-model.md § Source and D7). Each id
   * MUST resolve to an entry in `bibliography/scopes.yml` (fail loud).
   * Reverse membership ("works in thread X") is derived at read time, never
   * stored on the thread registry. Absent/empty means no thread membership
   * has been authored -- expected for every Source this build (FR-011).
   */
  threads?: string[];
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

/**
 * One inferred, uncited gap in a source-group (element of
 * {@link Source.suspected}). A `SuspectedGap` records a work believed to exist
 * that has NOT yet been discovered and is NOT backed by a direct citation --
 * inferred instead from a publication pattern, testimony, or an indirect
 * mention. The boundary with {@link Reference}: a gap whose `basis` IS a direct
 * citation by an acquired source belongs in that source's `references[]` (the
 * referenced-but-unidentified population), not here.
 */
export interface SuspectedGap {
  /** What is suspected to exist (e.g. `"appeal-court records for the trial"`). */
  description: string;
  /**
   * FREE-FORM prose explaining WHY the gap is inferred, e.g. `"trial testimony
   * references an appeal not yet located"`. Deliberately NOT validated against
   * any vocabulary -- unlike `evidenceClass`, this is open explanatory text.
   */
  basis: string;
  /** The evidence class the suspected work is expected to be, if a class can be anticipated. */
  evidenceClass?: EvidenceClass;
  /** Free-text notes. */
  notes?: string;
}
