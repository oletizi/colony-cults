import type { CanonicalModel, IdentifierLeak } from '@/bibliography/model';

/**
 * The kinds of finding `bib validate` can report -- the full union per
 * specs/004-canonical-source-metadata/contracts/validation.md. Only
 * `'identifier-leak'` is implemented so far (US2); the remaining kinds are
 * added by US5 (T027) without needing to touch this union again.
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

/**
 * Run every implemented validation check over `model` and concatenate their
 * findings. Pure function -- never throws on content findings (throwing is
 * reserved for malformed input upstream, in `@/bibliography/load`). Kept as
 * a simple concatenation so US5 (T027) can add the remaining checks
 * (referential integrity, vocab, required fields, uniqueness, manifest
 * shape, view drift) without restructuring this function.
 */
export function validate(model: CanonicalModel): ValidationFinding[] {
  return [...validateIdentifierLeaks(model)];
}
