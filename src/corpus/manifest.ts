import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { describeError } from '@/bibliography/load-primitives';

/**
 * Corpus config seam — the `CorpusManifest` type + a typed validating
 * loader. See specs/018-corpus-config-seam/data-model.md (CorpusManifest)
 * and contracts/corpus-seam.md.
 *
 * `corporaRoot` is an INJECTED PARAMETER on every exported function here
 * (FR-016) — it is never a literal or a default inside this module.
 * Production resolves it to `<repoRoot>/corpora` at the CLI composition
 * root (a later task); tests inject an arbitrary fixture directory. Do not
 * add a convenience default: a hardcoded/defaulted root would make SC-003
 * (a second corpus addable as fixtures only, zero core `src/` edits)
 * unsatisfiable.
 *
 * SCOPE: this module validates the STRUCTURE/TYPES of a single manifest
 * during load (schema version, id/basename match, case-id grammar,
 * source-id prefix grammar, pad width range, within-manifest case-id
 * uniqueness). It deliberately does NOT implement repository-wide
 * validation (cross-manifest unique corpus ids, prefix disjointness,
 * existing-data checks against `sourcesDir`) — that is `@/corpus/validate`
 * (T005).
 *
 * Does NOT declare the epic-spec-2 fields `discoveryMechanism` /
 * `dateNormalizer` (FR-012) — their absence is asserted by a later guard
 * test.
 */

/** The only schema version this loader accepts. */
export const CORPUS_MANIFEST_SCHEMA_VERSION = 1;

/** `sourceIds` policy: how member Source IDs are allocated for this corpus. */
export interface CorpusSourceIdPolicy {
  /**
   * The literal prefix every allocated Source ID under this corpus starts
   * with. Grammar: `^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-$` (ends in a delimiter).
   */
  prefix: string;
  /** Zero-pad width for the numeric suffix. `1 <= padWidth <= 8`. */
  padWidth: number;
}

/** Names of installed capabilities this corpus depends on (Model A). */
export interface CorpusRequiredCapabilities {
  repositories: string[];
  sourceQueries: string[];
}

/** A single per-Source archive-layout override. */
export interface CorpusArchiveLayoutOverride {
  relativePath: string;
  reason: string;
}

/**
 * A corpus manifest — `<corporaRoot>/<id>.yml`. `basename == id`. Data,
 * versioned via the `schemaVersion` discriminant.
 */
export interface CorpusManifest {
  /** Discriminant. The loader rejects any value other than `1`. */
  schemaVersion: 1;
  /** Must equal the file's basename (without the `.yml` extension). */
  id: string;
  /** At least one case id, grammar `^[a-z][a-z0-9-]*$`. */
  cases: string[];
  sourceIds: CorpusSourceIdPolicy;
  requiredCapabilities: CorpusRequiredCapabilities;
  /** `null` when the generic archive layout needs no per-Source override. */
  archiveLayoutOverrides: Record<string, CorpusArchiveLayoutOverride> | null;
}

const MANIFEST_KEYS = new Set([
  'schemaVersion',
  'id',
  'cases',
  'sourceIds',
  'requiredCapabilities',
  'archiveLayoutOverrides',
]);

const SOURCE_IDS_KEYS = new Set(['prefix', 'padWidth']);
const REQUIRED_CAPABILITIES_KEYS = new Set(['repositories', 'sourceQueries']);
const ARCHIVE_OVERRIDE_KEYS = new Set(['relativePath', 'reason']);

/** `^[a-z][a-z0-9-]*$` (data-model.md § CorpusManifest, FR-002). */
const CASE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * `^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-$`, ending in a delimiter
 * (contracts/corpus-seam.md, FR-002a).
 */
const SOURCE_PREFIX_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-$/;

const MANIFEST_SUFFIX = '.yml';
const BROWSER_PROFILE_SUFFIX = '.browser.yml';

/** Throw a locating, descriptive error naming the file and what is wrong. */
function fail(filePath: string, message: string): never {
  throw new Error(`loadCorpusManifest(${filePath}): ${message}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readFileText(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch (error) {
    fail(filePath, `cannot read file: ${describeError(error)}`);
  }
}

function parseYamlOrFail(text: string, filePath: string): unknown {
  try {
    return parseYaml(text);
  } catch (error) {
    fail(filePath, `malformed YAML: ${describeError(error)}`);
  }
}

function assertKnownKeys(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  filePath: string,
  where: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      fail(filePath, `${where} has unknown key "${key}" (no silent drop)`);
    }
  }
}

function requireStringArray(value: unknown, filePath: string, where: string): string[] {
  if (!Array.isArray(value)) {
    fail(filePath, `${where} must be an array`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      fail(filePath, `${where}[${index}] must be a non-empty string`);
    }
    return entry;
  });
}

function validateSourceIds(value: unknown, filePath: string): CorpusSourceIdPolicy {
  if (!isPlainObject(value)) {
    fail(filePath, '"sourceIds" must be an object with "prefix" and "padWidth"');
  }
  assertKnownKeys(value, SOURCE_IDS_KEYS, filePath, '"sourceIds"');

  const prefix = value.prefix;
  if (typeof prefix !== 'string' || !SOURCE_PREFIX_PATTERN.test(prefix)) {
    fail(
      filePath,
      `"sourceIds.prefix" ${JSON.stringify(prefix)} must match ${SOURCE_PREFIX_PATTERN} (an uppercase-alphanumeric prefix ending in a delimiter)`,
    );
  }

  const padWidth = value.padWidth;
  if (typeof padWidth !== 'number' || !Number.isInteger(padWidth) || padWidth < 1 || padWidth > 8) {
    fail(
      filePath,
      `"sourceIds.padWidth" ${JSON.stringify(padWidth)} must be an integer between 1 and 8 inclusive`,
    );
  }

  return { prefix, padWidth };
}

function validateRequiredCapabilities(
  value: unknown,
  filePath: string,
): CorpusRequiredCapabilities {
  if (!isPlainObject(value)) {
    fail(
      filePath,
      '"requiredCapabilities" must be an object with "repositories" and "sourceQueries"',
    );
  }
  assertKnownKeys(value, REQUIRED_CAPABILITIES_KEYS, filePath, '"requiredCapabilities"');

  const repositories = requireStringArray(
    value.repositories,
    filePath,
    '"requiredCapabilities.repositories"',
  );
  const sourceQueries = requireStringArray(
    value.sourceQueries,
    filePath,
    '"requiredCapabilities.sourceQueries"',
  );

  return { repositories, sourceQueries };
}

function validateArchiveLayoutOverrides(
  value: unknown,
  filePath: string,
): Record<string, CorpusArchiveLayoutOverride> | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isPlainObject(value)) {
    fail(
      filePath,
      '"archiveLayoutOverrides" must be `null` or an object keyed by Source ID',
    );
  }

  const result: Record<string, CorpusArchiveLayoutOverride> = {};
  for (const [sourceId, entry] of Object.entries(value)) {
    if (!isPlainObject(entry)) {
      fail(
        filePath,
        `"archiveLayoutOverrides[${JSON.stringify(sourceId)}]" must be an object with "relativePath" and "reason"`,
      );
    }
    assertKnownKeys(
      entry,
      ARCHIVE_OVERRIDE_KEYS,
      filePath,
      `"archiveLayoutOverrides[${JSON.stringify(sourceId)}]"`,
    );

    const relativePath = entry.relativePath;
    if (typeof relativePath !== 'string' || relativePath.trim().length === 0) {
      fail(
        filePath,
        `"archiveLayoutOverrides[${JSON.stringify(sourceId)}].relativePath" must be a non-empty string`,
      );
    }

    const reason = entry.reason;
    if (typeof reason !== 'string' || reason.trim().length === 0) {
      fail(
        filePath,
        `"archiveLayoutOverrides[${JSON.stringify(sourceId)}].reason" must be a non-empty string`,
      );
    }

    result[sourceId] = { relativePath, reason };
  }

  return result;
}

function validateCases(value: unknown, filePath: string): string[] {
  const cases = requireStringArray(value, filePath, '"cases"');
  if (cases.length === 0) {
    fail(filePath, '"cases" must contain at least one case id');
  }

  const seen = new Set<string>();
  cases.forEach((caseId, index) => {
    if (!CASE_ID_PATTERN.test(caseId)) {
      fail(
        filePath,
        `"cases[${index}]" ${JSON.stringify(caseId)} must match ${CASE_ID_PATTERN} (lowercase kebab-case)`,
      );
    }
    if (seen.has(caseId)) {
      fail(filePath, `"cases" contains duplicate case id ${JSON.stringify(caseId)}`);
    }
    seen.add(caseId);
  });

  return cases;
}

/**
 * Parse and structurally validate one already-read manifest document.
 *
 * `expectedId` is the id this manifest MUST declare — the basename of the
 * file it was read from (`<corporaRoot>/<expectedId>.yml`).
 */
function validateManifest(
  parsed: unknown,
  filePath: string,
  expectedId: string,
): CorpusManifest {
  if (!isPlainObject(parsed)) {
    fail(filePath, 'document must be an object');
  }
  assertKnownKeys(parsed, MANIFEST_KEYS, filePath, 'manifest');

  const schemaVersion = parsed.schemaVersion;
  if (schemaVersion !== CORPUS_MANIFEST_SCHEMA_VERSION) {
    fail(
      filePath,
      `unsupported schemaVersion ${JSON.stringify(schemaVersion)} (only ${CORPUS_MANIFEST_SCHEMA_VERSION} is supported)`,
    );
  }

  const id = parsed.id;
  if (typeof id !== 'string' || id.trim().length === 0) {
    fail(filePath, '"id" must be a non-empty string');
  }
  if (id !== expectedId) {
    fail(
      filePath,
      `"id" ${JSON.stringify(id)} does not match the file's basename ${JSON.stringify(expectedId)}`,
    );
  }

  const cases = validateCases(parsed.cases, filePath);
  const sourceIds = validateSourceIds(parsed.sourceIds, filePath);
  const requiredCapabilities = validateRequiredCapabilities(parsed.requiredCapabilities, filePath);
  const archiveLayoutOverrides = validateArchiveLayoutOverrides(
    parsed.archiveLayoutOverrides,
    filePath,
  );

  return {
    schemaVersion: CORPUS_MANIFEST_SCHEMA_VERSION,
    id,
    cases,
    sourceIds,
    requiredCapabilities,
    archiveLayoutOverrides,
  };
}

/**
 * Read and validate `<corporaRoot>/<id>.yml`. Throws a descriptive,
 * locating error on: an unreadable file, malformed YAML, an unsupported
 * `schemaVersion`, an `id` that doesn't match the file's basename (`id`),
 * or any structural violation of the fields documented on
 * {@link CorpusManifest}.
 *
 * `corporaRoot` is caller-injected (FR-016) — see the module doc comment.
 */
export function loadCorpusManifest(corporaRoot: string, id: string): CorpusManifest {
  const filePath = join(corporaRoot, `${id}${MANIFEST_SUFFIX}`);
  const text = readFileText(filePath);
  const parsed = parseYamlOrFail(text, filePath);
  return validateManifest(parsed, filePath, id);
}

/**
 * Enumerate every committed manifest under `corporaRoot` and load/validate
 * each one (FR-015). Browser-profile files (`<id>.browser.yml`) are a
 * distinct artifact sharing the same directory convention and are excluded
 * here — see `@/corpus/browser-profile`.
 *
 * An empty (or not-yet-created-with-manifests) directory yields `[]`. A
 * missing `corporaRoot` itself is a hard failure — it is not conflated with
 * "zero manifests committed".
 */
export function listCorpusManifests(corporaRoot: string): CorpusManifest[] {
  if (!existsSync(corporaRoot)) {
    throw new Error(`listCorpusManifests(${corporaRoot}): directory does not exist`);
  }

  let entries: Dirent[];
  try {
    entries = readdirSync(corporaRoot, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `listCorpusManifests(${corporaRoot}): cannot read directory: ${describeError(error)}`,
    );
  }

  const ids = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(MANIFEST_SUFFIX) && !name.endsWith(BROWSER_PROFILE_SUFFIX))
    .map((name) => name.slice(0, -MANIFEST_SUFFIX.length))
    .sort();

  return ids.map((id) => loadCorpusManifest(corporaRoot, id));
}
