import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  blockScalar,
  emitBoolean,
  emitInteger,
  parseOptionalBoolean,
  quotedScalar,
  requireField,
  requireInteger,
  requireSub,
  unquoteScalar,
} from '@/archive/provenance-scalars';

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
   * Intentionally-blank-recto marker (spec 015 FR-014): `true` on a folio
   * that is a plate/illustration/cover/blank leaf with no reading text -- the
   * English-source path's sole opt-out from the empty-OCR fail-loud (the
   * analog of the French path's `untranslatable` translation label, but
   * carried on the folio sidecar since English sources have no translation
   * sidecar). Additive OPTIONAL key: absent on every non-plate folio, which
   * must re-serialize byte-identically.
   */
  blank_recto?: boolean;
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
  'blank_recto',
  'object_store',
  'ocr_quality',
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

/**
 * Emit the optional `ocr_quality` block: omitted entirely when absent (so
 * non-OCR records re-serialize byte-identically), else a nested block with the
 * fixed sub-key order -- `method`/`language`/`tier` as quoted scalars, `ratio`
 * as a bare number.
 */
function emitOcrQuality(quality: OcrQuality | undefined): string | undefined {
  if (quality === undefined) {
    return undefined;
  }
  return [
    'ocr_quality:',
    `  method: ${quotedScalar(quality.method)}`,
    `  language: ${quotedScalar(quality.language)}`,
    `  ratio: ${quality.ratio}`,
    `  tier: ${quotedScalar(quality.tier)}`,
  ].join('\n');
}

/** Emit one provenance line/block, dispatching the two non-string fields. */
function emitEntry(
  key: keyof ProvenanceFields,
  fields: ProvenanceFields,
): string | undefined {
  switch (key) {
    case 'size':
      return emitInteger('size', fields.size);
    case 'object_store':
      return emitObjectStore(fields.object_store);
    case 'ocr_quality':
      return emitOcrQuality(fields.ocr_quality);
    case 'engine':
    case 'model':
    case 'translation': {
      // Additive OPTIONAL keys: omit entirely when unset so non-translation
      // records (without them) re-serialize byte-identically.
      const value = fields[key];
      return value === undefined ? undefined : emitField(key, value);
    }
    case 'blank_recto': {
      // Additive OPTIONAL boolean key (FR-014): omit entirely when unset so
      // non-plate folios re-serialize byte-identically.
      const value = fields.blank_recto;
      return value === undefined ? undefined : emitBoolean('blank_recto', value);
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
 * Parse the two-space-indented `method/language/ratio/tier` sub-lines of an
 * `ocr_quality:` block starting at `start`. `ratio` is a bare number; `tier` is
 * validated against the closed set. Returns the quality and the index of the
 * first line after the block.
 */
function parseOcrQualityBlock(
  lines: string[],
  start: number,
): { quality: OcrQuality; next: number } {
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
  const ratioRaw = requireSub(values, 'ratio');
  const ratio = Number(ratioRaw);
  if (!Number.isFinite(ratio)) {
    throw new Error(
      `parseProvenance: ocr_quality.ratio is not a number: "${ratioRaw}"`,
    );
  }
  const tier = requireSub(values, 'tier');
  if (tier !== 'low' && tier !== 'medium' && tier !== 'high') {
    throw new Error(
      `parseProvenance: ocr_quality.tier must be low|medium|high, got "${tier}"`,
    );
  }
  const quality: OcrQuality = {
    method: requireSub(values, 'method'),
    language: requireSub(values, 'language'),
    ratio,
    tier,
  };
  return { quality, next: i };
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
  return { scalars: raw, objectStore, objectStoreSeen, ocrQuality };
}

/**
 * Parse a companion YAML file's text (as written by {@link writeProvenance})
 * back into typed {@link ProvenanceFields}. Used by the OCR pipeline to reuse
 * an already-fetched page's rights/catalog metadata (no re-fetch, no network)
 * when building the derived PDF/A and text asset provenance (T030).
 */
export function parseProvenance(text: string): ProvenanceFields {
  const { scalars, objectStore, objectStoreSeen, ocrQuality } =
    parseRawFields(text);
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
    blank_recto: parseOptionalBoolean(scalars, 'blank_recto'),
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
