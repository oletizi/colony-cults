import { posix } from 'node:path';

import type { SourceLayout } from '@/archive/derive-layout';
import type { ArchiveLayoutOverride } from '@/corpus/policies';
import { OVERRIDE_PATH_SHAPE, parseOverridePath } from '@/corpus/validate-overrides';
import type { Source } from '@/model/source';

/**
 * THE MISSING INVARIANT BETWEEN A RESOLVED ARCHIVE LAYOUT AND ON-DISK TRUTH
 * (AUDIT-32, spec 018-corpus-config-seam; Principle XV).
 *
 * THE DEFECT. `@/archive/layout-resolve` falls from "this Source has no
 * `archiveLayoutOverride`" straight through to the generic derivation, with no
 * throw anywhere; and `issueDir` -- the WRITE path -- has no existence guard.
 * So deleting (or forgetting) one override entry does not fail: it silently
 * DERIVES a different slug. Composing the real `port-breton` manifest with its
 * `archiveLayoutOverrides` stripped resolves `PB-P002` to
 * `books/colonie-libre-de-port-breton-nouvelle-france-en-oceanie` while the
 * committed masters live at `books/nouvelle-france-colonie-libre-port-breton`.
 * The next fetch would `mkdir` the parallel directory and write there --
 * bytes in the archive that the SSOT record does not reflect, which is exactly
 * the orphan-asset class Principle XV forbids.
 *
 * WHAT THE CHECK COMPARES, AND WHY NOT THE FILESYSTEM. The obvious invariant
 * -- "does the derived directory exist on disk?" -- is not available where it
 * is needed. `composeArchiveLayoutPolicy` runs with the corpora root and the
 * SSOT directory only; the ARCHIVE root is a per-session private worktree that
 * `resolveArchiveRoot` deliberately refuses to guess, and most commands never
 * set it. A composition-time check that needed it would either be skipped
 * (a fallback) or would fail commands that have no business touching the
 * archive. Worse, "the directory does not exist" is the NORMAL state of a
 * source that has simply not been fetched yet, so it cannot distinguish a
 * misplacement from ordinary emptiness without more evidence.
 *
 * So the invariant is anchored in the SSOT instead: the bibliography record
 * IS the authority on where a Source's bytes live (Principle XV -- "an object
 * you cannot find through the record is not acquired, it is lost"). A Source
 * that has been summarized carries `summaryRef`, an archive-relative path to
 * its rollup summary, which necessarily sits in the Source's own archive
 * directory. That path therefore NAMES the directory the Source actually
 * occupies, as recorded. The invariant is simply:
 *
 *     the layout the seam RESOLVES for a Source (its override if it has one,
 *     else its generic derivation) must name the SAME
 *     `cases/<case>/<type>/<slug>` directory that the Source's own record
 *     already points into.
 *
 * WHY IT CANNOT FIRE ON A CLEAN, NOT-YET-FETCHED SOURCE. A Source acquires a
 * `summaryRef` only when a summary has been WRITTEN under its real directory.
 * A Source that has never been fetched (or fetched but never summarized) has
 * no `summaryRef` at all, so there is nothing to disagree with and the check
 * is silent for it -- no filesystem probe, no guess. Against the committed
 * corpus today: 94 Sources, 46 carrying a `summaryRef`, and exactly 2
 * disagreements -- `PB-P002` and `PB-P003`, which are precisely the two the
 * manifest declares overrides for. With the overrides in place the invariant
 * is silent; strip them and it names both paths and throws.
 *
 * WHAT IT DOES NOT COVER, STATED PLAINLY: a Source whose masters are fetched
 * but which has never been summarized records no archive path anywhere in the
 * SSOT, so no cheap invariant can catch a misplacement for it. Closing that
 * gap means recording the acquired directory in the Source record at
 * acquisition time -- which is what Principle XV asks for anyway -- not
 * guessing from the filesystem here.
 */

/** The `cases/<case>/<type>/<slug>` directory a Source's own record points into. */
export interface RecordedPlacement {
  readonly caseId: string;
  readonly type: string;
  readonly slug: string;
  /** The record field the placement was read from, for error messages. */
  readonly ref: string;
}

/** Everything the invariant needs about one Source, resolved by the caller. */
export interface PlacementCheckInput {
  /** Every Source the policy was composed from. */
  readonly sources: readonly Source[];
  /** The composed manifest overrides, keyed by Source id (FR-017 step 1). */
  readonly overrides: ReadonlyMap<string, ArchiveLayoutOverride>;
  /** The composed generic derivations, keyed by Source id (FR-017 step 3). */
  readonly derived: ReadonlyMap<string, SourceLayout>;
}

/** Render a placement as the archive-relative directory it names. */
function directoryOf(placement: { caseId: string; type: string; slug: string }): string {
  return posix.join('archive', 'cases', placement.caseId, placement.type, placement.slug);
}

/**
 * The archive directory this Source's own SSOT record points into, or
 * `undefined` when the record names none (nothing acquired/summarized yet).
 *
 * Throws on a `summaryRef` that is present but does not sit under
 * `archive/cases/<case>/<type>/<slug>/`: a recorded archive path that names no
 * resolvable Source directory is a record defect, and silently ignoring it
 * would reintroduce the very blindness this module exists to remove.
 */
export function recordedPlacement(source: Source): RecordedPlacement | undefined {
  const ref = source.summaryRef;
  if (ref === undefined || ref.trim().length === 0) {
    return undefined;
  }
  // The ref names an ARTIFACT inside the Source's directory, so the directory
  // is everything above the final segment(s). Take the first five segments --
  // `archive/cases/<case>/<type>/<slug>` -- which is exactly the shape
  // `parseOverridePath` owns, so both halves of the comparison are parsed by
  // one function rather than two drifting copies.
  const segments = ref.replace(/\\/g, '/').split('/');
  const location =
    segments.length > 5 ? parseOverridePath(segments.slice(0, 5).join('/')) : null;
  if (location === null) {
    throw new Error(
      `archive-layout placement: Source ${JSON.stringify(source.sourceId)} records ` +
        `summaryRef ${JSON.stringify(ref)}, which does not sit inside a Source directory of ` +
        `the form "${OVERRIDE_PATH_SHAPE}/<artifact>" -- the record cannot say where this ` +
        "Source's bytes live, so its archive layout cannot be checked against them",
    );
  }
  return { caseId: location.caseId, type: location.type, slug: location.slug, ref };
}

/**
 * Fail loud when a composed policy would place a Source somewhere other than
 * where that Source's own record already says its bytes are.
 *
 * Runs over the FINAL composed maps, so it sees exactly what
 * {@link import('@/archive/layout-resolve').sourceLayout} would resolve at
 * steps 1 and 3. (Step 2, the runtime overlay, does not exist yet at
 * composition time; it is bounded separately by tying its lifetime to the
 * policy's -- see `installArchiveLayoutPolicy`.)
 */
export function assertRecordedPlacementsHonored(input: PlacementCheckInput): void {
  for (const source of input.sources) {
    const recorded = recordedPlacement(source);
    if (recorded === undefined) {
      continue;
    }

    const override = input.overrides.get(source.sourceId);
    if (override !== undefined) {
      const parsed = parseOverridePath(override.relativePath);
      if (parsed === null) {
        // Shape is owned by the config validator; re-reporting it here as a
        // placement failure would be a second, drift-prone voice. Let
        // `layoutFromOverride` raise the shape error at resolution time.
        continue;
      }
      assertAgrees(source.sourceId, parsed, recorded, 'the manifest archiveLayoutOverride');
      continue;
    }

    const derived = input.derived.get(source.sourceId);
    if (derived === undefined) {
      // No corpus claims this Source, so the policy places it nowhere and
      // there is nothing to disagree with.
      continue;
    }
    assertAgrees(
      source.sourceId,
      { caseId: derived.case, type: derived.type, slug: derived.slug },
      recorded,
      'the generic derivation (no archiveLayoutOverride is declared)',
    );
  }
}

/** Throw naming BOTH directories when the resolved placement is not the recorded one. */
function assertAgrees(
  sourceId: string,
  resolved: { caseId: string; type: string; slug: string },
  recorded: RecordedPlacement,
  origin: string,
): void {
  if (
    resolved.caseId === recorded.caseId &&
    resolved.type === recorded.type &&
    resolved.slug === recorded.slug
  ) {
    return;
  }
  throw new Error(
    `composeArchiveLayoutPolicy: Source ${JSON.stringify(sourceId)} would be placed at ` +
      `${JSON.stringify(directoryOf(resolved))} by ${origin}, but its own SSOT record already ` +
      `points into ${JSON.stringify(directoryOf(recorded))} (summaryRef ` +
      `${JSON.stringify(recorded.ref)}). Writing to the resolved path would create a parallel ` +
      'directory that the record does not reflect -- an orphan asset (Principle XV). Declare an ' +
      `archiveLayoutOverrides entry naming ${JSON.stringify(directoryOf(recorded))}, or correct ` +
      'the record if the Source really did move.',
  );
}
