import { readFile } from 'node:fs/promises';

import type { ObjectStoreLocation } from '@/archive/provenance';

/**
 * The subset of a companion asset YAML's fields the bibliography roll-up
 * (`@/bibliography/derive`) needs to build a copy's asset manifest
 * (FR-011/FR-012). Distinct from -- and looser than -- {@link ProvenanceFields}
 * in `@/archive/provenance`: that strict reader is the fetch pipeline's
 * writer/reader contract and requires every field (including `size`), so it
 * throws on the archive's ~233 legacy asset sidecars that predate the
 * `object_store`/`size` fields. Those sidecars ARE valid assets (FR-011: "a
 * `null` object-store for legacy assets"), so this reader tolerates their
 * absence instead of throwing. A `object_store:` block that IS present but
 * malformed (e.g. missing `provider`) still throws -- legacy-absence and
 * corruption are different failure modes.
 */
export interface AssetProvenance {
  /** Holding archive, e.g. `Gallica / BnF`. */
  source_archive: string;
  /** Archive-relative path of the asset. */
  local_path: string;
  /** Asset type, e.g. `page-image`, `ocr-text`. */
  type: string;
  /** Lowercase-hex SHA-256 of the asset bytes. */
  sha256: string;
  /** Object-store master location, or `null` when absent or not yet uploaded. */
  object_store: ObjectStoreLocation | null;
  /**
   * MIME type, e.g. `image/jpeg`. Unlike `object_store`/`size`, this field
   * predates none of the archive's companion sidecars (100% coverage across
   * the real archive, legacy included), so it is required here, not tolerated
   * as absent.
   */
  format: string;
  /** The exact origin URL the asset bytes were fetched from (may be `""` for a derived asset). Same 100% coverage as `format`. */
  original_url: string;
}

const REQUIRED_KEYS = [
  'source_archive',
  'local_path',
  'type',
  'sha256',
  'format',
  'original_url',
] as const;
type RequiredKey = (typeof REQUIRED_KEYS)[number];

/** Reverse of the writer's `quotedScalar`: unescape a double-quoted YAML scalar body. */
function unquoteScalar(raw: string): string {
  let result = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (ch === '\\' && next === '\\') {
      result += '\\';
      i += 1;
    } else if (ch === '\\' && next === '"') {
      result += '"';
      i += 1;
    } else if (ch === '\\' && next === 't') {
      result += '\t';
      i += 1;
    } else {
      result += ch;
    }
  }
  return result;
}

/** Unquote a scalar's raw text if it is double-quoted, else return it as-is. */
function scalarValue(rest: string): string {
  if (rest.startsWith('"') && rest.endsWith('"') && rest.length >= 2) {
    return unquoteScalar(rest.slice(1, -1));
  }
  return rest;
}

/** Read one required sub-key out of an `object_store:` block, failing loud. */
function requireSub(values: Map<string, string>, key: string, yamlPath: string): string {
  const value = values.get(key);
  if (value === undefined) {
    throw new Error(
      `readAssetProvenance: "${yamlPath}" -- object_store block missing "${key}" (present-but-malformed, not legacy-absent)`,
    );
  }
  return value;
}

/**
 * Parse the indented `provider/bucket/key/endpoint` sub-lines of an
 * `object_store:` block, starting at `start`. A block present but missing a
 * sub-key is corruption -- throws (see {@link requireSub}) -- distinct from
 * the block being entirely absent, which is legacy-absence and does not throw.
 */
function parseObjectStoreBlock(
  lines: string[],
  start: number,
  yamlPath: string,
): { location: ObjectStoreLocation; next: number } {
  const values = new Map<string, string>();
  let i = start;
  while (i < lines.length) {
    const sub = lines[i].match(/^ {2}([a-zA-Z0-9_]+):\s?(.*)$/);
    if (!sub) {
      break;
    }
    values.set(sub[1], scalarValue(sub[2]));
    i += 1;
  }
  const location: ObjectStoreLocation = {
    provider: requireSub(values, 'provider', yamlPath),
    bucket: requireSub(values, 'bucket', yamlPath),
    key: requireSub(values, 'key', yamlPath),
    endpoint: requireSub(values, 'endpoint', yamlPath),
  };
  return { location, next: i };
}

/** Skip a `key: |2` literal block scalar's indented body, returning the index after it. */
function skipBlockScalar(lines: string[], start: number): number {
  let i = start;
  while (i < lines.length && (lines[i].length === 0 || lines[i].startsWith('  '))) {
    i += 1;
  }
  return i;
}

function requireField(scalars: Map<string, string>, key: RequiredKey, yamlPath: string): string {
  const value = scalars.get(key);
  if (value === undefined) {
    throw new Error(`readAssetProvenance: "${yamlPath}" -- missing required field "${key}"`);
  }
  return value;
}

/**
 * Tolerantly parse a companion asset YAML's text into {@link AssetProvenance}.
 * Only `source_archive`/`local_path`/`type`/`sha256` are required; every other
 * field (including `size`) is ignored, so a legacy sidecar that omits them
 * parses cleanly. `object_store` is `null` both when the key is entirely
 * absent (legacy) and when it is explicitly `object_store: null` (not yet
 * uploaded) -- but a present, incomplete block throws.
 */
export function parseAssetProvenance(text: string, yamlPath: string): AssetProvenance {
  const lines = text.split('\n');
  const scalars = new Map<string, string>();
  let objectStore: ObjectStoreLocation | null = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.length === 0) {
      i += 1;
      continue;
    }
    const header = line.match(/^([a-zA-Z0-9_]+):\s?(.*)$/);
    if (!header) {
      i += 1;
      continue;
    }
    const [, key, rest] = header;
    if (key === 'object_store') {
      if (rest === 'null') {
        objectStore = null;
        i += 1;
      } else if (rest === '') {
        const block = parseObjectStoreBlock(lines, i + 1, yamlPath);
        objectStore = block.location;
        i = block.next;
      } else {
        throw new Error(`readAssetProvenance: "${yamlPath}" -- malformed object_store line: "${line}"`);
      }
      continue;
    }
    if (rest === '|2') {
      i = skipBlockScalar(lines, i + 1);
      continue;
    }
    if (rest !== 'null') {
      scalars.set(key, scalarValue(rest));
    }
    i += 1;
  }
  return {
    source_archive: requireField(scalars, 'source_archive', yamlPath),
    local_path: requireField(scalars, 'local_path', yamlPath),
    type: requireField(scalars, 'type', yamlPath),
    sha256: requireField(scalars, 'sha256', yamlPath),
    object_store: objectStore,
    format: requireField(scalars, 'format', yamlPath),
    original_url: requireField(scalars, 'original_url', yamlPath),
  };
}

/** Read and tolerantly parse a companion asset YAML file from disk. */
export async function readAssetProvenance(yamlPath: string): Promise<AssetProvenance> {
  const text = await readFile(yamlPath, 'utf-8');
  return parseAssetProvenance(text, yamlPath);
}
