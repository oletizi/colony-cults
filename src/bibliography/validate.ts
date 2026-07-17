import { existsSync } from 'node:fs';
import path from 'node:path';

import type { CanonicalModel, IdentifierLeak } from '@/bibliography/model';
import { buildViewRegistry, readViewIfExists } from '@/bibliography/regenerate';
import {
  validateDuplicateCopies,
  validateDuplicatePublications,
  validateMissingRequired,
  validateOrphanAssets,
  validateOrphanRecords,
  validatePublicationRightsBasis,
  validateSingleChecksum,
  validateSourceGroups,
  validateSourceThreads,
  validateVocab,
} from '@/bibliography/validate-checks';
import type { CompanionRef } from '@/bibliography/validate-companion-coverage';
import {
  validateArchiveReconciliation,
  validateOcrTextQuality,
} from '@/bibliography/validate-companion-coverage';
import { validateCoverageFields } from '@/bibliography/validate-coverage-checks';
import { buildScopeResolutionContext, validateSearchLogScopes } from '@/bibliography/validate-search-log';
import { loadScopesRegistry, threadIdSet } from '@/bibliography/scopes-registry';
import type { SearchLogEntry } from '@/bibliography/search-log';

/**
 * The kinds of finding `bib validate` can report -- the full union per
 * specs/004-canonical-source-metadata/contracts/validation.md and
 * specs/007-corpus-coverage-audit/data-model.md § Validation rules.
 * `'identifier-leak'`/`'view-drift'` were implemented by US2/US4; the
 * referential-integrity, vocab, required-core, uniqueness, and
 * manifest-shape kinds are implemented in `@/bibliography/validate-checks`
 * (US5 / T027); `'dangling-resolved-to'` (V3), `'group-only-field'` (V4),
 * and `'invalid-known-member-count'` (V5) are implemented in
 * `@/bibliography/validate-coverage-checks` -- all composed into `validate()`
 * below. V1/V2 (`evidenceClass`/`citedKind` vocab) are enforced at LOAD, not
 * here -- see `validate-coverage-checks.ts`'s doc comment. `'search-log-
 * scope-unresolved'` (spec 010, replacing the retired campaign-based V8/V9
 * check) is implemented in `@/bibliography/validate-search-log`.
 * `'source-thread-unresolved'` (spec 010, INV-5) is implemented in
 * `@/bibliography/validate-checks`'s `validateSourceThreads`.
 */
export type ValidationFindingKind =
  | 'orphan-asset'
  | 'orphan-record'
  | 'identifier-leak'
  | 'vocab'
  | 'missing-required'
  | 'duplicate-copy'
  | 'single-checksum'
  | 'view-drift'
  | 'group-has-repository-records'
  | 'dangling-part-of'
  | 'part-of-not-a-group'
  | 'group-is-member'
  | 'dangling-resolved-to'
  | 'group-only-field'
  | 'invalid-known-member-count'
  | 'search-log-scope-unresolved'
  | 'source-thread-unresolved'
  | 'duplicate-publication'
  | 'publication-manifest-missing'
  | 'undiscoverable-master'
  | 'orphaned-companion'
  | 'checksum-drift'
  | 'ocr-quality-missing';

/**
 * One `bib validate` finding. Findings are DATA, not errors -- `validate`
 * never throws on them; throwing is reserved for malformed input upstream
 * (`@/bibliography/load`). Each finding must name the offending
 * entity/identifier (SC-002/SC-007), per contracts/validation.md and
 * contracts/cli.md.
 */
export interface ValidationFinding {
  kind: ValidationFindingKind;
  /** The Source this finding is about, when applicable. */
  sourceId?: string;
  /** Human message naming the offending entity. */
  detail: string;
  /** Locating path (file / asset), when applicable. */
  path?: string;
  /** The offending identifier's value, for `kind === 'identifier-leak'`. */
  identifier?: string;
}

/**
 * Render one {@link IdentifierLeak} as a human-readable detail message that
 * names the identifier, its (wrong) current level, the Source/Record it was
 * found on, and where it belongs -- e.g. `copy-level 'ark' present on Source
 * PB-P002 (belongs on a Repository Record)`.
 *
 * `expectedLevel` always matches the "X-level" prefix: a copy-level type
 * found on a Source (`onLevel === 'source'`) has `expectedLevel === 'copy'`;
 * a work-level type found on a Repository Record (`onLevel === 'record'`)
 * has `expectedLevel === 'work'`.
 */
function describeLeak(leak: IdentifierLeak): string {
  const label = `${leak.expectedLevel}-level '${leak.type}'`;
  if (leak.onLevel === 'source') {
    return `${label} present on Source ${leak.sourceId} (belongs on a Repository Record)`;
  }
  return (
    `${label} present on Repository Record (${leak.sourceArchive ?? '(unknown archive)'}) ` +
    `for Source ${leak.sourceId} (belongs on the Source)`
  );
}

/**
 * Map every {@link IdentifierLeak} the loader captured (a copy-level id
 * mis-placed on a Source, or a work-level id mis-placed on a Repository
 * Record -- see `@/bibliography/model`) to an `identifier-leak`
 * {@link ValidationFinding}, per FR-018/FR-009/SC-002.
 */
export function validateIdentifierLeaks(model: CanonicalModel): ValidationFinding[] {
  return model.identifierLeaks.map((leak) => ({
    kind: 'identifier-leak',
    sourceId: leak.sourceId,
    identifier: leak.value,
    detail: describeLeak(leak),
  }));
}

/** The on-disk root {@link validateViewDrift} needs to read each view's committed file. */
export interface ViewDriftOptions {
  /** Public repo root (holds `bibliography/sources.csv` etc) -- every view in the registry resolves against it. */
  repoRoot: string;
}

/**
 * Regenerate every view IN-MEMORY (`@/bibliography/regenerate`'s
 * `buildViewRegistry`) and compare each to its committed file on disk,
 * emitting a `view-drift` finding per view whose committed content differs
 * from (or is entirely missing relative to) its regeneration (FR-015/
 * SC-008). A missing committed file is treated as drift, not an error --
 * `readViewIfExists` returns `undefined` rather than throwing for a
 * not-yet-written view.
 *
 * The archive-side `acquisition-register.csv` + `PB-P00X.yml` stubs are NOT
 * in the registry (they are curated migrate INPUT, not generated views --
 * see `buildViewRegistry`'s doc comment), so this check never touches the
 * archive root.
 */
export function validateViewDrift(model: CanonicalModel, opts: ViewDriftOptions): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const view of buildViewRegistry(model)) {
    const absPath = path.join(opts.repoRoot, view.relativePath);
    const committed = readViewIfExists(absPath);
    if (committed !== view.content) {
      findings.push({
        kind: 'view-drift',
        detail: 'committed view differs from regeneration',
        path: view.relativePath,
      });
    }
  }
  return findings;
}

/**
 * Every `Source.publications[].manifest.manifestPath` MUST resolve to an
 * existing file, relative to `opts.repoRoot`
 * (specs/008-edition-publishing/contracts/ssot-publications.md §
 * Invariants: "Manifest file at manifestPath exists for every
 * publications[] entry") -- a publication must not reference a manifest that
 * was never written (or was deleted after the fact). Sibling to
 * `validateViewDrift`, the only other FS-touching check in this module: uses
 * `existsSync` directly (no read/parse of the manifest's contents -- that is
 * a separate concern from this check), and is gated the same way -- callers
 * without a `repoRoot` (model-only tests, other callers) never touch disk.
 * Sources with no `publications[]` are skipped. Reports one
 * `publication-manifest-missing` finding per missing manifest, naming the
 * owning Source and the manifest's repo-relative path.
 */
export function validatePublicationManifests(model: CanonicalModel, opts: ViewDriftOptions): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const source of model.sources) {
    for (const publication of source.publications ?? []) {
      const relativePath = publication.manifest.manifestPath;
      const absPath = path.join(opts.repoRoot, relativePath);
      if (existsSync(absPath)) {
        continue;
      }
      findings.push({
        kind: 'publication-manifest-missing',
        sourceId: source.sourceId,
        path: relativePath,
        detail:
          `Source "${source.sourceId}" publication (variant: ${publication.variant}, ` +
          `snapshotShort: ${publication.snapshotShort}) references manifest "${relativePath}", ` +
          `which does not exist`,
      });
    }
  }
  return findings;
}

/**
 * Options for {@link validate}. Both fields are optional and additive: omit
 * `repoRoot` to skip the disk-touching view-drift, thread-registry, and
 * search-log-scope checks (model-only callers / tests are unaffected);
 * supplying `repoRoot` alone runs `validateSourceThreads` against the
 * thread registry (`bibliography/scopes.yml`, spec 010 INV-5); supply BOTH
 * `searchLog` (the loaded `bibliography/search-log.yml` entries) AND
 * `repoRoot` to additionally run the search-log scope referential-integrity
 * check (spec 010) -- it needs `repoRoot` to load the SAME thread registry a
 * `{kind:'thread'}` scope resolves against, the same way the view-drift
 * check needs it to locate committed views.
 */
export interface ValidateOptions {
  /** Public repo root for the view-drift + search-log-scope checks; when absent, both are skipped. */
  repoRoot?: string;
  /** Loaded search-log entries for the scope-resolution check; when absent, that check is skipped. */
  searchLog?: readonly SearchLogEntry[];
  /**
   * Committed archive companion records indexed by `object_store.key` (from
   * `archive/**\/*.yml`), for the cross-repo archive-reconciliation checks
   * (`undiscoverable-master` / `orphaned-companion` / `checksum-drift`). Absent
   * ⇒ those checks are skipped (no archive access to reconcile against). An
   * EMPTY map is NOT the same as absent -- it means "archive scanned, zero
   * companions found", a real violation for any record with object-store masters.
   */
  archiveCompanions?: ReadonlyMap<string, CompanionRef>;
  /**
   * Private-archive root for the OCR-quality gate: every `type: ocr-text`
   * artifact under `<archiveRoot>/archive/**` MUST carry an `ocr_quality` block
   * (`ocr-quality-missing` otherwise). Absent ⇒ the gate is skipped (no archive
   * access).
   */
  archiveRoot?: string;
}

/**
 * Run every implemented validation check over `model` and concatenate their
 * findings: identifier leaks (US2), referential integrity / vocab /
 * required-core / uniqueness / manifest-shape (US5, `@/bibliography/
 * validate-checks`), the corpus-coverage-audit V3-V5 checks (`@/bibliography/
 * validate-coverage-checks`), and -- when the matching `opts` fields are
 * supplied -- the thread-membership check (spec 010 INV-5, needs
 * `opts.repoRoot` to load `bibliography/scopes.yml`), the search-log
 * scope-resolution check (spec 010, needs BOTH `opts.searchLog` and
 * `opts.repoRoot`), and view drift (US4, needs `opts.repoRoot`, the one
 * check that also touches disk). Omitting `opts` leaves existing model-only
 * callers/tests unaffected. Never throws on content findings (throwing is
 * reserved for malformed input upstream, in `@/bibliography/load`).
 */
export function validate(model: CanonicalModel, opts?: ValidateOptions): ValidationFinding[] {
  const findings = [
    ...validateIdentifierLeaks(model),
    ...validateOrphanRecords(model),
    ...validateOrphanAssets(model),
    ...validateVocab(model),
    ...validateMissingRequired(model),
    ...validateDuplicateCopies(model),
    ...validateSingleChecksum(model),
    ...validateSourceGroups(model),
    ...validateCoverageFields(model),
    ...validateDuplicatePublications(model),
    ...validatePublicationRightsBasis(model),
  ];
  if (opts?.repoRoot !== undefined) {
    const threadIds = threadIdSet(loadScopesRegistry(path.join(opts.repoRoot, 'bibliography', 'scopes.yml')));
    findings.push(...validateSourceThreads(model, threadIds));
  }
  if (opts?.searchLog !== undefined && opts?.repoRoot !== undefined) {
    const scopeContext = buildScopeResolutionContext(opts.repoRoot, model.sources);
    findings.push(...validateSearchLogScopes(opts.searchLog, scopeContext));
  }
  if (opts?.repoRoot !== undefined) {
    findings.push(...validateViewDrift(model, { repoRoot: opts.repoRoot }));
    findings.push(...validatePublicationManifests(model, { repoRoot: opts.repoRoot }));
  }
  if (opts?.archiveCompanions !== undefined) {
    findings.push(...validateArchiveReconciliation(model, opts.archiveCompanions));
  }
  if (opts?.archiveRoot !== undefined) {
    findings.push(...validateOcrTextQuality(opts.archiveRoot));
  }
  return findings;
}
