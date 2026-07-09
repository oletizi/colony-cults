import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Where an asset master lives in the object store, once uploaded (T009). The
 * object key is the archive-relative path, so it mirrors `local_path`. All four
 * sub-fields are emitted as a fixed-order nested YAML block under
 * `object_store:` (provider, bucket, key, endpoint).
 */
export interface ObjectStoreLocation {
  /** Storage provider, e.g. `backblaze-b2`. */
  provider: string;
  /** Bucket name, e.g. `colony-cults`. */
  bucket: string;
  /** Object key = archive-relative path, e.g. `archive/cases/.../f001.jpg`. */
  key: string;
  /** S3-compatible endpoint the object was uploaded to. */
  endpoint: string;
}

/**
 * The fields of a per-asset companion YAML file, conforming to the archive
 * repo's existing convention (see its `PB-P001.yml`) extended with the
 * FR-005/FR-007 requirements (original URL, checksum, format, ocr_status, and
 * the raw OAIRecord rights response).
 */
export interface ProvenanceFields {
  /** Source id, e.g. `PB-P001`. */
  id: string;
  /** Human title of the source. */
  title: string;
  /** Asset type, e.g. `page-image`. */
  type: string;
  /** Case folder, e.g. `port-breton`. */
  case: string;
  /** Primary language, e.g. `French`. */
  language: string;
  /** Holding archive, e.g. `Gallica / BnF`. */
  source_archive: string;
  /** Catalog / issue landing URL (the issue ark URL). */
  catalog_url: string;
  /** The exact origin URL the asset bytes were fetched from. */
  original_url: string;
  /** Rights determination, e.g. `public-domain`. */
  rights_status: string;
  /** Retrieval timestamp (ISO). */
  retrieved: string;
  /** Archive-relative path of the asset, e.g. `archive/cases/.../f001.jpg`. */
  local_path: string;
  /** Lowercase-hex SHA-256 of the asset bytes. */
  sha256: string;
  /** MIME type, e.g. `image/jpeg`. */
  format: string;
  /** OCR outcome: `none` | `searchable` | `failed`. */
  ocr_status: string;
  /** Integer byte count of the asset (T008), emitted as a bare integer. */
  size: number;
  /** Object-store master location (T009), or `null` when not yet uploaded. */
  object_store: ObjectStoreLocation | null;
  /** Full raw OAIRecord XML (FR-005) -- emitted as a YAML block scalar. */
  rights_raw: string;
  /** Free-text notes (nullable). */
  notes: string | null;
}

/**
 * Fixed key emission order (determinism, FR-007). The two potentially
 * multi-line fields (`notes`, `rights_raw`) come last so the file reads
 * cleanly; `rights_raw` (the big XML block) is dead last.
 */
const KEY_ORDER: readonly (keyof ProvenanceFields)[] = [
  'id',
  'title',
  'type',
  'case',
  'language',
  'source_archive',
  'catalog_url',
  'original_url',
  'rights_status',
  'retrieved',
  'local_path',
  'sha256',
  'size',
  'format',
  'ocr_status',
  'object_store',
  'notes',
  'rights_raw',
];

/** Fixed emission order of the nested `object_store` block's sub-keys. */
const OBJECT_STORE_KEYS: readonly (keyof ObjectStoreLocation)[] = [
  'provider',
  'bucket',
  'key',
  'endpoint',
];

/** A single-line, always-double-quoted YAML scalar (safe for `:`/`#`/quotes). */
function quotedScalar(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/**
 * A YAML literal block scalar with an explicit indentation indicator (`|2`),
 * so a first content line that itself begins with whitespace can never be
 * misread as the block's indentation. Every content line is indented by two
 * spaces; blank lines are emitted empty.
 */
function blockScalar(key: string, text: string): string {
  const lines = text.split('\n');
  const body = lines
    .map((line) => (line.length === 0 ? '' : `  ${line}`))
    .join('\n');
  return `${key}: |2\n${body}`;
}

/** Emit one `key: value` line (or block), choosing scalar vs block by shape. */
function emitField(key: keyof ProvenanceFields, value: string | null): string {
  if (value === null) {
    return `${key}: null`;
  }
  if (key === 'rights_raw' || value.includes('\n')) {
    return blockScalar(key, value);
  }
  return `${key}: ${quotedScalar(value)}`;
}

/** Emit `size: 123456` as a bare integer; a non-integer is a hard error. */
function emitInteger(value: number): string {
  if (!Number.isInteger(value)) {
    throw new Error(
      `serializeProvenance: size must be an integer byte count, got ${value}`,
    );
  }
  return `size: ${value}`;
}

/**
 * Emit the `object_store` field: either `object_store: null` or a nested block
 * with the fixed sub-key order, each sub-value a quoted scalar indented two
 * spaces.
 */
function emitObjectStore(location: ObjectStoreLocation | null): string {
  if (location === null) {
    return 'object_store: null';
  }
  const sub = OBJECT_STORE_KEYS.map(
    (k) => `  ${k}: ${quotedScalar(location[k])}`,
  );
  return ['object_store:', ...sub].join('\n');
}

/** Emit one provenance line/block, dispatching the two non-string fields. */
function emitEntry(key: keyof ProvenanceFields, fields: ProvenanceFields): string {
  switch (key) {
    case 'size':
      return emitInteger(fields.size);
    case 'object_store':
      return emitObjectStore(fields.object_store);
    default:
      return emitField(key, fields[key]);
  }
}

/**
 * Deterministically serialize the provenance fields to YAML. Re-serializing
 * identical input yields byte-identical output. Ends with exactly one trailing
 * newline.
 */
export function serializeProvenance(fields: ProvenanceFields): string {
  const body = KEY_ORDER.map((key) => emitEntry(key, fields)).join('\n');
  return `${body}\n`;
}

/** Write the companion YAML file for an asset, creating parent dirs as needed. */
export async function writeProvenance(
  yamlPath: string,
  fields: ProvenanceFields,
): Promise<void> {
  await mkdir(path.dirname(yamlPath), { recursive: true });
  await writeFile(yamlPath, serializeProvenance(fields), 'utf-8');
}

/** Reverse of {@link quotedScalar}: unescape a double-quoted YAML scalar body. */
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

/** The raw shapes recovered from OUR OWN serialization, before typing. */
interface ParsedRaw {
  /** Scalar/`null`/block-scalar fields keyed by name. */
  scalars: Map<string, string | null>;
  /** The parsed `object_store` block, or `null` for `object_store: null`. */
  objectStore: ObjectStoreLocation | null;
  /** Whether an `object_store:` line was present at all. */
  objectStoreSeen: boolean;
}

/** Read one required field out of the raw parsed map, failing loud if absent. */
function requireField(raw: Map<string, string | null>, key: string): string {
  const value = raw.get(key);
  if (value === undefined || value === null) {
    throw new Error(`parseProvenance: missing required field "${key}"`);
  }
  return value;
}

/** Read a required integer field (e.g. `size`), failing loud on absence/shape. */
function requireInteger(raw: Map<string, string | null>, key: string): number {
  const value = requireField(raw, key);
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(
      `parseProvenance: field "${key}" is not an integer: "${value}"`,
    );
  }
  return parsed;
}

/** Read one required sub-key out of an object_store block, failing loud. */
function requireSub(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (value === undefined) {
    throw new Error(`parseProvenance: object_store block missing "${key}"`);
  }
  return value;
}

/**
 * Parse the indented `provider/bucket/key/endpoint` sub-lines of an
 * `object_store:` block (each a two-space-indented quoted scalar), starting at
 * `start`. Returns the location and the index of the first line after the block.
 */
function parseObjectStoreBlock(
  lines: string[],
  start: number,
): { location: ObjectStoreLocation; next: number } {
  const values = new Map<string, string>();
  let i = start;
  while (i < lines.length) {
    const sub = lines[i].match(/^ {2}([a-zA-Z0-9_]+):\s?(.*)$/);
    if (!sub) {
      break;
    }
    const [, subKey, rest] = sub;
    if (rest.startsWith('"') && rest.endsWith('"') && rest.length >= 2) {
      values.set(subKey, unquoteScalar(rest.slice(1, -1)));
    } else {
      values.set(subKey, rest);
    }
    i += 1;
  }
  const location: ObjectStoreLocation = {
    provider: requireSub(values, 'provider'),
    bucket: requireSub(values, 'bucket'),
    key: requireSub(values, 'key'),
    endpoint: requireSub(values, 'endpoint'),
  };
  return { location, next: i };
}

/**
 * Parse the fixed-format companion YAML this module writes back into raw
 * `key -> value` pairs plus the nested `object_store`. This is a round-trip
 * reader for OUR OWN deterministic serialization (see
 * {@link serializeProvenance}) -- not a general YAML parser -- so it only needs
 * to understand the shapes emitted here: `key: null`, `key: "quoted scalar"`,
 * `key: |2` block scalars, the bare `size: 123` integer, and the nested
 * `object_store:` block (or `object_store: null`).
 */
function parseRawFields(text: string): ParsedRaw {
  const lines = text.split('\n');
  const raw = new Map<string, string | null>();
  let objectStore: ObjectStoreLocation | null = null;
  let objectStoreSeen = false;
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
      objectStoreSeen = true;
      if (rest === 'null') {
        objectStore = null;
        i += 1;
      } else if (rest === '') {
        const block = parseObjectStoreBlock(lines, i + 1);
        objectStore = block.location;
        i = block.next;
      } else {
        throw new Error(
          `parseProvenance: malformed object_store line: "${line}"`,
        );
      }
    } else if (rest === 'null') {
      raw.set(key, null);
      i += 1;
    } else if (rest === '|2') {
      const blockLines: string[] = [];
      i += 1;
      while (i < lines.length) {
        const blockLine = lines[i];
        if (blockLine.length === 0) {
          blockLines.push('');
          i += 1;
          continue;
        }
        if (blockLine.startsWith('  ')) {
          blockLines.push(blockLine.slice(2));
          i += 1;
          continue;
        }
        break;
      }
      // The trailing newline of the file yields one spurious empty element
      // at the very end of the block when it runs to EOF; drop it.
      if (blockLines.length > 0 && blockLines[blockLines.length - 1] === '') {
        blockLines.pop();
      }
      raw.set(key, blockLines.join('\n'));
    } else if (rest.startsWith('"') && rest.endsWith('"') && rest.length >= 2) {
      raw.set(key, unquoteScalar(rest.slice(1, -1)));
      i += 1;
    } else {
      raw.set(key, rest);
      i += 1;
    }
  }
  return { scalars: raw, objectStore, objectStoreSeen };
}

/**
 * Parse a companion YAML file's text (as written by {@link writeProvenance})
 * back into typed {@link ProvenanceFields}. Used by the OCR pipeline to reuse
 * an already-fetched page's rights/catalog metadata (no re-fetch, no network)
 * when building the derived PDF/A and text asset provenance (T030).
 */
export function parseProvenance(text: string): ProvenanceFields {
  const { scalars, objectStore, objectStoreSeen } = parseRawFields(text);
  if (!objectStoreSeen) {
    throw new Error('parseProvenance: missing required field "object_store"');
  }
  return {
    id: requireField(scalars, 'id'),
    title: requireField(scalars, 'title'),
    type: requireField(scalars, 'type'),
    case: requireField(scalars, 'case'),
    language: requireField(scalars, 'language'),
    source_archive: requireField(scalars, 'source_archive'),
    catalog_url: requireField(scalars, 'catalog_url'),
    original_url: requireField(scalars, 'original_url'),
    rights_status: requireField(scalars, 'rights_status'),
    retrieved: requireField(scalars, 'retrieved'),
    local_path: requireField(scalars, 'local_path'),
    sha256: requireField(scalars, 'sha256'),
    size: requireInteger(scalars, 'size'),
    format: requireField(scalars, 'format'),
    ocr_status: requireField(scalars, 'ocr_status'),
    object_store: objectStore,
    notes: scalars.get('notes') ?? null,
    rights_raw: requireField(scalars, 'rights_raw'),
  };
}

/** Read and parse a companion YAML file from disk. */
export async function readProvenance(yamlPath: string): Promise<ProvenanceFields> {
  const text = await readFile(yamlPath, 'utf-8');
  return parseProvenance(text);
}
