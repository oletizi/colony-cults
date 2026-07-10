/**
 * Integration-test fixture harness for corpus-browser tests.
 *
 * Provides access to the real PB-P001 archive clone and helpers to create
 * corrupted copies for testing error-handling paths. All fixtures operate on
 * the REAL archive — no fabricated corpus content, fail-loud on missing data.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
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

type Mutation = 'drop-translation' | 'drop-provenance-field' | 'skew-page-count';

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
 * @throws if hasFixture() is false (archive not available).
 * @returns `{ root, issueDir }` -- the archive root to hand to `loadCorpus`
 *   and the absolute path of the copied issue directory (for mutation).
 */
function buildArchiveRoot(): { root: string; issueDir: string } {
  if (!hasFixture()) {
    throw new Error(
      'Cannot build fixture archive: fixture is not available. ' +
      'Set CORPUS_ARCHIVE_PATH to a valid archive clone root.'
    );
  }

  const root = mkdtempSync(path.join(os.tmpdir(), 'corpus-browser-fixture-'));
  const issueDir = path.join(
    root,
    'archive',
    'cases',
    CASE,
    'newspapers',
    NEWSPAPER_SLUG,
    ISSUE_DIR_NAME
  );

  try {
    mkdirSync(issueDir, { recursive: true });
    cpSync(FIXTURE_ISSUE_DIR, issueDir, { recursive: true });
    return { root, issueDir };
  } catch (error) {
    if (existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
    }
    throw error;
  }
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
 * Mutations:
 *  - `drop-translation`: deletes `translation/p003.en.txt` to simulate a
 *    missing required translation layer (corpus-loader must detect and throw,
 *    naming the page).
 *  - `drop-provenance-field`: removes the `sha256:` line from the page's
 *    translation provenance sidecar (`translation/p003.fr.txt.yml`) -- the
 *    sidecar the loader assembles `ProvenanceRecord` from. (The previous
 *    mutation stripped `object_store:` from `f003.yml`, but the loader does
 *    not validate that field for the `source-iiif` provider, so it did not
 *    trigger a throw. See T009 note.)
 *  - `skew-page-count`: deletes `f003.jpg` to create an image/OCR-count
 *    mismatch (corpus-loader must detect and throw, naming the issue).
 *
 * @throws if hasFixture() is false (archive not available).
 * @returns absolute path to the temp archive root containing the corrupted copy.
 */
export function makeCorruptedCopy(mutation: Mutation): string {
  const { root, issueDir } = buildArchiveRoot();

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
        // Delete f003.jpg to create an image/OCR-count mismatch.
        const imageFile = path.join(issueDir, 'f003.jpg');
        if (existsSync(imageFile)) {
          rmSync(imageFile);
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
