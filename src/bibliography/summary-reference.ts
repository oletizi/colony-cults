/**
 * The bibliography REFERENCE to a source's thorough summary (spec 017, FR-007 /
 * SC-005). A by-path pointer -- the `census:`-style idiom -- carried on the
 * {@link Source} as `summaryRef`: an archive-relative path string pointing at
 * the source-level ROLLUP thorough summary (`source.summary.long.en.md`).
 *
 * The exhaustive prose is NEVER inlined into the structured SSOT; the record
 * holds ONLY the path, and the summary stays a regenerable, git-resident
 * markdown artifact (`object_store: null`). These helpers read/write that field
 * on the in-memory model (the canonical `serializeSource`/`loadSourceFile`
 * handle the byte-stable YAML), and validate that a present ref resolves to an
 * existing artifact on disk.
 *
 * DELIBERATELY SEPARATE from `@/bibliography/validate-companion-coverage`: that
 * validator reconciles B2-direct object-store keys (`archive/internet-archive/`,
 * `archive/museum/` prefixes) against companion sidecars. A `summaryRef` points
 * at git-resident markdown with NO object-store master, so reusing the
 * B2-key-prefix validator would flag it as an `undiscoverable-master`/
 * `orphaned-companion` false positive. This module does its own plain
 * file-existence check instead (`existsSync(join(archiveRoot, ref))`) and never
 * touches the object-store key machinery.
 */

import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import type { Source } from '@/model/source';

/**
 * Read a {@link Source}'s rollup summary reference. Returns the archive-relative
 * path string, or `undefined` when no rollup reference has been authored --
 * honest absence, never a fabricated default.
 */
export function readSummaryRef(source: Source): string | undefined {
  return source.summaryRef;
}

/**
 * Return a copy of `source` carrying `ref` as its `summaryRef` (immutable
 * update -- the input is not mutated). Fails loud on an empty/whitespace path
 * (a summaryRef must point somewhere) or an absolute path (the reference is
 * archive-relative, like the `census:` idiom, so it stays portable across
 * archive roots). Prose is never accepted here -- this is a path pointer only.
 */
export function writeSummaryRef(source: Source, ref: string): Source {
  const trimmed = ref.trim();
  if (trimmed.length === 0) {
    throw new Error(
      'writeSummaryRef: summaryRef must be a non-empty archive-relative path (the source ' +
        'rollup thorough summary), not blank',
    );
  }
  if (isAbsolute(trimmed)) {
    throw new Error(
      `writeSummaryRef: summaryRef must be an archive-relative path (portable across archive ` +
        `roots, mirroring the census: idiom), got absolute path "${trimmed}"`,
    );
  }
  return { ...source, summaryRef: trimmed };
}

/**
 * Light fail-loud validation that a source's `summaryRef` resolves to an
 * existing artifact under `archiveRoot` (spec 017 Decision 5 / SC-005 -- the
 * reference must be resolvable, no dangling pointers).
 *
 * - No `summaryRef` authored -> `undefined` (nothing to resolve; that is a
 *   legitimate absence, not an error -- the field is optional).
 * - Present and the artifact exists on disk -> the resolved absolute path.
 * - Present but the artifact is missing -> throws, naming the dangling ref and
 *   where it was expected.
 *
 * This is a plain path-existence check by design -- it does NOT reuse the
 * B2-key-prefix companion validator, so a git-resident markdown rollup
 * (`object_store: null`) never produces a companion-coverage false positive.
 */
export function validateSummaryRef(source: Source, archiveRoot: string): string | undefined {
  const ref = readSummaryRef(source);
  if (ref === undefined) {
    return undefined;
  }
  const resolved = join(archiveRoot, ref);
  if (!existsSync(resolved)) {
    throw new Error(
      `validateSummaryRef(${source.sourceId}): summaryRef "${ref}" does not resolve to an ` +
        `existing artifact under "${archiveRoot}" -- dangling reference (expected the source ` +
        `rollup thorough summary at ${resolved})`,
    );
  }
  return resolved;
}
