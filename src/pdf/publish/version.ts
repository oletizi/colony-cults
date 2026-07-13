/**
 * The publication version token (spec 008-edition-publishing, T009,
 * research.md Decision 3): derive `snapshotShort` -- the git-conventional
 * short form of the pinned archive commit -- from the full ref recorded in
 * the pin sidecar (`site/data/archive-source.json` `.ref`). This is the
 * version token embedded in a published edition's key
 * (`editions/<variant>/<sourceId>/<issueId>__<snapshotShort>.pdf`) and the
 * `snapshotShort` field on a `Publication` record (data-model.md
 * § Publication).
 *
 * Fail-loud (Constitution V): a publication is not reproducible without a
 * valid pin, so an empty or malformed ref throws rather than falling back to
 * an unpinned/"latest" token.
 */

import type { ArchivePinReader } from '@/pdf/load/edition';
import { makeArchivePinReader } from '@/pdf/load/edition';
import { resolvePdfConfig } from '@/pdf/config';

/** Length (in hex chars) of the git-conventional short commit form. */
const SHORT_LENGTH = 8;

/** A full git commit ref is exactly 40 lowercase/uppercase hex chars (SHA-1). */
const FULL_REF_PATTERN = /^[0-9a-fA-F]{40}$/;

/**
 * Resolved snapshot version: the full pinned archive ref plus its
 * git-conventional short form (data-model.md § Publication: `snapshot` /
 * `snapshotShort`).
 */
export interface SnapshotVersion {
  /** The full pinned archive-commit ref (`site/data/archive-source.json` `.ref`). */
  full: string;
  /** The short form embedded in the versioned key (first 8 hex chars of `full`). */
  short: string;
}

/**
 * Derive the git-conventional short form of a full archive-commit ref (the
 * first 8 hex chars, e.g. `3b8b1fd6a0d7f76f3c5f9a2b3da94252bbb5dd10` ->
 * `3b8b1fd6`; matches the design's `<issueId>__3b8b1fd6.pdf` example).
 *
 * @param fullRef the full pinned archive-commit ref
 * @throws Error if `fullRef` is empty/whitespace-only or is not a valid
 *   40-char hex commit ref -- a publication is not reproducible without a
 *   real pin (Constitution V).
 */
export function snapshotShort(fullRef: string): string {
  const trimmed = fullRef.trim();
  if (trimmed.length === 0) {
    throw new Error(
      'snapshotShort: fullRef is empty -- the pinned archive-commit ref is required to derive ' +
        'the publication version token; there is no fallback to an unpinned/"latest" build ' +
        '(Constitution V).',
    );
  }

  if (!FULL_REF_PATTERN.test(trimmed)) {
    throw new Error(
      `snapshotShort: ${JSON.stringify(trimmed)} is not a valid hex commit ref -- expected a ` +
        '40-char hex string (a git SHA-1 commit hash, as recorded in ' +
        'site/data/archive-source.json\'s "ref" field).',
    );
  }

  return trimmed.slice(0, SHORT_LENGTH).toLowerCase();
}

/**
 * Concrete default pin reader: `makeArchivePinReader` over the currently
 * configured pin file (`resolvePdfConfig().pinFile`). Built lazily so
 * importing this module never touches the filesystem or env.
 */
function defaultReader(): ArchivePinReader {
  return makeArchivePinReader(resolvePdfConfig().pinFile);
}

/**
 * Resolve the current publication version -- the full pinned archive ref and
 * its short form -- from the pin sidecar, via an injected {@link
 * ArchivePinReader} (composition over an injected reader; no ambient
 * globals, Constitution VI). Defaults to `makeArchivePinReader` over the
 * configured pin file when no reader is injected.
 *
 * Reuses `resolveArchiveRef` / `makeArchivePinReader` (via the injected
 * reader) rather than re-reading the pin file with a bespoke parser.
 *
 * @param reader injected pin reader (defaults to the configured pin file's reader)
 * @throws Error if the pin file is missing/unparseable/lacks a ref (from the
 *   reader), or if the resolved ref is not a valid hex commit (from {@link snapshotShort}).
 */
export function resolveSnapshot(reader: ArchivePinReader = defaultReader()): SnapshotVersion {
  const full = reader.read();
  return { full, short: snapshotShort(full) };
}
