/**
 * Small, fail-loud helpers for navigating the loosely-typed object that
 * `fast-xml-parser` produces. Every accessor throws a descriptive Error when
 * the shape is wrong -- no fallbacks, no silent `undefined` (see the project's
 * no-fallback rule and FR-015).
 *
 * All guards are user-defined type predicates so no `as` cast is needed.
 */

/** True when `value` is a plain (non-array) object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Narrow `value` to a record or throw with context. */
export function requireRecord(
  value: unknown,
  ctx: string,
): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  throw new Error(`${ctx}: expected an object, got ${describe(value)}`);
}

/** Read a required child object from `parent[key]`. */
export function childRecord(
  parent: Record<string, unknown>,
  key: string,
  ctx: string,
): Record<string, unknown> {
  return requireRecord(parent[key], `${ctx} > ${key}`);
}

/** Narrow `value` to a non-empty string (or numeric string) or throw. */
export function requireString(value: unknown, ctx: string): string {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  throw new Error(`${ctx}: expected a non-empty string, got ${describe(value)}`);
}

/** Read a required string from `parent[key]`. */
export function childString(
  parent: Record<string, unknown>,
  key: string,
  ctx: string,
): string {
  return requireString(parent[key], `${ctx} > ${key}`);
}

/** Coerce a required numeric value (fast-xml-parser may hand back a string). */
export function requireNumber(value: unknown, ctx: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new Error(`${ctx}: expected a number, got ${describe(value)}`);
}

/** Read a required number from `parent[key]`. */
export function childNumber(
  parent: Record<string, unknown>,
  key: string,
  ctx: string,
): number {
  return requireNumber(parent[key], `${ctx} > ${key}`);
}

/**
 * Normalize a fast-xml-parser value that is "one or many" into an array.
 * A single child element is an object; repeated elements are an array.
 */
export function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function describe(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'object') {
    return Array.isArray(value) ? 'an array' : JSON.stringify(value);
  }
  return JSON.stringify(value);
}
