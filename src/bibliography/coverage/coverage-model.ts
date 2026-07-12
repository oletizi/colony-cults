import type { LoadedSource } from '@/bibliography/load';
import type { SearchLogEntry } from '@/bibliography/search-log';
import type { EvidenceClass, SourceLifecycleStatus } from '@/bibliography/vocab';

/**
 * The `CoverageReport` and its sub-structures are the DERIVED projection over
 * the loaded canonical model + search-log (specs/007-corpus-coverage-audit
 * data-model.md § Derived structures). They are computed on demand, never
 * persisted. This module owns the type spec and a PURE builder over
 * already-loaded data -- it performs NO file I/O, so it is trivially testable
 * and the CLI (T006) owns the loading.
 *
 * This is the SKELETON (T007): the top-level structure is wired and every
 * section is present but EMPTY/zero. The per-section computation lands in later
 * tasks, each marked below with its task id so its home is unambiguous.
 */

/**
 * One source-group's coverage roll-up. Counts are PER WORK (`Source`), never
 * per RepositoryRecord: a work held at N archives contributes 1 to lifecycle
 * counts (data-model.md § Per-work counting rule, INV-3).
 */
export interface CampaignCoverage {
  /** The source-group `sourceId` this roll-up is for. */
  campaign: string;
  /**
   * Member works bucketed by their own lifecycle state; `'unset'` collects
   * members with no authored `status`. Per work, not per copy.
   */
  membersByLifecycleState: { state: SourceLifecycleStatus | 'unset'; count: number }[];
  /** Count of actual member works, DERIVED from `partOf` edges (per work). */
  actualMemberCount: number;
  /** The authored believed extent (denominator), or `'unknown'` when absent. */
  knownMemberCount: number | 'unknown';
  /** `knownMemberCount - actualMemberCount`, or the literal `'unknown'`. */
  gap: number | 'unknown';
}

/**
 * One entry in the unresolved-references register -- either an unresolved
 * `Reference` (a referenced-but-unidentified work) or a `SuspectedGap`
 * (an inferred, uncited gap).
 */
export interface RegisterEntry {
  /** Which authored population this entry came from. */
  kind: 'reference' | 'suspected';
  /** How the cited work appears (references only). */
  citedAs?: string;
  /** What is suspected to exist (suspected gaps only). */
  description?: string;
  /** Free-form basis prose, when authored. */
  basis?: string;
  /** The `sourceId` (references) or source-group id (suspected) this entry belongs to. */
  owner: string;
}

/** One repository-axis rollup row: a repository treated as a research object. */
export interface RepositoryRollup {
  repository: string;
  lastSearched: string;
  openQuestions: string[];
}

/** One repository x campaign search-history cell. */
export interface SearchMatrixCell {
  repository: string;
  campaign: string;
  lastSearched: string;
  openQuestions: string[];
}

/** The unresolved-references register, grouped by campaign + an ungrouped bucket. */
export interface CoverageRegister {
  /** Unresolved references + suspected gaps grouped by owning campaign. */
  byCampaign: { campaign: string; entries: RegisterEntry[] }[];
  /** References on sources with no `partOf` ("no campaign"). */
  ungrouped: RegisterEntry[];
}

/** The search-history projection: a repository x campaign matrix + a repository rollup. */
export interface CoverageSearchHistory {
  matrix: SearchMatrixCell[];
  byRepository: RepositoryRollup[];
}

/**
 * The whole derived coverage projection. Key order here is STABLE by
 * construction (see {@link buildCoverageReport}) so `--json` rendering is
 * byte-deterministic (contract INV / Deterministic requirement).
 */
export interface CoverageReport {
  /** One entry per source-group. */
  perCampaign: CampaignCoverage[];
  /** Corpus-wide evidence-class counts, plus an `'unclassified'` bucket. */
  evidenceClassDistribution: { class: EvidenceClass | 'unclassified'; count: number }[];
  /** The unresolved-references register. */
  register: CoverageRegister;
  /** The search-history projection. */
  searchHistory: CoverageSearchHistory;
}

/**
 * The already-loaded inputs the pure builder projects over. The builder does
 * NOT read files -- the caller (CLI, T006) loads `sources` via `loadAllSources`
 * and `searchLog` via `loadSearchLog` and passes them in. Each {@link LoadedSource}
 * carries its per-source authored `records`, which the per-work counting rule
 * (T010) needs to derive `copiesByArchive` without collapsing multi-archive
 * works into duplicate lifecycle counts.
 */
export interface CoverageInput {
  /** Loaded SSOT sources, each with its authored repository records. */
  sources: readonly LoadedSource[];
  /** Loaded, validated search-log entries (may be empty). */
  searchLog: readonly SearchLogEntry[];
}

/** True for a loaded source that is a source-group (a campaign). */
function isCampaign(loaded: LoadedSource): boolean {
  return loaded.source.kind === 'source-group';
}

/**
 * Build the {@link CoverageReport} projection from already-loaded data. PURE:
 * no file I/O, deterministic, and total (an empty corpus yields an all-empty
 * report, never a throw).
 *
 * SKELETON (T007): the top-level shape is wired -- one {@link CampaignCoverage}
 * per source-group, a per-campaign register bucket per campaign, and every
 * section present. All computed values are deterministic EMPTY/zero
 * placeholders; the real per-section logic lands in the tasks named below.
 */
export function buildCoverageReport(input: CoverageInput): CoverageReport {
  const campaigns = input.sources.filter(isCampaign);

  // One CampaignCoverage per source-group. T010 fills the real counts.
  const perCampaign: CampaignCoverage[] = campaigns.map((loaded) => ({
    campaign: loaded.source.sourceId,
    // T010: per-campaign lifecycle counts (per work, dedupe multi-archive).
    membersByLifecycleState: [],
    // T010: derived actual member count from partOf edges.
    actualMemberCount: 0,
    // T010: authored knownMemberCount (or 'unknown' when absent).
    knownMemberCount: 'unknown',
    // T010: knownMemberCount - actual, or the literal 'unknown'.
    gap: 'unknown',
  }));

  // T028: corpus-wide evidence-class distribution (with 'unclassified').
  const evidenceClassDistribution: { class: EvidenceClass | 'unclassified'; count: number }[] = [];

  // T016/T019: unresolved references + suspected gaps, grouped by campaign,
  // plus the ungrouped ("no campaign") bucket. Skeleton seeds one empty bucket
  // per campaign so the render has a deterministic home per group.
  const register: CoverageRegister = {
    byCampaign: campaigns.map((loaded) => ({ campaign: loaded.source.sourceId, entries: [] })),
    ungrouped: [],
  };

  // T025: repository x campaign matrix + repository-axis rollup.
  const searchHistory: CoverageSearchHistory = {
    matrix: [],
    byRepository: [],
  };

  return { perCampaign, evidenceClassDistribution, register, searchHistory };
}
