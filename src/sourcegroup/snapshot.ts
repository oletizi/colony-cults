import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { MetadataSnapshotRef } from '@/model/repository-record';

/**
 * Immutable metadata-snapshot store (T015, FR-004, D-07): one raw
 * repository response, written once and never overwritten. Referenced (by a
 * parallel task) from `RepositoryRecord.metadataSnapshot` via the
 * `MetadataSnapshotRef` this module returns. Re-inventory calls
 * `writeSnapshot` again with a new caller-supplied `stamp`, which lands at a
 * distinct path -- the original snapshot is left untouched.
 *
 * See specs/006-source-group-acquisition/data-model.md § MetadataSnapshot.
 */

/** Subpath under the base dir that all snapshots live under. */
const SNAPSHOT_SUBDIR = ['bibliography', 'repository-responses'];

/** Input to {@link writeSnapshot}. */
export interface MetadataSnapshotInput {
  /** The owning member's Source id, e.g. `PB-P007`. Used for the storage subpath. */
  sourceId: string;
  /** The repository ark/identifier the response was retrieved for; slugified into the filename. */
  ark: string;
  /** The raw, unparsed repository response body (e.g. OAI-PMH XML). */
  raw: string;
  /** ISO retrieval timestamp. */
  retrievedAt: string;
  /** The discovery/repository endpoint the response was retrieved from. */
  endpoint: string;
  /** The normalization scheme version applied to derive normalized fields. */
  normalizationVersion: number;
  /**
   * Caller-injected uniqueness stamp distinguishing this snapshot from any
   * other snapshot of the same `(sourceId, ark)` -- e.g. a timestamp or a
   * content hash. Injected rather than generated here (no `Date.now()` /
   * `Math.random()` inside this module) so callers -- and tests -- stay
   * deterministic. A re-inventory that wants a new snapshot supplies a new
   * `stamp`; reusing an existing `stamp` deliberately collides with the
   * existing path and is rejected by the write-once guard below.
   */
  stamp: string;
}

/**
 * Imported from {@link @/model/repository-record} to ensure a single source
 * of truth for this type across the codebase.
 */
export type { MetadataSnapshotRef } from '@/model/repository-record';

/** The full body of a stored snapshot, as returned by {@link readSnapshot}. */
export interface MetadataSnapshotRecord {
  /** The raw, unparsed repository response body. */
  raw: string;
  /** ISO retrieval timestamp. */
  retrievedAt: string;
  /** The discovery/repository endpoint the response was retrieved from. */
  endpoint: string;
  /** The normalization scheme version applied to derive normalized fields. */
  normalizationVersion: number;
}

/** Turn an ark/identifier into a filesystem-safe filename component. */
function slugifyArk(ark: string): string {
  const slug = ark
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length === 0) {
    throw new Error(`writeSnapshot: ark "${ark}" produces an empty filename slug`);
  }
  return slug;
}

function isEexist(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    Object.prototype.hasOwnProperty.call(error, 'code') &&
    (error as { code: unknown }).code === 'EEXIST'
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Write a new immutable metadata snapshot under `baseDir` and return its
 * reference. Uses exclusive create (`wx`) so it is write-once: a collision
 * with an existing path (i.e. a repeated `stamp` for the same
 * `sourceId`/`ark`) fails loud instead of silently overwriting evidence.
 */
export async function writeSnapshot(
  baseDir: string,
  input: MetadataSnapshotInput,
): Promise<MetadataSnapshotRef> {
  const fileName = `${slugifyArk(input.ark)}-${input.stamp}.json`;
  const relativePath = path.join(...SNAPSHOT_SUBDIR, input.sourceId, fileName);
  const absolutePath = path.join(baseDir, relativePath);

  const record: MetadataSnapshotRecord = {
    raw: input.raw,
    retrievedAt: input.retrievedAt,
    endpoint: input.endpoint,
    normalizationVersion: input.normalizationVersion,
  };

  await mkdir(path.dirname(absolutePath), { recursive: true });

  try {
    await writeFile(absolutePath, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
  } catch (error) {
    if (isEexist(error)) {
      throw new Error(
        `writeSnapshot(${relativePath}): snapshot already exists -- metadata snapshots are ` +
          'write-once and are NEVER overwritten; a re-inventory that wants a new snapshot ' +
          'must supply a new "stamp" so it lands at a new path',
      );
    }
    throw new Error(
      `writeSnapshot(${relativePath}): failed to write snapshot: ${describeError(error)}`,
    );
  }

  return {
    path: relativePath,
    retrievedAt: input.retrievedAt,
    endpoint: input.endpoint,
    normalizationVersion: input.normalizationVersion,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireStringField(
  value: Record<string, unknown>,
  key: string,
  relativePath: string,
): string {
  const field = value[key];
  if (typeof field !== 'string') {
    throw new Error(`readSnapshot(${relativePath}): missing/non-string field "${key}"`);
  }
  return field;
}

function requireNumberField(
  value: Record<string, unknown>,
  key: string,
  relativePath: string,
): number {
  const field = value[key];
  if (typeof field !== 'number') {
    throw new Error(`readSnapshot(${relativePath}): missing/non-number field "${key}"`);
  }
  return field;
}

/** Parse and validate a stored snapshot's on-disk JSON into a {@link MetadataSnapshotRecord}. */
function parseSnapshotRecord(contents: string, relativePath: string): MetadataSnapshotRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(`readSnapshot(${relativePath}): malformed JSON: ${describeError(error)}`);
  }

  if (!isPlainObject(parsed)) {
    throw new Error(`readSnapshot(${relativePath}): snapshot is not a JSON object`);
  }

  return {
    raw: requireStringField(parsed, 'raw', relativePath),
    retrievedAt: requireStringField(parsed, 'retrievedAt', relativePath),
    endpoint: requireStringField(parsed, 'endpoint', relativePath),
    normalizationVersion: requireNumberField(parsed, 'normalizationVersion', relativePath),
  };
}

/**
 * Read back a snapshot previously written by {@link writeSnapshot}.
 * `relativePath` is the `path` field of the `MetadataSnapshotRef` it
 * returned (relative to the same `baseDir`).
 */
export async function readSnapshot(
  baseDir: string,
  relativePath: string,
): Promise<MetadataSnapshotRecord> {
  const absolutePath = path.join(baseDir, relativePath);

  let contents: string;
  try {
    contents = await readFile(absolutePath, 'utf8');
  } catch (error) {
    throw new Error(
      `readSnapshot(${relativePath}): cannot read snapshot file: ${describeError(error)}`,
    );
  }

  return parseSnapshotRecord(contents, relativePath);
}
