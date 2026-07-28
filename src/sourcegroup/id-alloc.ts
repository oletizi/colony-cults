/**
 * Atomic allocation of the next-free member id in a corpus's allocatable
 * source-id namespace (e.g. Port Breton's `PB-P###`).
 *
 * The bibliography SSOT stores one file per source at
 * `bibliography/sources/<sourceId>.yml`. New source-group members are
 * assigned the next-free id in the corpus's allocatable namespace. The hazard
 * this module removes: two concurrent inventory calls both scanning the
 * current max and both picking the same id (spec FR-001; research D-06).
 *
 * There is NO mutable counter file. Allocation is made safe under concurrency
 * by the filesystem itself: the target file is created with an EXCLUSIVE-create
 * (`wx`) flag, so exactly one racer can claim any given id — the winner's
 * `writeFile` succeeds, every loser gets `EEXIST`, rescans, and retries with a
 * fresh candidate. The exclusive create IS the atomic claim.
 *
 * CORPUS CONFIG SEAM (T012, specs/018-corpus-config-seam FR-004/FR-002b/
 * FR-010): this module names NO corpus-specific prefix/pad-width itself.
 * Every entry point takes an injected `SourceIdPolicy` — derived at the
 * composition root by `@/corpus/policies`' `deriveSourceIdPolicy`, which
 * picks a corpus's ONE `allocatable: true` `sourceIds` entry. For Port
 * Breton that is `{ prefix: 'PB-P', padWidth: 3 }` — never the non-
 * allocatable `PB-S` policy that exists purely for the 2 hand-authored
 * `PB-S001`/`PB-S002` secondary works. Because the injected policy is
 * singular and always the allocatable one, this module structurally cannot
 * see or count the `PB-S` namespace: it only ever recognizes filenames
 * matching the injected prefix.
 *
 * @see src/model for the canonical Source structure
 * @see src/corpus/policies.ts for `SourceIdPolicy` and its derivation
 */

import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { escapeRegExp } from '@/corpus/escape-regexp';
import type { SourceIdPolicy } from '@/corpus/policies';

/** Default bound on EEXIST retries before failing loud. */
const DEFAULT_MAX_RETRIES = 50;

/**
 * The file body for a freshly allocated member. Either a fixed string, or a
 * callback that receives the candidate id so the record can embed its own id.
 * A callback may be invoked more than once (once per contended attempt); it
 * MUST be a pure function of the candidate id.
 */
export type MemberContent = string | ((allocatedId: string) => string | Promise<string>);

/**
 * Build the filename-matching regex for a `SourceIdPolicy`'s prefix: matches
 * `<prefix><digits>.yml` and captures the numeric suffix. Built fresh from
 * the injected prefix on every call (allocation is not a hot path) rather
 * than cached, keeping this module free of any prefix-keyed module state.
 */
function memberFileRegex(policy: SourceIdPolicy): RegExp {
  return new RegExp(`^${escapeRegExp(policy.prefix)}(\\d+)\\.yml$`);
}

/**
 * Narrow an unknown thrown value to "is this an EEXIST filesystem error".
 * No `as` / `any`: `'code' in err` narrows `err` to include a `code` property.
 */
function isEexist(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === 'EEXIST'
  );
}

/** Format a numeric suffix as a zero-padded member id (`7` -> `PB-P007`). */
function formatMemberId(policy: SourceIdPolicy, n: number): string {
  return `${policy.prefix}${String(n).padStart(policy.padWidth, '0')}`;
}

/**
 * Scan `sourcesDir` for the highest numeric suffix currently used in
 * `policy`'s namespace, and return the next candidate id (max + 1, or the
 * pad-width-1 id when the namespace is empty). This is a point-in-time read;
 * the exclusive create is what makes the subsequent claim safe.
 *
 * Only filenames matching `policy.prefix` are considered — a differently-
 * prefixed namespace in the same directory (e.g. Port Breton's non-
 * allocatable `PB-S###`) is invisible to this scan by construction, because
 * `memberFileRegex` is built from `policy.prefix` alone.
 */
async function nextCandidate(sourcesDir: string, policy: SourceIdPolicy): Promise<string> {
  const pattern = memberFileRegex(policy);
  const entries = await readdir(sourcesDir);
  let max = 0;
  for (const entry of entries) {
    const match = pattern.exec(entry);
    if (match === null) {
      continue;
    }
    const suffix = Number.parseInt(match[1], 10);
    if (Number.isFinite(suffix) && suffix > max) {
      max = suffix;
    }
  }
  return formatMemberId(policy, max + 1);
}

/**
 * Allocate the next-free member id in `sourcesDir` under `policy`'s
 * namespace, and atomically claim it by creating `<id>.yml` with the given
 * content.
 *
 * Atomicity: the target file is created with the `wx` (exclusive-create) flag.
 * If a concurrent allocation already claimed that id, `writeFile` throws
 * `EEXIST`; this function rescans for a fresh candidate and retries, up to
 * `maxRetries` times. On exhaustion it throws (fail loud) — it never returns an
 * unclaimed or duplicate id.
 *
 * @param sourcesDir directory holding the one-file-per-source SSOT
 * @param policy     the injected, singular allocatable `SourceIdPolicy` (FR-004/FR-002b)
 * @param content    body for the new member file (string or id -> body callback)
 * @param maxRetries EEXIST-retry bound before failing loud
 * @returns the allocated member id (e.g. `PB-P007`)
 */
export async function allocateMemberId(
  sourcesDir: string,
  policy: SourceIdPolicy,
  content: MemberContent,
  maxRetries: number = DEFAULT_MAX_RETRIES,
): Promise<string> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const candidate = await nextCandidate(sourcesDir, policy);
    const body = typeof content === 'function' ? await content(candidate) : content;
    const target = join(sourcesDir, `${candidate}.yml`);
    try {
      // Exclusive create: this is the atomic claim. Only one racer wins any id.
      await writeFile(target, body, { flag: 'wx' });
      return candidate;
    } catch (err: unknown) {
      if (isEexist(err)) {
        // Someone else claimed this id first; rescan and try the next one.
        continue;
      }
      throw err;
    }
  }

  throw new Error(
    `allocateMemberId: exhausted ${maxRetries} retries claiming a free ${policy.prefix}### id in ${sourcesDir}; ` +
      `every candidate was taken concurrently. Increase maxRetries or investigate contention.`,
  );
}
