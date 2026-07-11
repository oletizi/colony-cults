/**
 * Integration test: MONOGRAPH corpus normalization (`loadCorpus`).
 *
 * A monograph is a source whose single unit is a BOOK directory under
 * `books/<slug>/` (vs a periodical's many issue directories under
 * `newspapers/<slug>/`). Its on-disk layout is identical to a single
 * periodical issue, so it loads as ONE {@link IssueView} with N pages.
 *
 * These tests build a SYNTHETIC book directory under a temp archive root
 * (no fabricated real-corpus text -- just the minimal structural shape the
 * loader requires) and point `loadCorpus` at it, reusing the REAL PB-P002
 * SSOT (`bibliography/sources/PB-P002.yml`, `kind: monograph`) so the
 * source->unit branch and the folio-sidecar id match are exercised
 * end-to-end. The book directory is resolved by SCANNING `books/` and
 * matching a folio sidecar's `id` to the source id, so the fail-loud test
 * plants a book whose sidecar id does NOT match and asserts the loader throws
 * naming the source.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { describe, it, expect } from 'vitest';

import type { LoadConfig } from '@/browser/config';
import { loadCorpus } from '@/browser/load/corpus';

const CASE = 'port-breton';
const SOURCE_ID = 'PB-P002';
const BOOK_SLUG = 'synthetic-monograph-unit';
const CATALOG_URL = 'https://gallica.bnf.fr/ark:/12148/synth12345';
const EXPECTED_ARK = 'ark:/12148/synth12345';
const SHA256 = 'a'.repeat(64);

/** A folio image sidecar (`fNNN.yml`) carrying the id the scan matches on. */
function folioSidecarYaml(id: string): string {
  return [
    `id: "${id}"`,
    'type: "page-image"',
    `case: "${CASE}"`,
    'source_archive: "Gallica / BnF"',
    `catalog_url: "${CATALOG_URL}"`,
    'rights_status: "public-domain"',
    'retrieved: "2026-07-09T06:08:07.842Z"',
    `sha256: "${SHA256}"`,
    'object_store: null',
    '',
  ].join('\n');
}

/** A translation provenance sidecar (`pNNN.fr.txt.yml`). */
function translationSidecarYaml(id: string): string {
  return [
    `id: "${id}"`,
    'type: "english-translation"',
    `case: "${CASE}"`,
    'source_archive: "Gallica / BnF"',
    `catalog_url: "${CATALOG_URL}"`,
    'rights_status: "public-domain"',
    `sha256: "${SHA256}"`,
    '',
  ].join('\n');
}

/**
 * Writes a synthetic book directory (the monograph unit) with `pageCount`
 * pages under `<root>/archive/cases/port-breton/books/<slug>/`, whose folio
 * sidecars carry `sidecarId`. Returns the temp archive root.
 */
function buildMonographArchive(sidecarId: string, pageCount: number): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'corpus-browser-monograph-'));
  const bookDir = path.join(root, 'archive', 'cases', CASE, 'books', BOOK_SLUG);
  const translationDir = path.join(bookDir, 'translation');
  mkdirSync(translationDir, { recursive: true });

  const ocrSegments: string[] = [];
  for (let n = 1; n <= pageCount; n += 1) {
    const p = `p${String(n).padStart(3, '0')}`;
    const f = `f${String(n).padStart(3, '0')}`;
    ocrSegments.push(`French OCR for page ${n}.`);
    writeFileSync(path.join(bookDir, `${f}.yml`), folioSidecarYaml(sidecarId), 'utf-8');
    writeFileSync(path.join(translationDir, `${p}.en.txt`), `English translation ${n}.`, 'utf-8');
    writeFileSync(path.join(translationDir, `${p}.fr.txt`), `Corrected French ${n}.`, 'utf-8');
    writeFileSync(
      path.join(translationDir, `${p}.fr.txt.yml`),
      translationSidecarYaml(sidecarId),
      'utf-8'
    );
  }
  // Trailing form-feed -> the delimiter artifact splitIssueOcr drops.
  writeFileSync(path.join(bookDir, 'issue.txt'), `${ocrSegments.join('\f')}\f`, 'utf-8');

  return root;
}

function configFor(archivePath: string): LoadConfig {
  return {
    archivePath,
    snapshotDir: 'site/data',
    sources: [SOURCE_ID],
    provider: { kind: 'source-iiif' },
  };
}

describe('loadCorpus (integration, monograph)', () => {
  it('loads a monograph as ONE source / ONE issue with N pages', () => {
    const pageCount = 3;
    const archive = buildMonographArchive(SOURCE_ID, pageCount);
    try {
      const { corpus, skipped } = loadCorpus(configFor(archive));

      expect(skipped).toEqual([]);
      expect(corpus.sources).toHaveLength(1);

      const source = corpus.sources[0];
      expect(source.sourceId).toBe(SOURCE_ID);
      expect(source.kind).toBe('monograph');
      expect(source.ark).toBe(EXPECTED_ARK);
      expect(source.rights).toBe('public-domain');

      // Exactly ONE issue (the book), whose issueId is the book dir basename.
      expect(source.issues).toHaveLength(1);
      const issue = source.issues[0];
      expect(issue.issueId).toBe(BOOK_SLUG);
      expect(issue.sequence).toBe(1);
      expect(issue.pageCount).toBe(pageCount);
      expect(issue.pages).toHaveLength(pageCount);
      // Date derives from the real PB-P002 SSOT notes ("Years: 1879").
      expect(issue.date).toBe('1879');

      const first = issue.pages[0];
      expect(first.pageId).toBe('p001');
      expect(first.folioId).toBe('f001');
      expect(first.ocrFrench).toContain('page 1');
      expect(first.english).toContain('English translation 1');
      expect(first.image.kind).toBe('iiif');
      expect(first.image.url).toContain(EXPECTED_ARK);
      expect(first.provenance.ark).toBe(EXPECTED_ARK);
      expect(first.provenance.sourceId).toBe(SOURCE_ID);
    } finally {
      rmSync(archive, { recursive: true, force: true });
    }
  });

  it('throws naming the source when no book dir sidecar id matches', () => {
    // The only book present carries a DIFFERENT sidecar id, so the scan finds
    // no match for PB-P002 and must fail loud (naming the source).
    const archive = buildMonographArchive('PB-P999', 2);
    try {
      expect(() => loadCorpus(configFor(archive))).toThrow(/PB-P002/);
    } finally {
      rmSync(archive, { recursive: true, force: true });
    }
  });

  it('throws naming the source when there is no books directory at all', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'corpus-browser-monograph-empty-'));
    // Create the case dir but NO books/ subdirectory.
    mkdirSync(path.join(root, 'archive', 'cases', CASE), { recursive: true });
    try {
      expect(() => loadCorpus(configFor(root))).toThrow(/PB-P002/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
