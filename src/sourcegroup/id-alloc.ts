/**
 * Atomic allocation of the next-free member id in the `PB-P###` namespace.
 *
 * The bibliography SSOT stores one file per source at
 * `bibliography/sources/<sourceId>.yml`. New source-group members are assigned
 * the next-free `PB-P###` id. The hazard this module removes: two concurrent
 * inventory calls both scanning the current max and both picking the same id
 * (spec FR-001; research D-06).
 *
 * There is NO mutable counter file. Allocation is made safe under concurrency
 * by the filesystem itself: the target file is created with an EXCLUSIVE-create
 * (`wx`) flag, so exactly one racer can claim any given id — the winner's
 * `writeFile` succeeds, every loser gets `EEXIST`, rescans, and retries with a
 * fresh candidate. The exclusive create IS the atomic claim.
 *
 * @see src/model for the canonical Source structure
 */

import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The member namespace prefix. Members are `PB-P###`. */
const MEMBER_PREFIX = 'PB-P';

/** Zero-padding width for the numeric suffix (`PB-P007`). */
const PAD_WIDTH = 3;

/** Default bound on EEXIST retries before failing loud. */
const DEFAULT_MAX_RETRIES = 50;

/**
 * The file body for a freshly allocated member. Either a fixed string, or a
 * callback that receives the candidate id so the record can embed its own id.
 * A callback may be invoked more than once (once per contended attempt); it
 * MUST be a pure function of the candidate id.
 */
export type MemberContent = string | ((allocatedId: string) => string | Promise<string>);

/** Matches `PB-P<digits>.yml` and captures the numeric suffix. */
const MEMBER_FILE_RE = /^PB-P(\d+)\.yml$/;

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
function formatMemberId(n: number): string {
  return `${MEMBER_PREFIX}${String(n).padStart(PAD_WIDTH, '0')}`;
}

/**
 * Scan `sourcesDir` for the highest numeric suffix currently used in the
 * `PB-P###` namespace, and return the next candidate id (max + 1, or
 * `PB-P001` when the namespace is empty). This is a point-in-time read; the
 * exclusive create is what makes the subsequent claim safe.
 */
async function nextCandidate(sourcesDir: string): Promise<string> {
  const entries = await readdir(sourcesDir);
  let max = 0;
  for (const entry of entries) {
    const match = MEMBER_FILE_RE.exec(entry);
    if (match === null) {
      continue;
    }
    const suffix = Number.parseInt(match[1], 10);
    if (Number.isFinite(suffix) && suffix > max) {
      max = suffix;
    }
  }
  return formatMemberId(max + 1);
}

/**
 * Allocate the next-free `PB-P###` member id in `sourcesDir` and atomically
 * claim it by creating `<id>.yml` with the given content.
 *
 * Atomicity: the target file is created with the `wx` (exclusive-create) flag.
 * If a concurrent allocation already claimed that id, `writeFile` throws
 * `EEXIST`; this function rescans for a fresh candidate and retries, up to
 * `maxRetries` times. On exhaustion it throws (fail loud) — it never returns an
 * unclaimed or duplicate id.
 *
 * @param sourcesDir directory holding the one-file-per-source SSOT
 * @param content    body for the new member file (string or id -> body callback)
 * @param maxRetries EEXIST-retry bound before failing loud
 * @returns the allocated member id (e.g. `PB-P007`)
 */
export async function allocateMemberId(
  sourcesDir: string,
  content: MemberContent,
  maxRetries: number = DEFAULT_MAX_RETRIES,
): Promise<string> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const candidate = await nextCandidate(sourcesDir);
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
    `allocateMemberId: exhausted ${maxRetries} retries claiming a free ${MEMBER_PREFIX}### id in ${sourcesDir}; ` +
      `every candidate was taken concurrently. Increase maxRetries or investigate contention.`,
  );
}
