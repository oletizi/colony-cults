/**
 * Integration-test fixture harness for corpus-browser tests.
 *
 * Provides access to the real PB-P001 archive clone and helpers to create
 * corrupted copies for testing error-handling paths. All fixtures operate on
 * the REAL archive — no fabricated corpus content, fail-loud on missing data.
 */

import { cpSync, existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

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
 * Copies the real fixture issue dir into a fresh OS temp dir, applies the
 * specified mutation to the copy, and returns the temp dir path.
 *
 * Mutations:
 *  - `drop-translation`: deletes `translation/p003.en.txt` to simulate a
 *    missing translation file (corpus-loader must detect and throw).
 *  - `drop-provenance-field`: removes the `object_store:` field from `f003.yml`
 *    to simulate incomplete provenance metadata.
 *  - `skew-page-count`: deletes `f003.jpg` to create an image/page-count
 *    mismatch (corpus-loader must detect and throw).
 *
 * @throws if hasFixture() is false (archive not available).
 * @returns absolute path to the temp directory containing the corrupted copy.
 */
export function makeCorruptedCopy(mutation: Mutation): string {
  if (!hasFixture()) {
    throw new Error(
      'Cannot create corrupted copy: fixture is not available. ' +
      'Set CORPUS_ARCHIVE_PATH to a valid archive clone root.'
    );
  }

  const tempBase = path.join(os.tmpdir(), 'corpus-browser-fixture-');
  const tempDir = mkdtempSync(tempBase);

  try {
    // Copy the entire fixture issue dir into temp.
    cpSync(FIXTURE_ISSUE_DIR, tempDir, { recursive: true });

    // Apply the requested mutation.
    switch (mutation) {
      case 'drop-translation': {
        // Delete p003.en.txt to simulate missing translation.
        const translationFile = path.join(tempDir, 'translation', 'p003.en.txt');
        if (existsSync(translationFile)) {
          rmSync(translationFile);
        }
        break;
      }

      case 'drop-provenance-field': {
        // Remove the `object_store:` field from f003.yml.
        const provenanceFile = path.join(tempDir, 'f003.yml');
        if (existsSync(provenanceFile)) {
          let content = readFileSync(provenanceFile, 'utf-8');
          // Remove the object_store block (starts with 'object_store:' and
          // ends at the next field or EOF). Handle both null and multi-line values.
          content = content.replace(/^object_store:.*?(?=^\w+:|$)/ms, '');
          writeFileSync(provenanceFile, content, 'utf-8');
        }
        break;
      }

      case 'skew-page-count': {
        // Delete f003.jpg to create image/page-count mismatch.
        const imageFile = path.join(tempDir, 'f003.jpg');
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

    return tempDir;
  } catch (error) {
    // Clean up on error.
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
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
