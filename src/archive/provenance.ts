import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  emitInputLayers,
  emitInputQuality,
  emitObjectStore,
  emitOcrQuality,
  parseInputLayersBlock,
  parseInputQualityBlock,
  parseObjectStoreBlock,
  parseOcrQualityBlock,
  quotedScalar,
  unquoteScalar,
} from '@/archive/provenance-blocks';

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

/** Coarse OCR fidelity tier (see `@/ocr/quality`). */
export type OcrQualityTier = 'low' | 'medium' | 'high';

/**
 * Computed OCR fidelity, MANDATORY on every `type: ocr-text` artifact
 * (Constitution III -- "record ... known quality issues"). The OCR pipeline
 * computes it before storing the text, and `bib validate` rejects any ocr-text
 * artifact missing it, so a lapse in recording it is mechanically impossible.
 * Emitted as a fixed-order nested block (`method`, `language`, `ratio`, `tier`).
 */
export interface OcrQuality {
  /** How the score was computed, versioned (e.g. `aspell-realword-ratio-v1`). */
  method: string;
  /** aspell dictionary language scored against (e.g. `fr`, `en`). */
  language: string;
  /** Real-word ratio 0..1 (bare number). */
  ratio: number;
  /** Coarse tier derived from `ratio`. */
  tier: OcrQualityTier;
}

/**
 * One input text layer a machine-generated summary was derived from (FR-005):
 * the archive-relative `path` of the consumed companion (e.g. `issue.txt`,
 * `issue.en.txt`) and the `sha256` it had at generation time. The pair is the
 * idempotency key. Emitted as a two-space-indented YAML sequence item under
 * `input_layers:` with the fixed sub-key order `path`, `sha256`.
 */
export interface InputLayer {
  /** Archive-relative path of the consumed input companion. */
  path: string;
  /** Lowercase-hex SHA-256 the input layer had at generation time. */
  sha256: string;
}

/**
 * Low-confidence provenance for a summary whose input OCR was weak (FR-016):
 * the coarse `tier` inherited from the input and a free-text `note`. Emitted as
 * a fixed-order nested block (`tier`, `note`).
 */
export interface InputQuality {
  /** Coarse input-fidelity tier (same closed set as {@link OcrQualityTier}). */
  tier: OcrQualityTier;
  /** Human note recording the low-confidence caveat. */
  note: string;
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
  /**
   * Machine-assistance engine that produced a derived artifact, e.g.
   * `claude-code-cli` / `codex-cli` (FR-006/FR-007). Additive OPTIONAL key:
   * absent on non-translation records, which must re-serialize byte-identically.
   */
  engine?: string;
  /** Resolved model id for a machine-assisted run, e.g. the `--model` value. */
  model?: string;
  /** Translation provenance label, e.g. `machine-assisted` (FR-007). */
  translation?: string;
  /**
   * The repository representation that produced this asset, e.g.
   * `papers-past-text-tab`. Additive OPTIONAL key: omitted when unset so
   * records without it re-serialize byte-identically.
   */
  source_representation?: string;
  /**
   * The "interpretation, not evidence" label on a machine-generated summary,
   * e.g. the literal `machine-generated-summary` (FR-005/006). Additive
   * OPTIONAL key: omitted when unset so non-summary records re-serialize
   * byte-identically.
   */
  interpretation?: string;
  /**
   * The input text layers a summary was derived from (FR-005). Additive
   * OPTIONAL key: omitted (not `[]`) when unset so non-summary records
   * re-serialize byte-identically.
   */
  input_layers?: InputLayer[];
  /**
   * Low-confidence input-OCR provenance for a summary (FR-016). Additive
   * OPTIONAL key: omitted when unset (present only when the input tier is low).
   */
  input_quality?: InputQuality;
  /** Integer byte count of the asset (T008), emitted as a bare integer. */
  size: number;
  /** Object-store master location (T009), or `null` when not yet uploaded. */
  object_store: ObjectStoreLocation | null;
  /**
   * Computed OCR fidelity -- REQUIRED on `type: ocr-text` artifacts, absent on
   * every other asset type. Additive OPTIONAL key at the type level (so
   * non-OCR records re-serialize byte-identically); its presence on ocr-text is
   * enforced by the OCR producer and by `bib validate`.
   */
  ocr_quality?: OcrQuality;
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
  'engine',
  'model',
  'translation',
  'source_representation',
  'interpretation',
  'input_layers',
  'input_quality',
  'object_store',
  'ocr_quality',
  'notes',
  'rights_raw',
];

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

/** Emit one provenance line/block, dispatching the two non-string fields. */
function emitEntry(
  key: keyof ProvenanceFields,
  fields: ProvenanceFields,
): string | undefined {
  switch (key) {
    case 'size':
      return emitInteger(fields.size);
    case 'object_store':
      return emitObjectStore(fields.object_store);
    case 'ocr_quality':
      return emitOcrQuality(fields.ocr_quality);
    case 'input_layers':
      return emitInputLayers(fields.input_layers);
    case 'input_quality':
      return emitInputQuality(fields.input_quality);
    case 'engine':
    case 'model':
    case 'translation':
    case 'source_representation':
    case 'interpretation': {
      // Additive OPTIONAL keys: omit entirely when unset so non-translation
      // records (without them) re-serialize byte-identically.
      const value = fields[key];
      return value === undefined ? undefined : emitField(key, value);
    }
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
  const body = KEY_ORDER.map((key) => emitEntry(key, fields))
    .filter((line): line is string => line !== undefined)
    .join('\n');
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

/** The raw shapes recovered from OUR OWN serialization, before typing. */
interface ParsedRaw {
  /** Scalar/`null`/block-scalar fields keyed by name. */
  scalars: Map<string, string | null>;
  /** The parsed `object_store` block, or `null` for `object_store: null`. */
  objectStore: ObjectStoreLocation | null;
  /** Whether an `object_store:` line was present at all. */
  objectStoreSeen: boolean;
  /** The parsed `ocr_quality` block, or `undefined` when the key is absent. */
  ocrQuality?: OcrQuality;
  /** The parsed `input_layers` sequence, or `undefined` when the key is absent. */
  inputLayers?: InputLayer[];
  /** The parsed `input_quality` block, or `undefined` when the key is absent. */
  inputQuality?: InputQuality;
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
  let ocrQuality: OcrQuality | undefined;
  let inputLayers: InputLayer[] | undefined;
  let inputQuality: InputQuality | undefined;
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
    } else if (key === 'ocr_quality') {
      if (rest !== '') {
        throw new Error(
          `parseProvenance: malformed ocr_quality line: "${line}"`,
        );
      }
      const block = parseOcrQualityBlock(lines, i + 1);
      ocrQuality = block.quality;
      i = block.next;
    } else if (key === 'input_layers') {
      if (rest !== '') {
        throw new Error(
          `parseProvenance: malformed input_layers line: "${line}"`,
        );
      }
      const block = parseInputLayersBlock(lines, i + 1);
      inputLayers = block.layers;
      i = block.next;
    } else if (key === 'input_quality') {
      if (rest !== '') {
        throw new Error(
          `parseProvenance: malformed input_quality line: "${line}"`,
        );
      }
      const block = parseInputQualityBlock(lines, i + 1);
      inputQuality = block.quality;
      i = block.next;
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
  return {
    scalars: raw,
    objectStore,
    objectStoreSeen,
    ocrQuality,
    inputLayers,
    inputQuality,
  };
}

/**
 * Parse a companion YAML file's text (as written by {@link writeProvenance})
 * back into typed {@link ProvenanceFields}. Used by the OCR pipeline to reuse
 * an already-fetched page's rights/catalog metadata (no re-fetch, no network)
 * when building the derived PDF/A and text asset provenance (T030).
 */
export function parseProvenance(text: string): ProvenanceFields {
  const {
    scalars,
    objectStore,
    objectStoreSeen,
    ocrQuality,
    inputLayers,
    inputQuality,
  } = parseRawFields(text);
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
    // Additive OPTIONAL keys: present -> string, absent -> undefined (omitted
    // on re-serialize); a stray null is normalized to undefined.
    engine: scalars.get('engine') ?? undefined,
    model: scalars.get('model') ?? undefined,
    translation: scalars.get('translation') ?? undefined,
    source_representation: scalars.get('source_representation') ?? undefined,
    interpretation: scalars.get('interpretation') ?? undefined,
    input_layers: inputLayers,
    input_quality: inputQuality,
    object_store: objectStore,
    ocr_quality: ocrQuality,
    notes: scalars.get('notes') ?? null,
    rights_raw: requireField(scalars, 'rights_raw'),
  };
}

/** Read and parse a companion YAML file from disk. */
export async function readProvenance(yamlPath: string): Promise<ProvenanceFields> {
  const text = await readFile(yamlPath, 'utf-8');
  return parseProvenance(text);
}
