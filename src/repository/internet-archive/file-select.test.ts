/**
 * Tests for {@link selectSourceFiles} (`@/repository/internet-archive/file-select`),
 * T016's deterministic source-file selection over an archive.org item's
 * `files[]` list for the Internet Archive acquisition adapter
 * (specs/013-archiveorg-acquisition-path, FR-003 / SC-006 / IA-INV-A).
 *
 * Real-fixture coverage: `__fixtures__/metadata-nouvellefrancec00groogoog.json`
 * (the de Groote "Nouvelle-France" item) exercises the happy path against a
 * real, captured archive.org file list. The remaining cases are crafted
 * `ItemFile[]` fixtures that exercise the fail-loud ambiguity/absence rules.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { selectSourceFiles } from '@/repository/internet-archive/file-select';
import type { ItemFile } from '@/repository/internet-archive/metadata';

const fixturesDir = join(
  process.cwd(),
  'src',
  'repository',
  'internet-archive',
  '__fixtures__',
);

interface RawFixture {
  files: ItemFile[];
}

function readFixtureFiles(name: string): ItemFile[] {
  const text = readFileSync(join(fixturesDir, name), 'utf-8');
  const parsed: RawFixture = JSON.parse(text) as RawFixture;
  return parsed.files;
}

describe('selectSourceFiles -- real fixture metadata-nouvellefrancec00groogoog.json', () => {
  const files = readFixtureFiles('metadata-nouvellefrancec00groogoog.json');

  it('selects the primary page-image PDF', () => {
    const selected = selectSourceFiles(files);
    expect(selected.pdf.name).toBe('nouvellefrancec00groogoog.pdf');
    expect(selected.pdf.format).toBe('Image Container PDF');
  });

  it('selects the scandata file', () => {
    const selected = selectSourceFiles(files);
    expect(selected.scandata?.name).toBe('nouvellefrancec00groogoog_scandata.xml');
  });

  it('selects the TIFF image set (de Groote has no JP2 zip)', () => {
    const selected = selectSourceFiles(files);
    expect(selected.imageSet?.name).toBe('nouvellefrancec00groogoog_tif.zip');
    expect(selected.imageSet?.format).toBe('Single Page Processed TIFF ZIP');
  });
});

describe('selectSourceFiles -- crafted ambiguity/absence cases', () => {
  it('throws when two equally-eligible page-image PDFs exist', () => {
    const files: ItemFile[] = [
      { name: 'item.pdf', format: 'Image Container PDF', source: 'original' },
      { name: 'item_alt.pdf', format: 'Text PDF', source: 'derivative' },
    ];
    expect(() => selectSourceFiles(files)).toThrow(/ambiguous/i);
  });

  it('prefers the page-image PDF over an OCR-only PDF when both exist', () => {
    const files: ItemFile[] = [
      { name: 'item_ocr.pdf', format: 'OCR-only PDF', source: 'derivative' },
      { name: 'item.pdf', format: 'Image Container PDF', source: 'original' },
    ];
    const selected = selectSourceFiles(files);
    expect(selected.pdf.name).toBe('item.pdf');
  });

  it('throws when no PDF file exists at all', () => {
    const files: ItemFile[] = [
      { name: 'item_scandata.xml', format: 'Scandata', source: 'derivative' },
      { name: 'item_djvu.txt', format: 'DjVuTXT', source: 'derivative' },
    ];
    expect(() => selectSourceFiles(files)).toThrow(/no PDF/i);
  });

  it('throws when the only PDF is OCR-only (no page-image PDF present)', () => {
    const files: ItemFile[] = [
      { name: 'item_ocr.pdf', format: 'OCR-only PDF', source: 'derivative' },
    ];
    expect(() => selectSourceFiles(files)).toThrow(/no eligible page-image PDF/i);
  });

  it('throws when two equally-eligible TIFF image-set zips exist', () => {
    const files: ItemFile[] = [
      { name: 'item.pdf', format: 'Image Container PDF', source: 'original' },
      { name: 'item_tif.zip', format: 'Single Page Processed TIFF ZIP', source: 'derivative' },
      { name: 'item_v2_tif.zip', format: 'Single Page Processed TIFF ZIP', source: 'derivative' },
    ];
    expect(() => selectSourceFiles(files)).toThrow(/ambiguous/i);
  });

  it('prefers the JP2 image set over a TIFF image set when both exist', () => {
    const files: ItemFile[] = [
      { name: 'item.pdf', format: 'Image Container PDF', source: 'original' },
      { name: 'item_jp2.zip', format: 'Single Page Processed JP2 ZIP', source: 'derivative' },
      { name: 'item_tif.zip', format: 'Single Page Processed TIFF ZIP', source: 'derivative' },
    ];
    const selected = selectSourceFiles(files);
    expect(selected.imageSet?.name).toBe('item_jp2.zip');
  });

  it('leaves scandata and imageSet undefined when absent (not an error)', () => {
    const files: ItemFile[] = [
      { name: 'item.pdf', format: 'Image Container PDF', source: 'original' },
    ];
    const selected = selectSourceFiles(files);
    expect(selected.scandata).toBeUndefined();
    expect(selected.imageSet).toBeUndefined();
  });

  it('rejects a restricted/encrypted PDF, throwing when it is the only PDF', () => {
    const files: ItemFile[] = [
      { name: 'item.pdf', format: 'Image Container PDF (restricted)', source: 'original' },
    ];
    expect(() => selectSourceFiles(files)).toThrow();
  });
});
