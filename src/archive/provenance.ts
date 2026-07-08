import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
  'format',
  'ocr_status',
  'notes',
  'rights_raw',
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

/**
 * Deterministically serialize the provenance fields to YAML. Re-serializing
 * identical input yields byte-identical output. Ends with exactly one trailing
 * newline.
 */
export function serializeProvenance(fields: ProvenanceFields): string {
  const body = KEY_ORDER.map((key) => emitField(key, fields[key])).join('\n');
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

/** Read one required field out of the raw parsed map, failing loud if absent. */
function requireField(raw: Map<string, string | null>, key: string): string {
  const value = raw.get(key);
  if (value === undefined || value === null) {
    throw new Error(`parseProvenance: missing required field "${key}"`);
  }
  return value;
}

/**
 * Parse the fixed-format companion YAML this module writes back into raw
 * `key -> value` pairs. This is a round-trip reader for OUR OWN deterministic
 * serialization (see {@link serializeProvenance}) -- not a general YAML
 * parser -- so it only needs to understand the three shapes `emitField`
 * produces: `key: null`, `key: "quoted scalar"`, and `key: |2` block scalars.
 */
function parseRawFields(text: string): Map<string, string | null> {
  const lines = text.split('\n');
  const raw = new Map<string, string | null>();
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
    if (rest === 'null') {
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
  return raw;
}

/**
 * Parse a companion YAML file's text (as written by {@link writeProvenance})
 * back into typed {@link ProvenanceFields}. Used by the OCR pipeline to reuse
 * an already-fetched page's rights/catalog metadata (no re-fetch, no network)
 * when building the derived PDF/A and text asset provenance (T030).
 */
export function parseProvenance(text: string): ProvenanceFields {
  const raw = parseRawFields(text);
  return {
    id: requireField(raw, 'id'),
    title: requireField(raw, 'title'),
    type: requireField(raw, 'type'),
    case: requireField(raw, 'case'),
    language: requireField(raw, 'language'),
    source_archive: requireField(raw, 'source_archive'),
    catalog_url: requireField(raw, 'catalog_url'),
    original_url: requireField(raw, 'original_url'),
    rights_status: requireField(raw, 'rights_status'),
    retrieved: requireField(raw, 'retrieved'),
    local_path: requireField(raw, 'local_path'),
    sha256: requireField(raw, 'sha256'),
    format: requireField(raw, 'format'),
    ocr_status: requireField(raw, 'ocr_status'),
    notes: raw.get('notes') ?? null,
    rights_raw: requireField(raw, 'rights_raw'),
  };
}

/** Read and parse a companion YAML file from disk. */
export async function readProvenance(yamlPath: string): Promise<ProvenanceFields> {
  const text = await readFile(yamlPath, 'utf-8');
  return parseProvenance(text);
}
