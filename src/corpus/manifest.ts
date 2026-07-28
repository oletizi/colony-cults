import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { describeError } from '@/bibliography/load-primitives';
import {
  assertKnownKeys,
  fail,
  isPlainObject,
  requireStringArray,
} from '@/corpus/manifest-primitives';
import {
  validateSourceIdPolicies,
  type CorpusSourceIdPolicy,
} from '@/corpus/manifest-source-ids';

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
 * source-id prefix grammar, pad width range, exactly-one-allocatable-policy,
 * within-manifest case-id uniqueness). It deliberately does NOT implement
 * repository-wide validation (cross-manifest unique corpus ids, prefix
 * disjointness, existing-data checks against `sourcesDir`) — that is
 * `@/corpus/validate` (T005).
 *
 * The `sourceIds` rules live in `@/corpus/manifest-source-ids` and the shape
 * primitives both modules share in `@/corpus/manifest-primitives`; FR-002b
 * (a non-empty LIST of policies with a cross-entry invariant) is enough rule
 * surface that keeping it inline would push this file past the size limit.
 *
 * Does NOT declare the epic-spec-2 fields `discoveryMechanism` /
 * `dateNormalizer` (FR-012) — their absence is asserted by a later guard
 * test.
 */

/** The only schema version this loader accepts. */
export const CORPUS_MANIFEST_SCHEMA_VERSION = 1;

export type { CorpusSourceIdPolicy } from '@/corpus/manifest-source-ids';

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
  /**
   * A NON-EMPTY list of source-ID policies, EXACTLY ONE of which is
   * `allocatable` (FR-002b). A corpus legitimately carries more than one
   * namespace — Port Breton ships `PB-P###` primary sources alongside
   * `PB-S###` hand-authored secondary works.
   */
  sourceIds: CorpusSourceIdPolicy[];
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

const REQUIRED_CAPABILITIES_KEYS = new Set(['repositories', 'sourceQueries']);
const ARCHIVE_OVERRIDE_KEYS = new Set(['relativePath', 'reason']);

/** `^[a-z][a-z0-9-]*$` (data-model.md § CorpusManifest, FR-002). */
const CASE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

const MANIFEST_SUFFIX = '.yml';
const BROWSER_PROFILE_SUFFIX = '.browser.yml';

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
  const sourceIds = validateSourceIdPolicies(parsed.sourceIds, filePath);
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
 * Enumerate the ids of every committed manifest under `corporaRoot`, sorted,
 * WITHOUT loading any of them. Browser-profile files (`<id>.browser.yml`)
 * are a distinct artifact sharing the same directory convention and are
 * excluded here — see `@/corpus/browser-profile`.
 *
 * This is the single owner of the `<corporaRoot>/<id>.yml` naming
 * convention. It exists separately from {@link listCorpusManifests} because
 * that function throws on the FIRST invalid manifest, which is the wrong
 * shape for the config validator: under the strict policy (FR-015) the
 * validator must report EVERY invalid committed manifest in one pass, so it
 * enumerates ids here and loads each one under its own error boundary.
 *
 * An empty (or not-yet-created-with-manifests) directory yields `[]`. A
 * missing `corporaRoot` itself is a hard failure — it is not conflated with
 * "zero manifests committed".
 */
export function listCorpusManifestIds(corporaRoot: string): string[] {
  if (!existsSync(corporaRoot)) {
    throw new Error(`listCorpusManifestIds(${corporaRoot}): directory does not exist`);
  }

  let entries: Dirent[];
  try {
    entries = readdirSync(corporaRoot, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `listCorpusManifestIds(${corporaRoot}): cannot read directory: ${describeError(error)}`,
    );
  }

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(MANIFEST_SUFFIX) && !name.endsWith(BROWSER_PROFILE_SUFFIX))
    .map((name) => name.slice(0, -MANIFEST_SUFFIX.length))
    .sort();
}

/**
 * Enumerate every committed manifest under `corporaRoot` and load/validate
 * each one (FR-015), failing loud on the first invalid one.
 *
 * An empty (or not-yet-created-with-manifests) directory yields `[]`. A
 * missing `corporaRoot` itself is a hard failure — it is not conflated with
 * "zero manifests committed".
 */
export function listCorpusManifests(corporaRoot: string): CorpusManifest[] {
  return listCorpusManifestIds(corporaRoot).map((id) => loadCorpusManifest(corporaRoot, id));
}
