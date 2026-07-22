import type {
  InputLayer,
  InputQuality,
  ObjectStoreLocation,
  OcrQuality,
} from '@/archive/provenance';
import {
  quotedScalar,
  requireSub,
  unquoteScalar,
} from '@/archive/provenance-scalars';

/**
 * Provenance origin of one summary input layer (FR-021): the project's own OCR
 * or English translation, or source-downloaded OCR (Papers Past's own text-tab
 * OCR, honestly attributed as NOT the project's work).
 */
export type InputLayerOrigin = 'project-ocr' | 'project-translation' | 'papers-past-ocr';

/** Runtime guard for a parsed {@link InputLayerOrigin} value (fail loud on unknown). */
function isInputLayerOrigin(value: string): value is InputLayerOrigin {
  return (
    value === 'project-ocr' || value === 'project-translation' || value === 'papers-past-ocr'
  );
}

/** Fixed emission order of the nested `object_store` block's sub-keys. */
const OBJECT_STORE_KEYS: readonly (keyof ObjectStoreLocation)[] = [
  'provider',
  'bucket',
  'key',
  'endpoint',
];

/**
 * Parse the two-space-indented body of a `key: |2` literal block scalar,
 * starting at `start` (the first body line). Returns the reconstructed text and
 * the index of the first line after the block. The file's trailing newline
 * yields one spurious empty element when the block runs to EOF; it is dropped.
 */
export function parseBlockScalar(
  lines: string[],
  start: number,
): { text: string; next: number } {
  const body: string[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (line.length === 0) {
      body.push('');
      i += 1;
      continue;
    }
    if (line.startsWith('  ')) {
      body.push(line.slice(2));
      i += 1;
      continue;
    }
    break;
  }
  if (body.length > 0 && body[body.length - 1] === '') {
    body.pop();
  }
  return { text: body.join('\n'), next: i };
}

/** Strip surrounding double quotes from a sub-value, unescaping when quoted. */
export function readSubScalar(rest: string): string {
  if (rest.startsWith('"') && rest.endsWith('"') && rest.length >= 2) {
    return unquoteScalar(rest.slice(1, -1));
  }
  return rest;
}

/**
 * Emit the `object_store` field: either `object_store: null` or a nested block
 * with the fixed sub-key order, each sub-value a quoted scalar indented two
 * spaces.
 */
export function emitObjectStore(location: ObjectStoreLocation | null): string {
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
export function emitOcrQuality(
  quality: OcrQuality | undefined,
): string | undefined {
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

/**
 * Emit the optional `input_layers` sequence: omitted entirely when absent (so
 * non-summary records re-serialize byte-identically), else a YAML sequence of
 * mappings, each a two-space-indented item with the fixed sub-key order
 * (`- path:` then four-space-indented `sha256:`, then the additive-optional
 * `origin:` and `source_representation:` -- both omitted when unset, so a layer
 * without them re-serializes byte-identically to the pre-FR-021 two-line shape).
 */
export function emitInputLayers(
  layers: InputLayer[] | undefined,
): string | undefined {
  if (layers === undefined) {
    return undefined;
  }
  const items = layers.flatMap((layer) => {
    const lines = [
      `  - path: ${quotedScalar(layer.path)}`,
      `    sha256: ${quotedScalar(layer.sha256)}`,
    ];
    if (layer.origin !== undefined) {
      lines.push(`    origin: ${quotedScalar(layer.origin)}`);
    }
    if (layer.source_representation !== undefined) {
      lines.push(`    source_representation: ${quotedScalar(layer.source_representation)}`);
    }
    return lines;
  });
  return ['input_layers:', ...items].join('\n');
}

/**
 * Emit the optional `input_quality` block: omitted entirely when absent, else a
 * nested block with the fixed sub-key order (`tier`, `note`) as quoted scalars.
 */
export function emitInputQuality(
  quality: InputQuality | undefined,
): string | undefined {
  if (quality === undefined) {
    return undefined;
  }
  return [
    'input_quality:',
    `  tier: ${quotedScalar(quality.tier)}`,
    `  note: ${quotedScalar(quality.note)}`,
  ].join('\n');
}

/**
 * Emit an optional rollup coverage list (`covered_issues` / `missing_issues`,
 * FR-009): omitted entirely when `undefined` (so non-rollup records
 * re-serialize byte-identically), `key: []` when present-but-empty, else a
 * deterministic block sequence of quoted issue-ark scalars (mirroring the
 * frontmatter list shape in `src/summarize/artifacts.ts`).
 */
export function emitIssueList(
  key: string,
  values: string[] | undefined,
): string | undefined {
  if (values === undefined) {
    return undefined;
  }
  if (values.length === 0) {
    return `${key}: []`;
  }
  const items = values.map((value) => `  - ${quotedScalar(value)}`);
  return [`${key}:`, ...items].join('\n');
}

/**
 * Parse an optional rollup coverage list emitted by {@link emitIssueList}.
 * `headerIndex` is the `key:` line index; `rest` its inline remainder. `[]` is
 * the empty list; an empty remainder introduces a block sequence of quoted
 * scalars. Returns the items and the index of the first line after the field.
 */
export function parseIssueList(
  lines: string[],
  headerIndex: number,
  rest: string,
): { items: string[]; next: number } {
  if (rest === '[]') {
    return { items: [], next: headerIndex + 1 };
  }
  if (rest !== '') {
    throw new Error(
      `parseProvenance: malformed issue-list line: "${lines[headerIndex]}"`,
    );
  }
  const items: string[] = [];
  let i = headerIndex + 1;
  while (i < lines.length) {
    const item = lines[i].match(/^ {2}- (.*)$/);
    if (!item) {
      break;
    }
    items.push(readSubScalar(item[1]));
    i += 1;
  }
  return { items, next: i };
}

/**
 * Parse the indented `provider/bucket/key/endpoint` sub-lines of an
 * `object_store:` block (each a two-space-indented quoted scalar), starting at
 * `start`. Returns the location and the index of the first line after the block.
 */
export function parseObjectStoreBlock(
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
export function parseOcrQualityBlock(
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
 * Parse the `input_layers:` sequence starting at `start`: repeated items, each
 * a `  - path: "..."` line followed by four-space-indented continuation
 * sub-keys -- `sha256:` (required) and the additive-optional `origin:` /
 * `source_representation:` (FR-021). Returns the layers and the index of the
 * first line after the block. A layer without the optional keys round-trips to
 * the pre-FR-021 `{ path, sha256 }` shape (byte-identity preserved).
 */
export function parseInputLayersBlock(
  lines: string[],
  start: number,
): { layers: InputLayer[]; next: number } {
  const layers: InputLayer[] = [];
  let i = start;
  while (i < lines.length) {
    const item = lines[i].match(/^ {2}- path:\s?(.*)$/);
    if (!item) {
      break;
    }
    const layerPath = readSubScalar(item[1]);
    i += 1;
    const sub = new Map<string, string>();
    while (i < lines.length) {
      const cont = lines[i].match(/^ {4}([a-zA-Z0-9_]+):\s?(.*)$/);
      if (!cont) {
        break;
      }
      sub.set(cont[1], readSubScalar(cont[2]));
      i += 1;
    }
    const sha256 = sub.get('sha256');
    if (sha256 === undefined) {
      throw new Error(
        `parseProvenance: input_layers item missing sha256 for path "${layerPath}"`,
      );
    }
    const layer: InputLayer = { path: layerPath, sha256 };
    const origin = sub.get('origin');
    if (origin !== undefined) {
      if (!isInputLayerOrigin(origin)) {
        throw new Error(
          `parseProvenance: input_layers origin "${origin}" is not ` +
            'project-ocr|project-translation|papers-past-ocr',
        );
      }
      layer.origin = origin;
    }
    const representation = sub.get('source_representation');
    if (representation !== undefined) {
      layer.source_representation = representation;
    }
    layers.push(layer);
  }
  if (layers.length === 0) {
    throw new Error('parseProvenance: input_layers block is empty');
  }
  return { layers, next: i };
}

/**
 * Parse the two-space-indented `tier`/`note` sub-lines of an `input_quality:`
 * block starting at `start`. `tier` is validated against the closed set.
 * Returns the quality and the index of the first line after the block.
 */
export function parseInputQualityBlock(
  lines: string[],
  start: number,
): { quality: InputQuality; next: number } {
  const values = new Map<string, string>();
  let i = start;
  while (i < lines.length) {
    const sub = lines[i].match(/^ {2}([a-zA-Z0-9_]+):\s?(.*)$/);
    if (!sub) {
      break;
    }
    values.set(sub[1], readSubScalar(sub[2]));
    i += 1;
  }
  const tier = requireSub(values, 'tier');
  if (tier !== 'low' && tier !== 'medium' && tier !== 'high') {
    throw new Error(
      `parseProvenance: input_quality.tier must be low|medium|high, got "${tier}"`,
    );
  }
  const quality: InputQuality = { tier, note: requireSub(values, 'note') };
  return { quality, next: i };
}
