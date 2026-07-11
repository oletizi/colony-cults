/**
 * Integration-test fixture harness for corpus-browser tests.
 *
 * Provides access to the real PB-P001 archive clone and helpers to create
 * corrupted copies for testing error-handling paths. All fixtures operate on
 * the REAL archive — no fabricated corpus content, fail-loud on missing data.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Archive-layout coordinates of the canonical PB-P001 fixture issue. The
 * loader resolves a source's newspapers directory as
 * `<archiveRoot>/archive/cases/<case>/newspapers/<slug>/<issueDir>/`, so a
 * copy that `loadCorpus` can be pointed at must reproduce that nesting (not a
 * bare issue directory).
 */
const CASE = 'port-breton';
const NEWSPAPER_SLUG = 'la-nouvelle-france';
const ISSUE_DIR_NAME = '1879-08-15_bpt6k56068358';

/**
 * A second, real, COMPLETE PB-P001 issue used by the not-collected/skip
 * fixtures. When the canonical issue is mutated into a skip, this sibling is
 * copied alongside it so the source still resolves at least one complete issue
 * (the loader's `deriveRights` requires the source to have some pages) -- which
 * exercises the real production shape: a mix of complete + skipped issues in
 * one source.
 */
export const SIBLING_ISSUE_ID = '1879-09-15_bpt6k5606840k';

/**
 * The archive clone root, derived from CORPUS_ARCHIVE_PATH.
 * null if the env var is not set (so tests can skip cleanly).
 */
export const ARCHIVE_ROOT: string | null = process.env.CORPUS_ARCHIVE_PATH ?? null;

/**
 * The fixture issue directory (PB-P001 canonical issue: 1879-08-15_bpt6k56068358).
 * Absolute path derived from ARCHIVE_ROOT.
 *
 * Throws if ARCHIVE_ROOT is null (the path cannot be derived).
 */
export const FIXTURE_ISSUE_DIR: string = (() => {
  if (!ARCHIVE_ROOT) {
    throw new Error(
      'Cannot derive FIXTURE_ISSUE_DIR: CORPUS_ARCHIVE_PATH is not set. ' +
      'Set CORPUS_ARCHIVE_PATH to the archive clone root to use fixtures.'
    );
  }
  return path.join(
    ARCHIVE_ROOT,
    'archive',
    'cases',
    'port-breton',
    'newspapers',
    'la-nouvelle-france',
    '1879-08-15_bpt6k56068358'
  );
})();

/**
 * Checks whether the fixture is available on disk.
 * Returns true iff ARCHIVE_ROOT is set AND FIXTURE_ISSUE_DIR exists.
 * Tests can use this to guard/skip cleanly when the archive is absent.
 */
export function hasFixture(): boolean {
  return ARCHIVE_ROOT !== null && existsSync(FIXTURE_ISSUE_DIR);
}

type Mutation =
  | 'drop-translation'
  | 'drop-provenance-field'
  | 'skew-page-count'
  | 'drop-issue-ocr'
  | 'drop-translation-dir';

/**
 * Builds a fresh, self-contained archive root in an OS temp dir that mirrors
 * the real archive layout for the single canonical PB-P001 fixture issue:
 *
 *   <root>/archive/cases/port-breton/newspapers/la-nouvelle-france/<issueDir>/
 *
 * The real fixture issue directory is copied verbatim into that nested path,
 * so `loadCorpus({ archivePath: root, sources: ['PB-P001'], ... })` resolves
 * the source's newspapers directory and enumerates exactly one issue.
 *
 * When `withSibling` is set, a second real COMPLETE issue
 * ({@link SIBLING_ISSUE_ID}) is copied alongside the canonical one, so that a
 * mutation which SKIPS the canonical issue still leaves the source with a
 * loadable issue (required by the not-collected/skip fixtures).
 *
 * @throws if hasFixture() is false (archive not available).
 * @returns `{ root, issueDir }` -- the archive root to hand to `loadCorpus`
 *   and the absolute path of the copied CANONICAL issue directory (for mutation).
 */
function buildArchiveRoot(withSibling = false): { root: string; issueDir: string } {
  if (!hasFixture()) {
    throw new Error(
      'Cannot build fixture archive: fixture is not available. ' +
      'Set CORPUS_ARCHIVE_PATH to a valid archive clone root.'
    );
  }

  const root = mkdtempSync(path.join(os.tmpdir(), 'corpus-browser-fixture-'));
  const newspapersDir = path.join(root, 'archive', 'cases', CASE, 'newspapers', NEWSPAPER_SLUG);
  const issueDir = path.join(newspapersDir, ISSUE_DIR_NAME);

  try {
    mkdirSync(issueDir, { recursive: true });
    cpSync(FIXTURE_ISSUE_DIR, issueDir, { recursive: true });

    if (withSibling) {
      const siblingSrc = sourceIssueDir(SIBLING_ISSUE_ID);
      if (!existsSync(siblingSrc)) {
        throw new Error(
          `Cannot build sibling fixture: complete sibling issue not found at ${siblingSrc}.`
        );
      }
      const siblingDest = path.join(newspapersDir, SIBLING_ISSUE_ID);
      mkdirSync(siblingDest, { recursive: true });
      cpSync(siblingSrc, siblingDest, { recursive: true });
    }

    return { root, issueDir };
  } catch (error) {
    if (existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
    }
    throw error;
  }
}

/** Absolute path to a real source issue directory in the archive clone. */
function sourceIssueDir(issueName: string): string {
  if (!ARCHIVE_ROOT) {
    throw new Error('sourceIssueDir: CORPUS_ARCHIVE_PATH is not set.');
  }
  return path.join(ARCHIVE_ROOT, 'archive', 'cases', CASE, 'newspapers', NEWSPAPER_SLUG, issueName);
}

/**
 * Builds a clean (unmutated) single-issue archive root for the happy-path
 * test. The returned path is a valid `loadCorpus` `archivePath`.
 *
 * @throws if hasFixture() is false (archive not available).
 * @returns absolute path to the temp archive root.
 */
export function makeCleanArchive(): string {
  return buildArchiveRoot().root;
}

/**
 * Builds a single-issue archive root (see {@link makeCleanArchive}) and then
 * applies the specified mutation to the copied issue, returning the archive
 * root so `loadCorpus` can be pointed at the corrupted copy.
 *
 * COLLECTED-BUT-CORRUPT mutations (a PRESENT layer made internally
 * inconsistent -- the loader must THROW, naming source / issue / page):
 *  - `drop-translation`: deletes `translation/p003.en.txt` to simulate a
 *    single missing required translation (the `translation/` layer is still
 *    present, so this is corrupt, not un-collected -- throw naming the page).
 *  - `drop-provenance-field`: removes the `sha256:` line from the page's
 *    translation provenance sidecar (`translation/p003.fr.txt.yml`) -- the
 *    sidecar the loader assembles `ProvenanceRecord` from. (The previous
 *    mutation stripped `object_store:` from `f003.yml`, but the loader does
 *    not validate that field for the `source-iiif` provider, so it did not
 *    trigger a throw. See T009 note.)
 *  - `skew-page-count`: deletes `f003.yml` to create a folio/OCR-count
 *    mismatch while images remain present (corrupt -- throw naming the issue).
 *
 * NOT-COLLECTED / incomplete mutations (a WHOLE required layer entirely
 * absent -- the loader must SKIP and REPORT the issue, never throw):
 *  - `drop-issue-ocr`: deletes `issue.txt` entirely (the OCR layer was never
 *    collected -- the issue is skipped).
 *  - `drop-translation-dir`: deletes the whole `translation/` directory (the
 *    English translation layer was never collected -- the issue is skipped).
 *
 * @throws if hasFixture() is false (archive not available).
 * @returns absolute path to the temp archive root containing the mutated copy.
 */
export function makeCorruptedCopy(mutation: Mutation): string {
  // The not-collected/skip mutations need a complete sibling issue so the
  // source still resolves after the canonical issue is skipped.
  const withSibling = mutation === 'drop-issue-ocr' || mutation === 'drop-translation-dir';
  const { root, issueDir } = buildArchiveRoot(withSibling);

  try {
    switch (mutation) {
      case 'drop-translation': {
        // Delete p003.en.txt to simulate a missing required translation.
        const translationFile = path.join(issueDir, 'translation', 'p003.en.txt');
        if (existsSync(translationFile)) {
          rmSync(translationFile);
        }
        break;
      }

      case 'drop-provenance-field': {
        // Remove the `sha256:` line from the translation provenance sidecar
        // the loader validates.
        const sidecar = path.join(issueDir, 'translation', 'p003.fr.txt.yml');
        if (existsSync(sidecar)) {
          const content = readFileSync(sidecar, 'utf-8');
          writeFileSync(sidecar, content.replace(/^sha256:.*\r?\n/m, ''), 'utf-8');
        }
        break;
      }

      case 'skew-page-count': {
        // Delete f003.yml (the image sidecar folios are enumerated from) to
        // create a folio/OCR-count mismatch.
        const sidecarFile = path.join(issueDir, 'f003.yml');
        if (existsSync(sidecarFile)) {
          rmSync(sidecarFile);
        }
        break;
      }

      case 'drop-issue-ocr': {
        // Delete issue.txt entirely: the whole OCR layer is absent, so the
        // issue is NOT-COLLECTED (skip + report), not corrupt.
        const issueTxt = path.join(issueDir, 'issue.txt');
        if (existsSync(issueTxt)) {
          rmSync(issueTxt);
        }
        break;
      }

      case 'drop-translation-dir': {
        // Delete the whole translation/ directory: the English translation
        // layer is entirely absent, so the issue is NOT-COLLECTED (skip +
        // report), not corrupt.
        const translationDir = path.join(issueDir, 'translation');
        if (existsSync(translationDir)) {
          rmSync(translationDir, { recursive: true, force: true });
        }
        break;
      }

      default: {
        const _exhaustive: never = mutation;
        throw new Error(`Unknown mutation: ${_exhaustive}`);
      }
    }

    return root;
  } catch (error) {
    if (existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
    }
    throw error;
  }
}

/**
 * Removes a temp copy directory created by makeCorruptedCopy.
 * Safe to call repeatedly; no-op if the directory doesn't exist.
 *
 * @param dir absolute path to the temp directory to clean up.
 */
export function cleanupCopy(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}
