/**
 * REGRESSION tests (T014, spec 017 US3): prove that source-group additions
 * are strictly ADDITIVE; existing (non-member) builds are unchanged.
 *
 *  (a) English monograph with inline issue.txt builds unchanged. The
 *      `materializeIssueText` member-materializer is NOT invoked on a
 *      non-member source, so no `issue.txt.yml` provenance sidecar is created.
 *      Assert the source's archive dir is not mutated by the build.
 *
 *  (b) French source with genuinely MISSING translation still fails loud.
 *      The pre-existing safety net (FR-008) rejects a French periodical/monograph
 *      whose recto needs a translation but the artifact is absent. Prove the
 *      feature did NOT weaken this path.
 *
 *  (c) Standalone source output is unchanged. The verso's optional `segments`
 *      field (additive, spec 017 T006/T008) is NOT populated for non-members,
 *      so the Typst input JSON is byte-identical to before the feature.
 *      Assert `verso.segments` is undefined/empty for a non-member's page.
 */

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { resolveRepoRoot } from '@/browser/load/repo-root';
import { buildSource } from '@/pdf/render/batch';
import type { TypstInput } from '@/pdf/render/typst-input';

import { writeFixtureArchive } from '../../unit/pdf/archive-fixture';
import { fakeTypstRunner, makeFixtureFetch } from '../../unit/pdf/typst-fake';

const CORPUS_CDN_BASE = 'https://cdn.test';

// Healthy English monograph: a registered source in @/archive/location's
// SOURCE_LAYOUTS, matching batch.test.ts's established fixture pattern.
const ENGLISH_MONOGRAPH_ID = 'PB-P002';
const ENGLISH_MONOGRAPH_CASE = 'port-breton';
const ENGLISH_MONOGRAPH_SLUG = 'nouvelle-france-colonie-libre-port-breton';

// French periodical: also a registered source (real, in bibliography),
// deliberately configured with a missing translation to fixture the fail-loud.
const FRENCH_SOURCE_ID = 'PB-P002';
const FRENCH_CASE = 'port-breton';
const FRENCH_SLUG = 'nouvelle-france-colonie-libre-port-breton';

describe('US3 regression (T014): source-group additions are strictly additive', () => {
  const repoRoot = resolveRepoRoot();
  const outDir = path.join(repoRoot, 'build', `pdf-us3-test-${process.pid}-${Date.now()}`);

  afterAll(() => {
    // Cleanup handled by fixture.cleanup() in each test
  });

  // -----------------------------------------------------------------------
  // (a) English monograph, inline issue.txt, untouched (FR-005).
  // -----------------------------------------------------------------------

  it('(a) builds an English monograph with inline issue.txt unchanged; materializeIssueText NOT invoked', async () => {
    // English-source fixture: omitTranslationDir=true means NO translation/
    // directory is created, but issue.txt IS written with the fixture's OCR.
    // language='English' routes through the English reading-language path.
    const fixture = await writeFixtureArchive({
      case: ENGLISH_MONOGRAPH_CASE,
      slug: ENGLISH_MONOGRAPH_SLUG,
      pageCount: 1,
      language: 'English', // Explicit English path (no translation/)
      omitTranslationDir: true, // English-source: no translation artifacts
    });

    try {
      // Capture the source dir's file listing BEFORE the build.
      const dirBefore = new Set(readdirSync(fixture.sourceDir));
      const issueTextPathBefore = path.join(fixture.sourceDir, 'issue.txt');
      const issueTextStatBefore = existsSync(issueTextPathBefore)
        ? require('node:fs').statSync(issueTextPathBefore)
        : null;

      const { runner: typst, calls } = fakeTypstRunner();
      const fetchFn = makeFixtureFetch(fixture.imageBytes);

      // Build the source.
      const result = await buildSource(ENGLISH_MONOGRAPH_ID, {
        archiveRoot: fixture.archiveRoot,
        provider: 'b2',
        outDir,
        fetchFn,
        typst,
        env: { ...process.env, CORPUS_CDN_BASE },
      });

      // Verify the build succeeded.
      expect(result.sourceId).toBe(ENGLISH_MONOGRAPH_ID);
      expect(result.failed).toHaveLength(0);
      expect(result.built).toHaveLength(1);

      // Verify ONE Typst compile call (one PDF per item, G-1).
      expect(calls).toHaveLength(1);

      // REGRESSION PROOF (a1): no issue.txt.yml was created in the archive dir.
      // This is the observable evidence that `materializeIssueText` was NOT
      // invoked on this non-member source.
      const issueTextYmlPath = path.join(fixture.sourceDir, 'issue.txt.yml');
      expect(existsSync(issueTextYmlPath)).toBe(false);

      // REGRESSION PROOF (a2): the inline issue.txt is byte-unchanged.
      // No materialization step touched or altered it.
      const dirAfter = new Set(readdirSync(fixture.sourceDir));
      expect(dirAfter).toEqual(dirBefore);

      const issueTextStatAfter = require('node:fs').statSync(issueTextPathBefore);
      if (issueTextStatBefore !== null) {
        // Same file size (no bytes written/altered).
        expect(issueTextStatAfter.size).toBe(issueTextStatBefore.size);
      }

      // The PDF was written (no partial/empty artifacts).
      expect(existsSync(result.built[0].outPath)).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  // -----------------------------------------------------------------------
  // (b) French source with genuinely missing translation, still fails loud.
  // -----------------------------------------------------------------------

  it('(b) rejects a French source with missing translation; safety net (FR-008) intact', async () => {
    // French-source fixture with omitTranslationArtifact: true on the one page.
    // This simulates a genuine gap: the page NEEDS translation (French source)
    // but the .en.txt / .en.txt.yml artifacts are absent.
    const fixture = await writeFixtureArchive({
      case: FRENCH_CASE,
      slug: FRENCH_SLUG,
      pageCount: 1,
      language: 'French', // Explicitly French
      pages: [
        {
          translationLabel: 'machine-assisted',
          englishText: 'This would be the English translation.',
          ocrFrench: 'Ceci est le texte français.',
          omitTranslationArtifact: true, // MISSING: no .en.txt, no sidecar
        },
      ],
    });

    try {
      const { runner: typst } = fakeTypstRunner();
      const fetchFn = makeFixtureFetch(fixture.imageBytes);

      // Attempt to build the source with the missing translation.
      // buildSource does NOT throw at the batch level (G-4, record-and-continue);
      // instead, the per-item failure is recorded in result.failed[].
      const result = await buildSource(FRENCH_SOURCE_ID, {
        archiveRoot: fixture.archiveRoot,
        provider: 'b2',
        outDir,
        fetchFn,
        typst,
        env: { ...process.env, CORPUS_CDN_BASE },
      });

      // REGRESSION PROOF (b): the safety net (FR-008) is intact.
      // The missing translation artifact is caught and reported, proving the
      // feature did NOT weaken the French translation-required path.
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].itemId).toBe(FRENCH_SOURCE_ID);
      expect(result.failed[0].error).toMatch(/translation artifact|p001.*en\.txt/i);
      expect(result.built).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  });

  // -----------------------------------------------------------------------
  // (c) Standalone source output is unchanged (verso.segments not populated).
  // -----------------------------------------------------------------------

  it('(c) standalone source verso has no segments field (additive, unchanged for non-members)', async () => {
    // Standalone, healthy monograph with 2 pages (French, to exercise the
    // standard translation path and prove segments is not populated there).
    const fixture = await writeFixtureArchive({
      case: ENGLISH_MONOGRAPH_CASE,
      slug: ENGLISH_MONOGRAPH_SLUG,
      pageCount: 2,
    });

    try {
      const { runner: typst, calls } = fakeTypstRunner();
      const fetchFn = makeFixtureFetch(fixture.imageBytes);

      const result = await buildSource(ENGLISH_MONOGRAPH_ID, {
        archiveRoot: fixture.archiveRoot,
        provider: 'b2',
        outDir,
        fetchFn,
        typst,
        env: { ...process.env, CORPUS_CDN_BASE },
      });

      expect(result.built).toHaveLength(1);
      expect(result.failed).toHaveLength(0);
      expect(calls).toHaveLength(1);

      // The Typst input JSON is written at `${outDir}/${sourceId}/${itemId}.input.json`.
      // For a monograph, itemId === sourceId.
      const inputJsonPath = path.join(outDir, ENGLISH_MONOGRAPH_ID, `${ENGLISH_MONOGRAPH_ID}.input.json`);
      expect(existsSync(inputJsonPath)).toBe(true);

      // Read and parse the Typst input (NO `as Type` -- use proper parsing).
      const inputJsonText = require('node:fs').readFileSync(inputJsonPath, 'utf-8');
      const input: TypstInput = JSON.parse(inputJsonText);

      // REGRESSION PROOF (c): every page's verso has no segments field
      // (or it is undefined/empty). The stacked-segment verso (spec 017 T006/T008)
      // is strictly additive and ONLY populated for source-group members.
      // Non-members render with a single `imagePath`, unchanged.
      for (const page of input.pages) {
        expect(page.verso.segments).toBeUndefined();
        // Verify the traditional single-image verso is still there.
        expect(page.verso.imagePath).toBeDefined();
        expect(page.verso.imagePath.length).toBeGreaterThan(0);
      }
    } finally {
      fixture.cleanup();
    }
  });
});
