import type { LoadedSource } from '@/bibliography/load';
import { isFetchableWork, resolveScopeRef } from '@/bibliography/scope';
import type { ScopeResolutionContext } from '@/bibliography/scope';
import type { SearchLogEntry } from '@/bibliography/search-log';
import { EVIDENCE_CLASS_VALUES } from '@/bibliography/vocab';
import type { EvidenceClass, SourceLifecycleStatus } from '@/bibliography/vocab';
import { buildRegister } from '@/bibliography/coverage/coverage-register';
import { buildSearchHistory } from '@/bibliography/coverage/coverage-history';
import type { KnownExtent, LeadResolution } from '@/model/source';

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
export interface WorkBundleCoverage {
  /** The source-group (`work-bundle`) `sourceId` this roll-up is for. */
  workBundle: string;
  /**
   * Member works bucketed by their own lifecycle state; `'unset'` collects
   * members with no authored `status`. Per work, not per copy.
   */
  membersByLifecycleState: { state: SourceLifecycleStatus | 'unset'; count: number }[];
  /** Count of actual member works, DERIVED from `partOf` edges (per work). */
  actualMemberCount: number;
  /**
   * The authored believed extent (denominator), defaulted to
   * `{ state: 'unexamined' }` when absent (specs/011 § KnownExtent) -- never
   * a bare `'unknown'` literal.
   */
  knownExtent: KnownExtent;
  /**
   * `knownExtent.count - actualMemberCount` when `knownExtent.state ===
   * 'measured'`; otherwise the extent's OWN state word (`'unexamined'` /
   * `'irreducible'`) -- never a bare `'unknown'` literal.
   */
  gap: number | 'unexamined' | 'irreducible';
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
  /**
   * The lead's disposition (suspected gaps only; specs/011 § SuspectedLead.
   * resolution), carried through VERBATIM from `SuspectedGap.resolution`.
   * Absent here means the underlying gap authored no `resolution` -- the
   * renderer (`@/bibliography/coverage/coverage-render`), not this builder,
   * treats an absent resolution as `unexamined` for display; this field is
   * never fabricated into an explicit `{ state: 'unexamined' }` object so the
   * model stays a faithful mirror of what was authored.
   */
  resolution?: LeadResolution;
}

/** One repository-axis rollup row: a repository treated as a research object. */
export interface RepositoryRollup {
  repository: string;
  lastSearched: string;
  openQuestions: string[];
}

/**
 * One (repository, scope) search-history cell. `scope` is the KIND-LABELED
 * scope handle (`work-bundle PB-P004`, `work PB-P001`, `thread <id>`,
 * `case port-breton`) -- never a bare id (FR-009).
 */
export interface SearchMatrixCell {
  repository: string;
  scope: string;
  lastSearched: string;
  openQuestions: string[];
}

/**
 * One per-scope search-history rollup (FR-009/FR-012). `scope` is the
 * kind-labeled handle; `measuredClosure` is SEARCH-EVIDENCE-BASED -- `closed`
 * when the scope's searches leave no currently-open question, `open` otherwise
 * -- and is NEVER inferred from acquisition status (INV-CLOSURE).
 */
export interface ScopeCoverage {
  scope: string;
  lastSearched: string;
  openQuestions: string[];
  measuredClosure: 'closed' | 'open';
}

/** The unresolved-references register, grouped by work-bundle + an ungrouped bucket. */
export interface CoverageRegister {
  /** Unresolved references + suspected gaps grouped by owning work-bundle. */
  byWorkBundle: { workBundle: string; entries: RegisterEntry[] }[];
  /** References on sources with no `partOf` ("no work-bundle"). */
  ungrouped: RegisterEntry[];
}

/**
 * The search-history projection: a repository x scope matrix, a per-scope
 * rollup (with measured closure), and a repository-axis rollup.
 */
export interface CoverageSearchHistory {
  matrix: SearchMatrixCell[];
  byScope: ScopeCoverage[];
  byRepository: RepositoryRollup[];
}

/**
 * The whole derived coverage projection. Key order here is STABLE by
 * construction (see {@link buildCoverageReport}) so `--json` rendering is
 * byte-deterministic (contract INV / Deterministic requirement).
 */
export interface CoverageReport {
  /** One entry per source-group (work-bundle). */
  perWorkBundle: WorkBundleCoverage[];
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
  /**
   * The registered thread ids (from `bibliography/scopes.yml`) every
   * `{ kind: 'thread' }` search scope is resolved against -- see
   * `@/bibliography/scopes-registry`'s `threadIdSet`. Absent means NO thread
   * registry was supplied, i.e. an empty registry (FR-011: a valid, empty
   * registry); a `thread`-kind scope then correctly FAILS to resolve
   * (fail loud, INV-SCOPE) rather than being silently accepted. The CLI /
   * web-view loaders always supply this from the on-disk registry; only
   * in-memory tests with no thread scopes omit it.
   */
  threadIds?: ReadonlySet<string>;
}

/** True for a loaded source that is a source-group (a work-bundle). */
function isWorkBundle(loaded: LoadedSource): boolean {
  return loaded.source.kind === 'source-group';
}

/**
 * One source-group's coverage roll-up (T010, FR-010/FR-014). Member works are
 * the sources whose `partOf` points at this group -- counted PER WORK, never
 * per RepositoryRecord: `actualMemberCount` is the number of member `Source`s,
 * so a work held at N archives (N repository records) still contributes exactly
 * 1 (INV-3). Lifecycle buckets are keyed by each member's own `status`, with
 * `'unset'` collecting members that authored none, and are sorted by state name
 * for determinism. `knownExtent` is the group's authored belief (defaulted to
 * `{ state: 'unexamined' }` when absent); `gap` is the numeric difference when
 * `knownExtent.state === 'measured'`, else the extent's own state word
 * (never a bare `'unknown'` literal, never `0` for an unmeasured extent --
 * INV-2).
 */
function buildWorkBundleCoverage(
  group: LoadedSource,
  sources: readonly LoadedSource[],
): WorkBundleCoverage {
  const workBundle = group.source.sourceId;
  const members = sources.filter((loaded) => loaded.source.partOf === workBundle);

  const counts = new Map<SourceLifecycleStatus | 'unset', number>();
  for (const member of members) {
    const state: SourceLifecycleStatus | 'unset' = member.source.status ?? 'unset';
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  const membersByLifecycleState = [...counts.entries()]
    .map(([state, count]) => ({ state, count }))
    .sort((a, b) => a.state.localeCompare(b.state));

  const actualMemberCount = members.length;
  const knownExtent: KnownExtent = group.source.knownExtent ?? { state: 'unexamined' };
  const gap = knownExtent.state === 'measured' ? knownExtent.count - actualMemberCount : knownExtent.state;

  return { workBundle, membersByLifecycleState, actualMemberCount, knownExtent, gap };
}

/**
 * Corpus-wide evidence-class distribution (T028, FR-011; T014/T015, FR-008 /
 * INV-4 / INV-COUNT, specs/010-corpus-model-coherence). Counts WORKS ONLY --
 * a `kind: source-group` container (`isFetchableWork(source) === false`) is
 * excluded entirely, never landing in `'unclassified'` and never counted as a
 * work; see `@/bibliography/scope` (the single predicate every
 * approval/acquisition/counting consumer calls, never re-derived inline).
 * Every fetchable work is counted once, under its `evidenceClass` or the
 * `'unclassified'` bucket when it has none. Only non-empty buckets are
 * emitted, ordered by the canonical vocab order with `'unclassified'` last,
 * so the output is deterministic.
 */
function buildEvidenceDistribution(
  sources: readonly LoadedSource[],
): { class: EvidenceClass | 'unclassified'; count: number }[] {
  const counts = new Map<EvidenceClass | 'unclassified', number>();
  for (const loaded of sources) {
    if (!isFetchableWork(loaded.source)) {
      continue;
    }
    const evidenceClass: EvidenceClass | 'unclassified' = loaded.source.evidenceClass ?? 'unclassified';
    counts.set(evidenceClass, (counts.get(evidenceClass) ?? 0) + 1);
  }
  const order: (EvidenceClass | 'unclassified')[] = [...EVIDENCE_CLASS_VALUES, 'unclassified'];
  return order
    .filter((evidenceClass) => counts.has(evidenceClass))
    .map((evidenceClass) => ({ class: evidenceClass, count: counts.get(evidenceClass) ?? 0 }));
}

/**
 * Resolve EVERY persisted search-log `scope` fail-loud under its declared kind
 * (FR-009 / INV-SCOPE): a `ScopeRef` that does not resolve -- a kind/referent
 * mismatch (e.g. `{ kind: work, id: <a source-group> }`), a missing id, or a
 * `thread` id absent from the registry -- throws here, so the whole report
 * fails loud rather than silently dropping or mislabeling the search. This
 * runs BEFORE the pure search-history projection, which then only ever folds
 * already-resolved scopes.
 */
function resolveSearchScopes(input: CoverageInput): void {
  const ctx: ScopeResolutionContext = {
    sources: input.sources.map((loaded) => loaded.source),
    threadIds: input.threadIds ?? new Set<string>(),
  };
  for (const entry of input.searchLog) {
    resolveScopeRef(entry.scope, ctx);
  }
}

/**
 * Build the {@link CoverageReport} projection from already-loaded data. PURE
 * (no file I/O) and deterministic.
 *
 * NOT total over a malformed search log: every persisted search `scope` MUST
 * `resolveScopeRef` under its declared kind, or this throws (FR-009 /
 * INV-SCOPE, see {@link resolveSearchScopes}) -- an unresolved / kind-mismatched
 * ref never silently survives into the report. An empty corpus + empty search
 * log still yields an all-empty report (no scope to resolve, no throw).
 *
 * Orchestrates the per-section builders -- per-work-bundle counts + evidence
 * distribution here, the register in `@/bibliography/coverage/coverage-register`
 * and the search history in `@/bibliography/coverage/coverage-history` -- into
 * the fixed key order the `--json` renderer relies on for byte determinism.
 */
export function buildCoverageReport(input: CoverageInput): CoverageReport {
  resolveSearchScopes(input);

  const workBundles = input.sources.filter(isWorkBundle);

  const perWorkBundle: WorkBundleCoverage[] = workBundles.map((group) =>
    buildWorkBundleCoverage(group, input.sources),
  );
  const evidenceClassDistribution = buildEvidenceDistribution(input.sources);
  const register: CoverageRegister = buildRegister(input.sources, workBundles);
  const searchHistory: CoverageSearchHistory = buildSearchHistory(input.searchLog);

  return { perWorkBundle, evidenceClassDistribution, register, searchHistory };
}
