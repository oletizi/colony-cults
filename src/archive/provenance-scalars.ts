/**
 * Generic YAML scalar codec primitives shared by `@/archive/provenance`'s
 * fixed-format companion-YAML reader/writer. Split out (T015) to keep
 * `provenance.ts` within the project's file-size guidance -- these functions
 * know nothing about `ProvenanceFields` shape, only about the handful of
 * scalar shapes the format emits/parses: a quoted string, a bare integer, a
 * bare boolean, and a `|2` literal block.
 */

/** A single-line, always-double-quoted YAML scalar (safe for `:`/`#`/quotes). */
export function quotedScalar(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/** Reverse of {@link quotedScalar}: unescape a double-quoted YAML scalar body. */
export function unquoteScalar(raw: string): string {
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

/**
 * A YAML literal block scalar with an explicit indentation indicator (`|2`),
 * so a first content line that itself begins with whitespace can never be
 * misread as the block's indentation. Every content line is indented by two
 * spaces; blank lines are emitted empty.
 */
export function blockScalar(key: string, text: string): string {
  const lines = text.split('\n');
  const body = lines
    .map((line) => (line.length === 0 ? '' : `  ${line}`))
    .join('\n');
  return `${key}: |2\n${body}`;
}

/** Emit `key: true`/`key: false` as a bare (unquoted) YAML boolean scalar. */
export function emitBoolean(key: string, value: boolean): string {
  return `${key}: ${value}`;
}

/** Emit `key: 123` as a bare integer; a non-integer is a hard error naming `key`. */
export function emitInteger(key: string, value: number): string {
  if (!Number.isInteger(value)) {
    throw new Error(
      `serializeProvenance: ${key} must be an integer, got ${value}`,
    );
  }
  return `${key}: ${value}`;
}

/** Read one required field out of the raw parsed map, failing loud if absent. */
export function requireField(raw: Map<string, string | null>, key: string): string {
  const value = raw.get(key);
  if (value === undefined || value === null) {
    throw new Error(`parseProvenance: missing required field "${key}"`);
  }
  return value;
}

/** Read a required integer field (e.g. `size`), failing loud on absence/shape. */
export function requireInteger(raw: Map<string, string | null>, key: string): number {
  const value = requireField(raw, key);
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(
      `parseProvenance: field "${key}" is not an integer: "${value}"`,
    );
  }
  return parsed;
}

/** Read one required sub-key out of a nested block (e.g. `object_store`), failing loud. */
export function requireSub(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (value === undefined) {
    throw new Error(`parseProvenance: object_store block missing "${key}"`);
  }
  return value;
}

/**
 * Read an OPTIONAL boolean scalar field (e.g. `blank_recto`, FR-014): absent
 * -> `undefined` (a stray explicit `null` is normalized to `undefined`,
 * mirroring the other additive optional keys); the bare unquoted scalars
 * `"true"`/`"false"` parse to their boolean; any other value is a malformed
 * sidecar and fails loud (fail-loud, no silent coercion).
 */
export function parseOptionalBoolean(
  raw: Map<string, string | null>,
  key: string,
): boolean | undefined {
  const value = raw.get(key);
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new Error(
    `parseProvenance: field "${key}" must be a boolean ("true"/"false"), got "${value}"`,
  );
}
