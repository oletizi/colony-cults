import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { translateIssue } from '@/translate/issue';
import { writeProvenance, type ProvenanceFields } from '@/archive/provenance';
import { buildCtx, TEST_MODEL } from './support/translate-archive';

/**
 * Integration coverage for translating a MONOGRAPH source (PB-P002): unlike a
 * periodical, a monograph's pages live in one FLAT slug directory (no dated
 * `_ark` child), so `translateIssue` must resolve the document dir via
 * `resolveFetchedDir` (monograph -> `monographDir`) rather than `findIssueDir`.
 * Driven with the shared fake engine against a temp archive; no real engine.
 */

// PB-P002 is registered as a monograph: port-breton / books /
// nouvelle-france-colonie-libre-port-breton (src/archive/location.ts).
const MONO_SOURCE_ID = 'PB-P002';
const MONO_ARK = 'bpt6k58039518';
const MONO_SUBPATH =
  'archive/cases/port-breton/books/nouvelle-france-colonie-libre-port-breton';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) {
    rmSync(r, { recursive: true, force: true });
  }
});

function pageProvenance(): ProvenanceFields {
  return {
    id: MONO_SOURCE_ID,
    title: 'Nouvelle-France: Colonie libre de Port-Breton',
    type: 'page-image',
    case: 'port-breton',
    language: 'French',
    source_archive: 'Gallica / BnF',
    catalog_url: `https://gallica.bnf.fr/ark:/12148/${MONO_ARK}`,
    original_url: '',
    rights_status: 'public-domain',
    retrieved: '2026-07-10T00:00:00.000Z',
    local_path: `${MONO_SUBPATH}/f001.jpg`,
    sha256: 'deadbeef',
    size: 0,
    format: 'image/jpeg',
    ocr_status: 'searchable',
    object_store: null,
    rights_raw: '<results/>',
    notes: null,
  };
}

/** Build a fetched-and-OCR'd MONOGRAPH (flat dir, 3 pages) under a tmp archive. */
async function buildMonograph(): Promise<{ archiveRoot: string; dir: string }> {
  const archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-mono-'));
  roots.push(archiveRoot);
  const dir = path.join(archiveRoot, MONO_SUBPATH);
  mkdirSync(dir, { recursive: true });

  for (let n = 1; n <= 3; n += 1) {
    const stem = `f${String(n).padStart(3, '0')}`;
    writeFileSync(path.join(dir, `${stem}.jpg`), `FAKE-PAGE-${n}`);
    await writeProvenance(path.join(dir, `${stem}.yml`), pageProvenance());
  }

  const page = (n: number) =>
    `Page ${n} du livre avec assez de texte francais reel pour depasser le seuil de page blanche.`;
  writeFileSync(
    path.join(dir, 'issue.txt'),
    [page(1), page(2), page(3)].join('\f'),
  );

  return { archiveRoot, dir };
}

describe('translateIssue (monograph, PB-P002)', () => {
  it('resolves the flat monograph dir and assembles fr/en artifacts', async () => {
    const { archiveRoot, dir } = await buildMonograph();
    const { ctx, calls } = buildCtx({ archiveRoot, sourceId: MONO_SOURCE_ID });

    const result = await translateIssue(MONO_ARK, ctx);

    expect(result.outcome).toBe('translated');
    expect(result.pagesTotal).toBe(3);
    expect(result.pagesDone).toBe(3);
    // Two passes per page, all at the ctx's resolved model.
    expect(calls).toHaveLength(6);
    expect(calls.map((c) => c.model)).toEqual(Array(6).fill(TEST_MODEL));

    // Whole-document artifacts land in the FLAT monograph dir (no _ark child).
    expect(existsSync(path.join(dir, 'issue.fr.txt'))).toBe(true);
    expect(existsSync(path.join(dir, 'issue.en.txt'))).toBe(true);
    expect(existsSync(path.join(dir, 'issue.en.txt.yml'))).toBe(true);

    // English derives from the corrected French, and the citation carried from
    // the monograph's page provenance.
    const enText = await readFile(path.join(dir, 'issue.en.txt'), 'utf-8');
    expect(enText).toContain('EN(CLEAN(');
    const enYaml = await readFile(path.join(dir, 'issue.en.txt.yml'), 'utf-8');
    expect(enYaml).toContain('rights_status: "public-domain"');
    expect(enYaml).toContain(
      `catalog_url: "https://gallica.bnf.fr/ark:/12148/${MONO_ARK}"`,
    );
  });
});
