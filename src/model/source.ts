import type {
  CitedKind,
  EvidenceClass,
  SourceCentrality,
  SourceLifecycleStatus,
} from '@/bibliography/vocab';
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
   * Determines whether a census is built. The structural kind of this work:
   * `periodical` (serial) / `monograph` (monographic textual work) /
   * `archival-item` (discrete non-serial archival work, e.g. photograph, letter,
   * postcard, certificate) / `source-group` (non-fetchable work bundle). A
   * `source-group` (FR-001) is a research-defined container of member Sources
   * -- it is never fetchable and holds no repository records; its members are
   * derived from their `partOf` edges, not listed here. A member's `kind` may be
   * any of `periodical`, `monograph`, or `archival-item` -- group membership does
   * not change the member's own kind.
   */
  kind: 'periodical' | 'monograph' | 'archival-item' | 'source-group';
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
   * This source's relation to the corpus's central subject. Absent or
   * `'central'` is a core corpus work; `'adjacent'` marks a corpus-adjacent
   * source -- preserved and potentially interesting, but NOT central to what
   * the corpus is about (e.g. New Italy settlement material held alongside,
   * yet distinct from, the Port Breton affair). Adjacent members are counted
   * separately by the coverage report, never toward the central-corpus total.
   */
  centrality?: SourceCentrality;
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
   * A discriminated union (specs/011-museum-acquisition-path/data-model.md §
   * KnownExtent), replacing the earlier scalar `knownMemberCount: number |
   * 'unknown'` (removed, no back-compat): `measured` records a finite
   * hand-authored belief (`count`) with its `basis`; `unexamined` means the
   * extent has not yet been assessed; `irreducible` means the group's extent
   * is fundamentally unbounded/unknowable (e.g. a heterogeneous, changing
   * museum holding), with `basis` explaining why. Absent is treated as
   * `{ state: 'unexamined' }` by the report -- never fabricated onto the
   * loaded Source itself.
   */
  knownExtent?: KnownExtent;
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
   * By-path pointer to this source's ROLLUP thorough summary artifact
   * (`source.summary.long.en.md`), an archive-relative path string -- spec 017
   * (FR-007), mirroring the existing `census:` by-path idiom
   * (`@/model/repository-record`'s `RepositoryRecord.census`). The exhaustive
   * summary prose is NEVER inlined into the structured SSOT (SC-005 -- 0 prose
   * inlines); the record holds ONLY the path, and the summary stays a
   * regenerable git-resident markdown artifact (`object_store: null`). Absent
   * until a rollup has been generated and referenced; a light
   * `validateSummaryRef` (`@/bibliography/summary-reference`) asserts a present
   * value resolves to an existing artifact on disk (Decision 5).
   */
  summaryRef?: string;
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
  /**
   * The disposition of this lead (specs/011 § SuspectedLead.resolution), as a
   * discriminated union keyed on `state` -- illegal combinations (e.g. an
   * `identified` lead with no `candidate`) are unrepresentable in the type,
   * not merely rejected at runtime. Absent means the lead has not been
   * dispositioned; by convention that is treated as `unexamined`, but an
   * absent `resolution` is never fabricated into an explicit `{ state:
   * 'unexamined' }` object on load -- see `@/bibliography/load-coverage-fields`.
   */
  resolution?: LeadResolution;
}

/**
 * The disposition of a {@link SuspectedGap} lead (specs/011 § SuspectedLead.
 * resolution). A discriminated union keyed on `state`: each state carries
 * exactly the fields it needs, so e.g. an `excluded` lead without a `reason`
 * cannot be constructed -- illegal states are unrepresentable, not just
 * rejected by the loader. `unexamined` is the initial/default disposition (no
 * extra fields); `identified` records a candidate repository reference found
 * but not yet inventoried as a Source; `inventoried` records the `sourceId`
 * the lead resolved to once a Source was authored for it; `excluded` and
 * `unavailable` are both terminal-with-reason dead ends (excluded: judged not
 * worth pursuing; unavailable: pursued but could not be obtained).
 */
export type LeadResolution =
  | { state: 'unexamined' }
  | { state: 'identified'; candidate: string; resolvedAt: string }
  | { state: 'inventoried'; sourceId: string; resolvedAt: string }
  | { state: 'excluded'; reason: string; resolvedAt: string }
  | { state: 'unavailable'; reason: string; resolvedAt: string };

/**
 * The believed extent of a {@link Source.knownExtent} (specs/011-museum-
 * acquisition-path/data-model.md § KnownExtent). A discriminated union keyed
 * on `state`: `measured` records a finite hand-authored belief (`count`) with
 * its `basis` -- distinct from the *derived* actual member count, this is
 * what SHOULD exist; `unexamined` means the extent has not yet been assessed
 * (the initial/default disposition, same convention as `LeadResolution`);
 * `irreducible` means the group's extent is fundamentally
 * unbounded/unknowable (e.g. a heterogeneous, changing museum holding with no
 * stable finite public-domain boundary), with `basis` explaining why. Illegal
 * combinations (a `measured` extent with no `count`, an `irreducible` extent
 * with no `basis`) are unrepresentable in the type, not merely rejected at
 * runtime. Replaces the earlier scalar `knownMemberCount: number | 'unknown'`
 * -- the bare literal `'unknown'` and the old scalar shape are REMOVED; a
 * loaded Source carrying either fails loud (no back-compat alias).
 */
export type KnownExtent =
  | { state: 'measured'; count: number; basis: string }
  | { state: 'unexamined' }
  | { state: 'irreducible'; basis: string };
