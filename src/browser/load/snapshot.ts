/**
 * The committed-snapshot read/write path. A snapshot is the serializable
 * {@link CorpusSnapshot} for ONE source, persisted GZIPPED as
 * `<snapshotDir>/<sourceId>.json.gz` (one file per source, deterministic key
 * order under a fixed-mtime gzip). The Astro build reads these instead of the
 * private archive when no archive clone is available (e.g. on Netlify) -- the
 * corpus is public-domain, so the snapshot is committed to the repo (see
 * scripts/build-snapshot.ts and site/README.md).
 *
 * The snapshot carries only what the build renders (text + metadata + image
 * handles); the bloated redundant `rights_raw` archive XML is never part of the
 * corpus model, so it is absent by construction.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import path from 'node:path';

import type { CorpusSnapshot, RawSource, SkippedIssue } from '@/browser/model';
import { parseCorpusSnapshot } from '@/browser/load/snapshot-guards';

/** The on-disk path of a single source's gzipped snapshot file. */
export function snapshotFilePath(snapshotDir: string, sourceId: string): string {
  return path.join(snapshotDir, `${sourceId}.json.gz`);
}

/**
 * Serializes + gzips a snapshot and writes it to `<snapshotDir>/<sourceId>.json.gz`.
 * Deterministic: the JSON is stably serialized and Node's gzip writes a zero
 * mtime header, so re-running over the same corpus yields byte-identical output
 * on a given platform. Returns the written byte size.
 */
export function writeSnapshotFile(
  snapshotDir: string,
  sourceId: string,
  snapshot: CorpusSnapshot
): number {
  const json = serializeSnapshot(snapshot);
  const gz = gzipSync(Buffer.from(json, 'utf-8'), { level: 9 });
  writeFileSync(snapshotFilePath(snapshotDir, sourceId), gz);
  return gz.byteLength;
}

/**
 * True iff a committed snapshot file exists for EVERY requested source under
 * `snapshotDir`. Used by `loadCorpus` to decide the archive-vs-snapshot
 * precedence: a snapshot is only "available" when every source it needs is
 * present, so a partial snapshot dir does not silently drop sources.
 */
export function snapshotAvailable(snapshotDir: string, sources: string[]): boolean {
  if (sources.length === 0) {
    return false;
  }
  return sources.every((sourceId) => existsSync(snapshotFilePath(snapshotDir, sourceId)));
}

/**
 * Reads + validates the committed snapshot for `sources` from `snapshotDir`,
 * merging the one-file-per-source snapshots into a single {@link CorpusSnapshot}
 * (source order follows `sources`). Fail-loud: a missing file, unparseable
 * JSON, or a missing/wrong-typed field throws naming the file/field -- no
 * placeholder substitution.
 *
 * @throws Error if a source's snapshot file is absent, is not valid JSON, or
 *   fails structural validation.
 */
export function readSnapshotCorpus(snapshotDir: string, sources: string[]): CorpusSnapshot {
  if (sources.length === 0) {
    throw new Error('readSnapshotCorpus: sources is empty -- at least one source id is required.');
  }

  const allSources: RawSource[] = [];
  const allSkipped: SkippedIssue[] = [];

  for (const sourceId of sources) {
    const file = snapshotFilePath(snapshotDir, sourceId);
    if (!existsSync(file)) {
      throw new Error(
        `readSnapshotCorpus: snapshot file for source ${JSON.stringify(sourceId)} not found at ` +
          `${file}. Regenerate the snapshot with "npm run site:snapshot" (see site/README.md).`
      );
    }

    let text: string;
    try {
      text = gunzipSync(readFileSync(file)).toString('utf-8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`readSnapshotCorpus: ${file} could not be gunzipped -- ${message}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`readSnapshotCorpus: ${file} is not valid JSON -- ${message}`);
    }

    const snapshot = parseCorpusSnapshot(parsed, file);
    allSources.push(...snapshot.sources);
    allSkipped.push(...snapshot.skipped);
  }

  return { sources: allSources, skipped: allSkipped };
}

/**
 * Serializes a {@link CorpusSnapshot} to a deterministic JSON string:
 * object keys are emitted in sorted order (so re-running the writer over the
 * same archive yields a byte-identical, diff-friendly file) while array order
 * is preserved (pages/issues stay in their loaded order). 2-space indented.
 */
export function serializeSnapshot(snapshot: CorpusSnapshot): string {
  return `${stableStringify(snapshot, 0)}\n`;
}

const INDENT = '  ';

function stableStringify(value: unknown, depth: number): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return stringifyArray(value, depth);
  }
  if (typeof value === 'object') {
    return stringifyObject(value as Record<string, unknown>, depth);
  }
  // `undefined`, function, symbol -- not expected in a snapshot; drop to null
  // so the output stays valid JSON and the defect is visible on read.
  return 'null';
}

function stringifyArray(value: unknown[], depth: number): string {
  if (value.length === 0) {
    return '[]';
  }
  const pad = INDENT.repeat(depth + 1);
  const items = value.map((item) => `${pad}${stableStringify(item, depth + 1)}`);
  return `[\n${items.join(',\n')}\n${INDENT.repeat(depth)}]`;
}

function stringifyObject(value: Record<string, unknown>, depth: number): string {
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  if (keys.length === 0) {
    return '{}';
  }
  const pad = INDENT.repeat(depth + 1);
  const entries = keys.map(
    (key) => `${pad}${JSON.stringify(key)}: ${stableStringify(value[key], depth + 1)}`
  );
  return `{\n${entries.join(',\n')}\n${INDENT.repeat(depth)}}`;
}
