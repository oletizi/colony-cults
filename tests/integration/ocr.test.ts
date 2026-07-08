import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ocrIssue } from '@/ocr/run';
import type { OcrCommandRunner } from '@/ocr/types';
import { writeProvenance, type ProvenanceFields } from '@/archive/provenance';
import { assertInsideArchive } from '@/archive/location';

/**
 * Integration coverage for the OCR pipeline (T030/T033): `ocrIssue` is driven
 * against a temp issue directory with fake page images and an injected
 * command runner that simulates `img2pdf` -> `ocrmypdf` -> `pdftotext`
 * producing output files. No real OCR toolchain, no network.
 */

const BASE_PAGE_PROVENANCE: ProvenanceFields = {
  id: 'PB-P001',
  title: 'La Nouvelle France',
  type: 'page-image',
  case: 'port-breton',
  language: 'French',
  source_archive: 'Gallica / BnF',
  catalog_url: 'https://gallica.bnf.fr/ark:/12148/bpt6k5603637g',
  original_url:
    'https://gallica.bnf.fr/iiif/ark:/12148/bpt6k5603637g/f1/full/full/0/native.jpg',
  rights_status: 'public-domain',
  retrieved: '2026-07-08T00:00:00.000Z',
  local_path: 'archive/cases/port-breton/newspapers/la-nouvelle-france/x/f001.jpg',
  sha256: 'deadbeef',
  format: 'image/jpeg',
  ocr_status: 'none',
  rights_raw: '<oai_dc:dc><dc:rights>domaine public</dc:rights></oai_dc:dc>',
  notes: null,
};

function fakeRunner(): OcrCommandRunner {
  return {
    run: async (command, args) => {
      if (command === 'img2pdf') {
        const outPath = args[args.indexOf('-o') + 1];
        await writeFile(outPath, 'FAKE-RAW-PDF');
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      if (command === 'ocrmypdf') {
        const outPath = args[args.length - 1];
        await writeFile(outPath, 'FAKE-SEARCHABLE-PDF-A');
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      if (command === 'pdftotext') {
        const outPath = args[args.length - 1];
        await writeFile(outPath, 'FAKE OCR TEXT\n');
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      throw new Error(`fakeRunner: unexpected command "${command}"`);
    },
  };
}

function writePages(issueDir: string, pages: number[]): void {
  for (const n of pages) {
    const name = `f${String(n).padStart(3, '0')}`;
    writeFileSync(path.join(issueDir, `${name}.jpg`), `FAKE-PAGE-${n}`);
  }
}

async function writePageProvenance(issueDir: string, pages: number[]): Promise<void> {
  for (const n of pages) {
    const name = `f${String(n).padStart(3, '0')}`;
    await writeProvenance(path.join(issueDir, `${name}.yml`), BASE_PAGE_PROVENANCE);
  }
}

describe('ocrIssue (T030/T033)', () => {
  let archiveRoot: string;
  let issueDir: string;

  beforeEach(() => {
    archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-ocr-archive-'));
    issueDir = path.join(
      archiveRoot,
      'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k5603637g',
    );
    mkdirSync(issueDir, { recursive: true });
    writePages(issueDir, [1, 2]);
  });

  afterEach(() => {
    rmSync(archiveRoot, { recursive: true, force: true });
  });

  it('produces issue.txt (searchable PDF transient, not stored) with companion YAML and marks pages searchable', async () => {
    await writePageProvenance(issueDir, [1, 2]);

    const result = await ocrIssue(issueDir, {
      runner: fakeRunner(),
      archiveRoot,
      clock: () => new Date('2026-07-09T00:00:00.000Z'),
    });

    expect(result.text.skipped).toBe(false);

    const pdfPath = path.join(issueDir, 'issue.pdf');
    const txtPath = path.join(issueDir, 'issue.txt');
    // The searchable PDF is a transient intermediate: NOT persisted.
    expect(existsSync(pdfPath)).toBe(false);
    expect(existsSync(`${pdfPath}.yml`)).toBe(false);
    expect(existsSync(txtPath)).toBe(true);
    expect(existsSync(`${txtPath}.yml`)).toBe(true);
    expect(() => assertInsideArchive(txtPath, archiveRoot)).not.toThrow();

    const txtBytes = await readFile(txtPath, 'utf-8');
    expect(txtBytes).toBe('FAKE OCR TEXT\n');

    const txtYaml = await readFile(`${txtPath}.yml`, 'utf-8');
    expect(txtYaml).toContain('type: "ocr-text"');
    expect(txtYaml).toContain('ocr_status: "searchable"');
    expect(txtYaml).toContain('format: "text/plain"');
    expect(txtYaml).toContain('rights_status: "public-domain"');

    // Page provenance is updated from 'none' to 'searchable' (T030).
    const page1Yaml = await readFile(path.join(issueDir, 'f001.yml'), 'utf-8');
    expect(page1Yaml).toContain('ocr_status: "searchable"');
    const page2Yaml = await readFile(path.join(issueDir, 'f002.yml'), 'utf-8');
    expect(page2Yaml).toContain('ocr_status: "searchable"');

    // The integrity manifest picked up the text but NOT the transient PDF.
    const manifest = await readFile(
      path.join(archiveRoot, 'manifests', 'MANIFEST.sha256'),
      'utf-8',
    );
    expect(manifest).not.toMatch(/issue\.pdf$/m);
    expect(manifest).toMatch(/issue\.txt$/m);
  });

  it('skips an already-recorded issue.txt on a second run (resumability)', async () => {
    await writePageProvenance(issueDir, [1, 2]);
    const ctx = {
      runner: fakeRunner(),
      archiveRoot,
      clock: () => new Date('2026-07-09T00:00:00.000Z'),
    };

    await ocrIssue(issueDir, ctx);

    let toolchainCalls = 0;
    const countingRunner: OcrCommandRunner = {
      run: async (command, args) => {
        toolchainCalls += 1;
        return fakeRunner().run(command, args);
      },
    };
    const rerun = await ocrIssue(issueDir, { ...ctx, runner: countingRunner });

    expect(rerun.text.skipped).toBe(true);
    expect(toolchainCalls).toBe(0);
  });

  it('sets ocr_status "failed" on page provenance and throws when a tool fails', async () => {
    await writePageProvenance(issueDir, [1, 2]);

    const failingRunner: OcrCommandRunner = {
      run: async (command) => {
        if (command === 'img2pdf') {
          return { stdout: '', stderr: 'img2pdf: boom', exitCode: 1 };
        }
        throw new Error(`unexpected command "${command}"`);
      },
    };

    await expect(
      ocrIssue(issueDir, {
        runner: failingRunner,
        archiveRoot,
        clock: () => new Date(),
      }),
    ).rejects.toThrow(/img2pdf/);

    const page1Yaml = await readFile(path.join(issueDir, 'f001.yml'), 'utf-8');
    expect(page1Yaml).toContain('ocr_status: "failed"');
    const page2Yaml = await readFile(path.join(issueDir, 'f002.yml'), 'utf-8');
    expect(page2Yaml).toContain('ocr_status: "failed"');

    expect(existsSync(path.join(issueDir, 'issue.pdf'))).toBe(false);
    expect(existsSync(path.join(issueDir, 'issue.txt'))).toBe(false);
  });

  it('enforces the archive write-guard for the issue directory itself', async () => {
    const outsideDir = mkdtempSync(path.join(tmpdir(), 'cc-ocr-outside-'));
    writePages(outsideDir, [1, 2]);
    try {
      await expect(
        ocrIssue(outsideDir, {
          runner: fakeRunner(),
          archiveRoot,
          clock: () => new Date(),
        }),
      ).rejects.toThrow(/outside the private archive|no override/i);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
