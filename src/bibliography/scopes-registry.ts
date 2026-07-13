import { existsSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

import { describeError } from '@/bibliography/load-primitives';

/**
 * A thread registry entry -- `bibliography/scopes.yml`. Owns thread
 * **identity + description only**, never a member list (D7): membership is
 * authored one-directionally on `Source.threads[]` and derived in reverse.
 *
 * See specs/010-corpus-model-coherence/data-model.md § Thread registry and
 * contracts/scope-model.md (INV-5). This build defines the registry but
 * populates no thread (FR-011) -- an empty list is valid.
 */
export interface ThreadRegistryEntry {
  /** Stable kebab-case slug. UNIQUE across the file. */
  id: string;
  /** Human label. */
  name: string;
  /** One-line scope statement. */
  description: string;
}

const ENTRY_KEYS = new Set(['id', 'name', 'description']);

const REQUIRED_STRING_FIELDS = ['id', 'name', 'description'] as const;

/** Throw a locating, descriptive error naming the file and the offending entry/field. */
function fail(filePath: string, message: string): never {
  throw new Error(`loadScopesRegistry(${filePath}): ${message}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readFileText(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch (error) {
    throw new Error(`loadScopesRegistry(${filePath}): cannot read file: ${describeError(error)}`);
  }
}

function parseYamlOrFail(text: string, filePath: string): unknown {
  try {
    return parseYaml(text);
  } catch (error) {
    throw new Error(`loadScopesRegistry(${filePath}): malformed YAML: ${describeError(error)}`);
  }
}

/**
 * A human-readable handle for one entry in error messages: the entry's own
 * `id` when it is present and well-formed, falling back to its list index
 * when `id` itself is the missing/malformed field.
 */
function entryLabel(obj: Record<string, unknown>, index: number): string {
  const id = obj.id;
  return typeof id === 'string' && id.trim().length > 0 ? `entry "${id}"` : `entries[${index}]`;
}

function requireEntryString(
  obj: Record<string, unknown>,
  field: (typeof REQUIRED_STRING_FIELDS)[number],
  filePath: string,
  label: string,
): string {
  const value = obj[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(filePath, `${label} is missing required field "${field}"`);
  }
  return value;
}

function validateEntry(value: unknown, filePath: string, index: number): ThreadRegistryEntry {
  if (!isPlainObject(value)) {
    fail(filePath, `entries[${index}] must be an object`);
  }
  const label = entryLabel(value, index);

  for (const key of Object.keys(value)) {
    if (!ENTRY_KEYS.has(key)) {
      fail(filePath, `${label} has unknown key "${key}" (no silent drop)`);
    }
  }

  const id = requireEntryString(value, 'id', filePath, label);
  const name = requireEntryString(value, 'name', filePath, label);
  const description = requireEntryString(value, 'description', filePath, label);

  return { id, name, description };
}

/**
 * Read and structurally validate `bibliography/scopes.yml` (the thread
 * registry) into a typed {@link ThreadRegistryEntry} list.
 *
 * Fails loud (throws, with a locating message) on:
 * - unreadable/malformed YAML,
 * - a document that isn't a list,
 * - any entry missing a required field (`id`/`name`/`description`) or
 *   carrying an unrecognized key,
 * - two entries sharing the same `id`.
 *
 * An empty list (`[]`) is a VALID, empty registry -- this build defines the
 * registry but populates no thread (FR-011). A missing file is likewise
 * treated as an empty registry (mirroring `@/bibliography/search-log`'s
 * "not required to exist yet" treatment of optional authored data); once the
 * file exists, its contents must be well-formed -- there is no fallback.
 */
export function loadScopesRegistry(filePath: string): ThreadRegistryEntry[] {
  if (!existsSync(filePath)) {
    return [];
  }

  const text = readFileText(filePath);
  const parsed: unknown = parseYamlOrFail(text, filePath);

  if (parsed === undefined || parsed === null) {
    return [];
  }
  if (!Array.isArray(parsed)) {
    fail(filePath, 'document must be a list of thread-registry entries');
  }

  const entries = parsed.map((value, index) => validateEntry(value, filePath, index));

  const seenIds = new Set<string>();
  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      fail(filePath, `duplicate thread id "${entry.id}"`);
    }
    seenIds.add(entry.id);
  }

  return entries;
}

/**
 * The registered thread ids as a `Set`, for the {@link ScopeResolutionContext}
 * `threadIds` field {@link resolveScopeRef} (`@/bibliography/scope`) checks a
 * `{ kind: 'thread' }` ScopeRef against. Downstream scope resolution consumes
 * this, never the raw entry list, when it only needs id membership.
 */
export function threadIdSet(registry: readonly ThreadRegistryEntry[]): ReadonlySet<string> {
  return new Set(registry.map((entry) => entry.id));
}
