/**
 * Generic, dependency-free validation primitives shared by `load.ts` and
 * `load-fields.ts` for narrowing `unknown` parsed YAML with descriptive,
 * locating errors (fail loud, no fallback, no `any`).
 */

/** Throw a locating, descriptive error naming the file and offending path. */
export function fail(filePath: string, message: string): never {
  throw new Error(`loadSourceFile(${filePath}): ${message}`);
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireObject(
  value: unknown,
  filePath: string,
  where: string,
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    fail(filePath, `${where} must be an object`);
  }
  return value;
}

export function requireString(value: unknown, filePath: string, where: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(filePath, `${where} must be a non-empty string`);
  }
  return value;
}

export function requireNumber(value: unknown, filePath: string, where: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    fail(filePath, `${where} must be a number`);
  }
  return value;
}

export function optionalString(
  value: unknown,
  filePath: string,
  where: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireString(value, filePath, where);
}

export function requireArray(value: unknown, filePath: string, where: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(filePath, `${where} must be an array`);
  }
  return value;
}

export function assertKnownKeys(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  filePath: string,
  where: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      fail(filePath, `${where} has unknown key "${key}" (rule 8, no silent drop)`);
    }
  }
}
