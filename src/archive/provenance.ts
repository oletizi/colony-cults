import { mkdir, writeFile } from 'node:fs/promises';
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
