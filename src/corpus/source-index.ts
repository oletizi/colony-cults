import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { basename, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { deriveSourceLayout, type LayoutDerivationSource } from '@/archive/derive-layout';
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
 * SCOPE: this reads the identity projection of each SSOT record — `sourceId`
 * and `case` — plus (AUDIT-05) exactly the fields the GENERIC archive-layout
 * derivation reads: `kind`, `partOf` and `titles`. The first group is what
 * FR-002/FR-002a validation needs (global ID uniqueness, per-corpus ID-policy
 * conformance, next-ID non-collision, and resolving which Corpus owns a
 * Source); the second exists so every record can answer "where would the
 * generic rule put me?" — see {@link SourceIdentity.genericLocation}.
 *
 * It is still NOT a Source loader and must not grow into one: full record
 * validation — vocabulary, required-core fields, referential integrity —
 * stays in `@/bibliography/load` (`loadSourceFile` / `loadAllSources`).
 * Nothing is read here that the two rule families above do not consume, and
 * nothing read here is re-validated against a vocabulary.
 *
 * WHY NOT REUSE `loadAllSources` HERE
 *
 * `loadAllSources` enumerates only the files matching a CORPUS'S OWN declared
 * id shapes — a hardcoded `^PB-[A-Z]?\d{3}\.yml$` before T023, an injected
 * `SourceFilenamePolicy` since (FR-018). Either way it is the wrong tool
 * HERE: this validator's whole job is to catch a Source that conforms to NO
 * corpus's policy, and enumerating through a policy would make it
 * STRUCTURALLY INCAPABLE of seeing exactly those files — a stray
 * `SYN-001.yml` under a repository whose manifests do not declare `SYN-`
 * would be silently skipped, and the conformance/uniqueness checks would
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
  /**
   * Where the GENERIC layout rule (`@/archive/derive-layout`'s
   * `deriveSourceLayout`) would place this record, as an archive-root-relative
   * path — `archive/cases/<case>/<type>/<slug>` — or `undefined` when the
   * record HAS no generic location (AUDIT-05).
   *
   * `undefined` means one of exactly two things, both of them already
   * reported or by design, never a quiet failure to compute:
   *   - the record declares no `case`, so no location can be derived at all
   *     (surfaced as `source-missing-case` by
   *     `@/corpus/validate-existing-data`);
   *   - the record is a `source-group`, a CONTAINER that has no archive
   *     location of its own — mirroring `@/corpus/policies`'
   *     `deriveArchiveLayoutPolicy`, which excludes groups from `derived` for
   *     the same reason.
   *
   * It is REQUIRED (not optional) on this interface so that every construction
   * site has to decide it explicitly rather than omit it into a silent skip.
   */
  readonly genericLocation: string | undefined;
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

/** The archive-root-relative prefix every derived location carries. */
const ARCHIVE_CASES_PREFIX = 'archive/cases';

/** A `source-group` is a container; it has no archive location of its own. */
const CONTAINER_KIND = 'source-group';

/**
 * Read the `titles` projection: every entry's `text` and `role`, as strings.
 *
 * Returns a message (not a list) when the field is present but not a list of
 * `{ text, role }` objects. Absence is legitimate — `deriveSlug` documents a
 * titleless Source as slugifying its `sourceId` — so an ABSENT `titles` reads
 * as the empty list, while a MALFORMED one is loud: silently treating it as
 * empty would change the derived slug, and therefore the derived archive
 * location, without saying so.
 */
function readTitles(
  value: unknown,
  where: string,
): readonly { readonly text: string; readonly role: string }[] | string {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    return `${where}: "titles" must be a list when present, got ${JSON.stringify(value)}`;
  }

  const titles: { text: string; role: string }[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isPlainObject(entry)) {
      return `${where}: "titles[${index}]" must be an object with "text" and "role"`;
    }
    const { text, role } = entry;
    if (typeof text !== 'string' || typeof role !== 'string') {
      return (
        `${where}: "titles[${index}]" must carry string "text" and "role", got ` +
        `${JSON.stringify({ text, role })}`
      );
    }
    titles.push({ text, role });
  }
  return titles;
}

/**
 * Where the generic rule would place `source`, archive-root-relative, or
 * `undefined` for a caseless record or a `source-group` container — see
 * {@link SourceIdentity.genericLocation}.
 */
function genericLocationOf(source: LayoutDerivationSource): string | undefined {
  if (source.case === undefined || source.kind === CONTAINER_KIND) {
    return undefined;
  }
  const layout = deriveSourceLayout(source);
  return `${ARCHIVE_CASES_PREFIX}/${layout.case}/${layout.type}/${layout.slug}`;
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
  }
  const caseId = typeof rawCase === 'string' ? rawCase : undefined;

  // `kind` is REQUIRED, not defaulted (AUDIT-05). It selects the material-type
  // directory (`newspapers` vs `books`) the generic location is built from, so
  // treating an absent `kind` as "not a periodical" would quietly invent an
  // archive location for the record — exactly the guess Principle V forbids.
  const kind = parsed.kind;
  if (typeof kind !== 'string' || kind.trim().length === 0) {
    return {
      filePath,
      message:
        `${where}: "kind" must be a non-empty string, got ${JSON.stringify(kind)} — it selects ` +
        'the archive material-type directory, so it cannot be defaulted',
    };
  }

  const rawPartOf = parsed.partOf;
  if (rawPartOf !== undefined && rawPartOf !== null && typeof rawPartOf !== 'string') {
    return {
      filePath,
      message: `${where}: "partOf" must be a string when present, got ${JSON.stringify(rawPartOf)}`,
    };
  }
  const partOf = typeof rawPartOf === 'string' ? rawPartOf : undefined;

  const titles = readTitles(parsed.titles, where);
  if (typeof titles === 'string') {
    return { filePath, message: titles };
  }

  return {
    sourceId,
    caseId,
    filePath,
    genericLocation: genericLocationOf({ sourceId, case: caseId, kind, partOf, titles }),
  };
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
