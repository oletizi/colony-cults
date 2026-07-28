import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { describeError } from '@/bibliography/load-primitives';

/**
 * Corpus config seam — the `BrowserProfile` type + a typed validating
 * loader. See specs/018-corpus-config-seam/spec.md (FR-005, FR-016),
 * data-model.md (BrowserProfile), and contracts/corpus-seam.md.
 *
 * `corporaRoot` is an INJECTED PARAMETER on every exported function here
 * (FR-016) — it is never a literal or a default inside this module.
 * Production resolves it to `<repoRoot>/corpora` at the CLI composition
 * root (a later task); tests inject an arbitrary fixture directory. Do not
 * add a convenience default: a hardcoded/defaulted root would make SC-003
 * (a second corpus addable as fixtures only, zero core `src/` edits)
 * unsatisfiable.
 *
 * The profile lives BESIDE its manifest under the SAME injected root:
 * `<corporaRoot>/<id>.browser.yml` — one convention, so a second corpus
 * needs no second code path (FR-016, @/corpus/manifest).
 *
 * SCOPE: this module validates the STRUCTURE/TYPES of a single profile
 * during load (schema version, required-field presence/shape). It
 * deliberately does NOT implement repository-wide validation (profile-id
 * uniqueness across profiles, or verifying `corpus` names a KNOWN corpus)
 * — that is `@/corpus/validate` (T005).
 *
 * ABSENCE vs MALFORMED (FR-005): a BrowserProfile is deployment config,
 * required only by browser-deploy / browser-default-consuming commands.
 * `loadBrowserProfile` is loud on every failure, including a missing file
 * — use it where a profile is mandatory. `tryLoadBrowserProfile` is the
 * absence-tolerant counterpart: it returns `null` when the file does not
 * exist, but still throws loud on a malformed/invalid profile that DOES
 * exist. Callers for whom absence is fine (i.e. most commands, per FR-005)
 * must use `tryLoadBrowserProfile`, never swallow an error from
 * `loadBrowserProfile`.
 */

/** The only schema version this loader accepts. */
export const BROWSER_PROFILE_SCHEMA_VERSION = 1;

/**
 * A browser deployment profile — `<corporaRoot>/<id>.browser.yml`. One
 * conventional profile per corpus, versioned via the `schemaVersion`
 * discriminant.
 */
export interface BrowserProfile {
  /** Discriminant. The loader rejects any value other than `1`. */
  schemaVersion: 1;
  /** Unique across profiles (repository-wide check owned by T005). */
  id: string;
  /** Must reference a corpus id (repository-wide check owned by T005). */
  corpus: string;
  /** Browser default Source IDs. Overridable via `CORPUS_SOURCES` (T014, src/browser/config.ts). */
  defaultSources: string[];
}

const BROWSER_PROFILE_KEYS = new Set(['schemaVersion', 'id', 'corpus', 'defaultSources']);

const BROWSER_PROFILE_SUFFIX = '.browser.yml';

/** Throw a locating, descriptive error naming the file and what is wrong. */
function fail(filePath: string, message: string): never {
  throw new Error(`loadBrowserProfile(${filePath}): ${message}`);
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

function requireNonEmptyString(value: unknown, filePath: string, where: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(filePath, `${where} must be a non-empty string`);
  }
  return value;
}

function validateDefaultSources(value: unknown, filePath: string): string[] {
  if (!Array.isArray(value)) {
    fail(filePath, '"defaultSources" must be an array');
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      fail(filePath, `"defaultSources[${index}]" must be a non-empty string`);
    }
    return entry;
  });
}

/**
 * Parse and structurally validate one already-read profile document.
 *
 * Unlike `@/corpus/manifest`'s `id`/basename check, a BrowserProfile's `id`
 * field is NOT required to equal `expectedId` (the data model documents no
 * such constraint for profiles — only that `id` be unique across
 * profiles, which is a repository-wide check owned by T005).
 */
function validateBrowserProfile(parsed: unknown, filePath: string): BrowserProfile {
  if (!isPlainObject(parsed)) {
    fail(filePath, 'document must be an object');
  }
  assertKnownKeys(parsed, BROWSER_PROFILE_KEYS, filePath, 'browser profile');

  const schemaVersion = parsed.schemaVersion;
  if (schemaVersion !== BROWSER_PROFILE_SCHEMA_VERSION) {
    fail(
      filePath,
      `unsupported schemaVersion ${JSON.stringify(schemaVersion)} (only ${BROWSER_PROFILE_SCHEMA_VERSION} is supported)`,
    );
  }

  const id = requireNonEmptyString(parsed.id, filePath, '"id"');
  const corpus = requireNonEmptyString(parsed.corpus, filePath, '"corpus"');
  const defaultSources = validateDefaultSources(parsed.defaultSources, filePath);

  return {
    schemaVersion: BROWSER_PROFILE_SCHEMA_VERSION,
    id,
    corpus,
    defaultSources,
  };
}

function profilePath(corporaRoot: string, id: string): string {
  return join(corporaRoot, `${id}${BROWSER_PROFILE_SUFFIX}`);
}

/**
 * Read and validate `<corporaRoot>/<id>.browser.yml`. Throws a descriptive,
 * locating error on: a missing/unreadable file, malformed YAML, an
 * unsupported `schemaVersion`, or any structural violation of the fields
 * documented on {@link BrowserProfile}.
 *
 * Use this ONLY where a profile is mandatory (browser-deploy /
 * browser-default-consuming commands, FR-005). For any other caller, use
 * {@link tryLoadBrowserProfile} — a missing profile MUST NOT fail
 * non-browser commands.
 *
 * `corporaRoot` is caller-injected (FR-016) — see the module doc comment.
 */
export function loadBrowserProfile(corporaRoot: string, id: string): BrowserProfile {
  const filePath = profilePath(corporaRoot, id);
  const text = readFileText(filePath);
  const parsed = parseYamlOrFail(text, filePath);
  return validateBrowserProfile(parsed, filePath);
}

/**
 * Absence-tolerant counterpart to {@link loadBrowserProfile} (FR-005): a
 * missing BrowserProfile MUST NOT be an error for non-browser commands.
 *
 * Returns `null` when `<corporaRoot>/<id>.browser.yml` does not exist.
 * A profile that DOES exist but is malformed/invalid still fails loud —
 * only ABSENCE is tolerated.
 *
 * `corporaRoot` is caller-injected (FR-016) — see the module doc comment.
 */
export function tryLoadBrowserProfile(corporaRoot: string, id: string): BrowserProfile | null {
  const filePath = profilePath(corporaRoot, id);
  if (!existsSync(filePath)) {
    return null;
  }
  return loadBrowserProfile(corporaRoot, id);
}

/**
 * Enumerate the FILE ids of every committed browser profile under
 * `corporaRoot`, sorted — i.e. the `<id>` in `<corporaRoot>/<id>.browser.yml`,
 * suitable for passing straight to {@link loadBrowserProfile}.
 *
 * These are FILE ids, NOT the profiles' declared `id` fields: a profile's
 * `id` is deliberately not tied to its filename (see
 * {@link validateBrowserProfile}'s note), which is why cross-profile `id`
 * uniqueness is a repository-wide check owned by `@/corpus/validate` rather
 * than something the filesystem guarantees.
 *
 * This is the single owner of the `<corporaRoot>/<id>.browser.yml` naming
 * convention. Nothing is loaded here, so the config validator can put each
 * profile under its own error boundary and report every invalid one in a
 * single pass (FR-015).
 *
 * An empty directory yields `[]`; a missing `corporaRoot` is a hard failure,
 * never conflated with "zero profiles committed".
 */
export function listBrowserProfileIds(corporaRoot: string): string[] {
  if (!existsSync(corporaRoot)) {
    throw new Error(`listBrowserProfileIds(${corporaRoot}): directory does not exist`);
  }

  let entries: Dirent[];
  try {
    entries = readdirSync(corporaRoot, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `listBrowserProfileIds(${corporaRoot}): cannot read directory: ${describeError(error)}`,
    );
  }

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(BROWSER_PROFILE_SUFFIX))
    .map((name) => name.slice(0, -BROWSER_PROFILE_SUFFIX.length))
    .sort();
}
