/**
 * Corpus config seam — the shape-checking primitives shared by the manifest
 * loader (`@/corpus/manifest`) and its `sourceIds` sub-validator
 * (`@/corpus/manifest-source-ids`).
 *
 * These exist as their own module for ONE reason: FR-002b turned `sourceIds`
 * from a single object into a validated non-empty list with a cross-entry
 * invariant (exactly one allocatable policy), which pushed `manifest.ts` past
 * the file-size limit. Splitting the `sourceIds` rules out means both modules
 * need the same four primitives, and duplicating them would let the two
 * copies of "unknown key" / "non-empty string" semantics drift.
 *
 * The `fail` prefix is deliberately fixed to `loadCorpusManifest(...)`: every
 * caller of these primitives is reached THROUGH that function, so the operator
 * always sees the entry point they invoked, not an internal helper name.
 */

/** Throw a locating, descriptive error naming the file and what is wrong. */
export function fail(filePath: string, message: string): never {
  throw new Error(`loadCorpusManifest(${filePath}): ${message}`);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reject any key not in `allowed` (no silent drop) — the rule that keeps a
 * typo'd field, or a field from a future schema version, from being accepted
 * and then quietly ignored.
 */
export function assertKnownKeys(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  filePath: string,
  where: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      fail(filePath, `${where} has unknown key "${key}" (no silent drop)`);
    }
  }
}

export function requireStringArray(value: unknown, filePath: string, where: string): string[] {
  if (!Array.isArray(value)) {
    fail(filePath, `${where} must be an array`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      fail(filePath, `${where}[${index}] must be a non-empty string`);
    }
    return entry;
  });
}
