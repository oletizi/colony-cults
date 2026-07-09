import path from 'node:path';

import type { CanonicalModel, IdentifierLeak } from '@/bibliography/model';
import { buildViewRegistry, readViewIfExists } from '@/bibliography/regenerate';
import {
  validateDuplicateCopies,
  validateMissingRequired,
  validateOrphanAssets,
  validateOrphanRecords,
  validateSingleChecksum,
  validateVocab,
} from '@/bibliography/validate-checks';

/**
 * The kinds of finding `bib validate` can report -- the full union per
 * specs/004-canonical-source-metadata/contracts/validation.md. `'identifier-
 * leak'`/`'view-drift'` were implemented by US2/US4; the referential-
 * integrity, vocab, required-core, uniqueness, and manifest-shape kinds are
 * implemented in `@/bibliography/validate-checks` (US5 / T027) and composed
 * into `validate()` below.
 */
export type ValidationFindingKind =
  | 'orphan-asset'
  | 'orphan-record'
  | 'identifier-leak'
  | 'vocab'
  | 'missing-required'
  | 'duplicate-copy'
  | 'single-checksum'
  | 'view-drift';

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

/** The on-disk roots {@link validateViewDrift} needs to read each view's committed file. */
export interface ViewDriftOptions {
  /** Public repo root (holds `bibliography/sources.csv` etc). */
  repoRoot: string;
  /**
   * Private archive root; OMIT when the archive is not present on disk.
   * Archive-side views (the register + stubs) are then skipped entirely --
   * not reported as drift -- mirroring `bib regenerate`'s own explicit
   * archive-absence branch (contracts/cli.md).
   */
  archiveRoot?: string;
}

/**
 * Regenerate every view IN-MEMORY (`@/bibliography/regenerate`'s
 * `buildViewRegistry`) and compare each to its committed file on disk,
 * emitting a `view-drift` finding per view whose committed content differs
 * from (or is entirely missing relative to) its regeneration (FR-015/
 * SC-008). A missing committed file is treated as drift, not an error --
 * `readViewIfExists` returns `undefined` rather than throwing for a
 * not-yet-written view.
 */
export function validateViewDrift(model: CanonicalModel, opts: ViewDriftOptions): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const view of buildViewRegistry(model)) {
    const root = view.kind === 'public' ? opts.repoRoot : opts.archiveRoot;
    if (root === undefined) {
      // Archive absent -- archive-side views are unreachable, so skipped
      // rather than reported as drift.
      continue;
    }
    const absPath = path.join(root, view.relativePath);
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
 * Run every implemented validation check over `model` and concatenate their
 * findings: identifier leaks (US2), referential integrity / vocab /
 * required-core / uniqueness / manifest-shape (US5, `@/bibliography/
 * validate-checks`), and -- when `opts` is supplied -- view drift (US4, the
 * one check that also touches disk; omitting `opts` leaves existing
 * model-only callers/tests unaffected). Never throws on content findings
 * (throwing is reserved for malformed input upstream, in
 * `@/bibliography/load`).
 */
export function validate(model: CanonicalModel, opts?: ViewDriftOptions): ValidationFinding[] {
  const findings = [
    ...validateIdentifierLeaks(model),
    ...validateOrphanRecords(model),
    ...validateOrphanAssets(model),
    ...validateVocab(model),
    ...validateMissingRequired(model),
    ...validateDuplicateCopies(model),
    ...validateSingleChecksum(model),
  ];
  if (opts !== undefined) {
    findings.push(...validateViewDrift(model, opts));
  }
  return findings;
}
