import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { basename, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { describeError } from '@/bibliography/load-primitives';

/**
 * Corpus config seam — the GLOBAL SOURCE IDENTITY INDEX the config validator
 * checks existing data against (contracts/corpus-seam.md § Config validator:
 * "startup validation (selected corpus + global identity index)").
 *
 * `sourcesDir` is an INJECTED PARAMETER (FR-016) — never a literal or a
 * default in this module. Production resolves it to
 * `<repoRoot>/bibliography/sources` at the CLI composition root; tests inject
 * a fixture directory.
 *
 * SCOPE: this reads ONLY the identity projection of each SSOT record —
 * `sourceId` and `case`. That is exactly what FR-002/FR-002a validation
 * needs (global ID uniqueness, per-corpus ID-policy conformance, next-ID
 * non-collision, and resolving which Corpus owns a Source). It is NOT a
 * Source loader and must not grow into one: full record validation stays in
 * `@/bibliography/load` (`loadSourceFile` / `loadAllSources`).
 *
 * WHY NOT REUSE `loadAllSources` HERE
 *
 * `loadAllSources` filters filenames through a hardcoded `^PB-[A-Z]?\d{3}\.yml$`
 * pattern — one of the very Port-Breton-shaped constants this spec exists to
 * retire. Reusing it would make the validator STRUCTURALLY INCAPABLE of
 * seeing a second corpus's Sources: a `SYN-001.yml` under a synthetic corpus
 * would be silently skipped, and its conformance/uniqueness checks would
 * "pass" by never running. A validator that cannot see the data it is
 * supposed to gate is worse than no validator, and that silent skip is
 * exactly the kind of fallback Principle V forbids. So enumeration here is
 * prefix-agnostic: EVERY `*.yml` under `sourcesDir` is an SSOT record and
 * must account for itself.
 *
 * A file that cannot yield an identity is reported as a
 * {@link SourceIdentityProblem}, not thrown — the caller turns each problem
 * into its own finding so one broken record does not mask the rest (SC-005).
 * A missing or unreadable `sourcesDir`, by contrast, DOES throw: that is a
 * caller/composition error, and collapsing it into "zero Sources" would let
 * every existing-data rule vacuously pass.
 */

/** The identity projection of one SSOT record. */
export interface SourceIdentity {
  /** The record's declared `sourceId`. Opaque; globally unique (FR-002). */
  readonly sourceId: string;
  /**
   * The record's declared `case`. `undefined` when the record declares none
   * — surfaced by the caller as a `source-missing-case` finding, never
   * defaulted to a corpus.
   */
  readonly caseId: string | undefined;
  /** The file the identity was read from, for locating error messages. */
  readonly filePath: string;
}

/** A file under `sourcesDir` that could not yield an identity. */
export interface SourceIdentityProblem {
  readonly filePath: string;
  readonly message: string;
}

/** Every readable identity, plus every file that failed to produce one. */
export interface SourceIdentityIndex {
  readonly entries: readonly SourceIdentity[];
  readonly problems: readonly SourceIdentityProblem[];
}

const SOURCE_SUFFIX = '.yml';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function listSourceFiles(sourcesDir: string): string[] {
  if (!existsSync(sourcesDir)) {
    throw new Error(`readSourceIdentityIndex(${sourcesDir}): directory does not exist`);
  }

  let entries: Dirent[];
  try {
    entries = readdirSync(sourcesDir, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `readSourceIdentityIndex(${sourcesDir}): cannot read directory: ${describeError(error)}`,
    );
  }

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(SOURCE_SUFFIX))
    .sort()
    .map((name) => join(sourcesDir, name));
}

/**
 * Read one file's identity. Returns the identity, or a problem describing
 * precisely why the file yielded none.
 */
function readIdentity(filePath: string): SourceIdentity | SourceIdentityProblem {
  const where = basename(filePath);

  let text: string;
  try {
    text = readFileSync(filePath, 'utf-8');
  } catch (error) {
    return { filePath, message: `${where}: cannot read file: ${describeError(error)}` };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (error) {
    return { filePath, message: `${where}: malformed YAML: ${describeError(error)}` };
  }

  if (!isPlainObject(parsed)) {
    return { filePath, message: `${where}: document must be an object` };
  }

  const sourceId = parsed.sourceId;
  if (typeof sourceId !== 'string' || sourceId.trim().length === 0) {
    return {
      filePath,
      message: `${where}: "sourceId" must be a non-empty string, got ${JSON.stringify(sourceId)}`,
    };
  }

  const rawCase = parsed.case;
  if (rawCase !== undefined && rawCase !== null) {
    if (typeof rawCase !== 'string' || rawCase.trim().length === 0) {
      return {
        filePath,
        message: `${where}: "case" must be a non-empty string when present, got ${JSON.stringify(rawCase)}`,
      };
    }
    return { sourceId, caseId: rawCase, filePath };
  }

  return { sourceId, caseId: undefined, filePath };
}

function isProblem(value: SourceIdentity | SourceIdentityProblem): value is SourceIdentityProblem {
  return 'message' in value;
}

/**
 * Build the global identity index from every `*.yml` SSOT record under the
 * injected `sourcesDir`, in deterministic (sorted filename) order.
 *
 * Throws when `sourcesDir` is missing or unreadable — "no SSOT reachable" is
 * never collapsed into "zero Sources". See the module doc comment.
 */
export function readSourceIdentityIndex(sourcesDir: string): SourceIdentityIndex {
  const entries: SourceIdentity[] = [];
  const problems: SourceIdentityProblem[] = [];

  for (const filePath of listSourceFiles(sourcesDir)) {
    const identity = readIdentity(filePath);
    if (isProblem(identity)) {
      problems.push(identity);
    } else {
      entries.push(identity);
    }
  }

  return { entries, problems };
}
