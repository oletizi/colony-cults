import { escapeRegExp } from '@/corpus/escape-regexp';

/**
 * THE FIFTH SEAM'S POLICY SHAPE (T023, specs/018-corpus-config-seam FR-018,
 * INV-16).
 *
 * `@/bibliography/load`'s `loadAllSources` used to filter every directory
 * entry through a hardcoded `SOURCE_FILE_PATTERN = /^PB-[A-Z]?\d{3}\.yml$/`.
 * That constant is corpus-specific and, worse, fails SILENTLY: a second
 * corpus's `SYN-001.yml` simply does not match, so enumeration returns zero
 * Sources with no error at all — which would make SC-003/FR-011 pass
 * vacuously against an empty list. The pattern is therefore retired in favor
 * of this injected policy, and `loadAllSources` takes it as a REQUIRED
 * parameter with NO default (a default is precisely the silent fallback
 * Principle V forbids).
 *
 * DELIBERATELY DEPENDENCY-FREE. This module imports nothing but the shared
 * regex escaper, so `@/bibliography/load` can depend on the policy shape
 * without pulling in `@/corpus/policies` (which reaches into
 * `@/archive/derive-layout` and `@/corpus/browser-profile`) and without
 * risking an import cycle through the archive layer. `deriveSourceFilenamePolicy`
 * — the composition-root derivation from a `SelectedCorpus` — lives in
 * `@/corpus/policies` alongside the other four narrow policies.
 */

/**
 * One `<prefix><padWidth digits>` source-ID shape. Structurally the manifest's
 * own `sourceIds` entry minus `allocatable`: allocatability governs WRITING a
 * new id (`@/sourcegroup/id-alloc`, which takes the SINGULAR allocatable
 * policy), whereas enumeration must recognize EVERY shape a corpus declares.
 * Port Breton declares two (`PB-P` pad 3 allocatable, `PB-S` pad 3 not), and
 * both `PB-P001.yml` and `PB-S001.yml` are Source files — which is exactly
 * what preserves the retired pattern's behavior (FR-010).
 */
export interface SourceFilenameShape {
  readonly prefix: string;
  readonly padWidth: number;
}

/** The narrow policy `@/bibliography/load`'s `loadAllSources` consumes (FR-004, FR-018). */
export interface SourceFilenamePolicy {
  /** True when `filename` (a bare basename, not a path) is one of this corpus's Source files. */
  isSourceFile(filename: string): boolean;
  /** The shapes this policy accepts, for diagnostics. Immutable. */
  readonly shapes: readonly SourceFilenameShape[];
  /** Human-readable rendering of the accepted shapes, e.g. `PB-P###.yml | PB-S###.yml`. */
  describe(): string;
}

/** The SSOT file extension every Source file carries. */
const SOURCE_FILE_EXTENSION = '.yml';

function fail(message: string): never {
  throw new Error(`buildSourceFilenamePolicy: ${message}`);
}

/**
 * Build a {@link SourceFilenamePolicy} from a corpus's declared source-ID
 * shapes. A file is a Source file when its basename matches ANY shape's
 * `prefix` + EXACTLY `padWidth` digits + `.yml`.
 *
 * EXACT digit width, not "at least": the retired pattern was anchored at
 * `\d{3}`, so `PB-P1000.yml` was NOT enumerated. Matching `{padWidth,}` here
 * would quietly widen enumeration and break FR-010's behavior preservation.
 * (A pad overflow is a real, separate hazard — an allocator that ran past
 * `999` would write a file this policy cannot see — but it is a validation
 * concern for `@/corpus/validate-existing-data`, not a reason to loosen the
 * shape here.)
 *
 * FAILS LOUD on an empty shape list: a policy that matches nothing is
 * indistinguishable, at the call site, from a directory with no Sources — the
 * very silence FR-018 exists to remove.
 */
export function buildSourceFilenamePolicy(
  shapes: readonly SourceFilenameShape[],
): SourceFilenamePolicy {
  if (shapes.length === 0) {
    fail(
      'no source-ID shapes supplied — a policy matching nothing would make every ' +
        'enumeration silently return zero Sources, which is the exact failure FR-018 ' +
        'exists to remove',
    );
  }

  const frozen: SourceFilenameShape[] = [];
  const patterns: RegExp[] = [];
  for (const shape of shapes) {
    if (shape.prefix.length === 0) {
      fail('a source-ID shape has an empty prefix');
    }
    if (!Number.isInteger(shape.padWidth) || shape.padWidth < 1) {
      fail(
        `source-ID shape ${JSON.stringify(shape.prefix)} has a non-positive/non-integer ` +
          `padWidth ${JSON.stringify(shape.padWidth)}`,
      );
    }
    frozen.push({ prefix: shape.prefix, padWidth: shape.padWidth });
    patterns.push(
      new RegExp(
        `^${escapeRegExp(shape.prefix)}\\d{${shape.padWidth}}${escapeRegExp(
          SOURCE_FILE_EXTENSION,
        )}$`,
      ),
    );
  }

  return {
    shapes: frozen,
    isSourceFile: (filename: string): boolean =>
      patterns.some((pattern) => pattern.test(filename)),
    describe: (): string =>
      frozen
        .map((shape) => `${shape.prefix}${'0'.repeat(shape.padWidth)}${SOURCE_FILE_EXTENSION}`)
        .join(' | '),
  };
}
