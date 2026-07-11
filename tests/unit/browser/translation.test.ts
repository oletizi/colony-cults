import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { stringify } from 'yaml';
import { loadPageTranslation } from '@/browser/load/translation';

/**
 * `loadPageTranslation` pairs a page's corrected-French and English
 * translation text with the provenance record assembled from the page's
 * `.yml` sidecar (see specs/005-corpus-browser/data-model.md ProvenanceRecord
 * and specs/005-corpus-browser/contracts/corpus-loader.md G-2/G-3).
 *
 * These tests build a synthetic temp issue dir per case -- no dependency on
 * the real archive clone.
 */

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeIssueDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'corpus-browser-translation-'));
  tempDirs.push(dir);
  mkdirSync(path.join(dir, 'translation'), { recursive: true });
  return dir;
}

function writeTranslationFile(issueDir: string, filename: string, content: string): void {
  writeFileSync(path.join(issueDir, 'translation', filename), content, 'utf-8');
}

function writeSidecar(issueDir: string, filename: string, fields: Record<string, string>): void {
  writeFileSync(path.join(issueDir, 'translation', filename), stringify(fields), 'utf-8');
}

const COMPLETE_SIDECAR: Record<string, string> = {
  id: 'PB-P001',
  catalog_url: 'https://gallica.bnf.fr/ark:/12148/bpt6k56068358',
  rights_status: 'public-domain',
  sha256: 'e2fac2bd47f230eadb4d85b233f868ab888229cb7e67bf83ef36bf55a18c34a3',
};

describe('loadPageTranslation', () => {
  it('pairs fr/en translation text with a fully-populated provenance record', () => {
    const issueDir = makeIssueDir();
    writeTranslationFile(issueDir, 'p001.fr.txt', 'Texte corrigé.');
    writeTranslationFile(issueDir, 'p001.en.txt', 'Corrected text.');
    writeSidecar(issueDir, 'p001.fr.txt.yml', COMPLETE_SIDECAR);

    const result = loadPageTranslation(issueDir, 'p001', '1879-08-15');

    expect(result.correctedFrench).toBe('Texte corrigé.');
    expect(result.english).toBe('Corrected text.');
    expect(result.provenance).toEqual({
      sourceId: 'PB-P001',
      ark: 'ark:/12148/bpt6k56068358',
      date: '1879-08-15',
      rights: 'public-domain',
      page: 'p001',
      sha256: 'e2fac2bd47f230eadb4d85b233f868ab888229cb7e67bf83ef36bf55a18c34a3',
    });
  });

  it('returns correctedFrench: null when the .fr.txt file is absent (optional layer)', () => {
    const issueDir = makeIssueDir();
    writeTranslationFile(issueDir, 'p001.en.txt', 'Corrected text.');
    writeSidecar(issueDir, 'p001.en.txt.yml', COMPLETE_SIDECAR);

    const result = loadPageTranslation(issueDir, 'p001', '1879-08-15');

    expect(result.correctedFrench).toBeNull();
    expect(result.english).toBe('Corrected text.');
  });

  it('falls back to the .en.txt.yml sidecar when the .fr.txt.yml sidecar is absent', () => {
    const issueDir = makeIssueDir();
    writeTranslationFile(issueDir, 'p001.en.txt', 'Corrected text.');
    writeSidecar(issueDir, 'p001.en.txt.yml', COMPLETE_SIDECAR);

    const result = loadPageTranslation(issueDir, 'p001', '1879-08-15');

    expect(result.provenance.sourceId).toBe('PB-P001');
    expect(result.provenance.ark).toBe('ark:/12148/bpt6k56068358');
  });

  it('throws when the required p001.en.txt file is missing', () => {
    const issueDir = makeIssueDir();
    writeTranslationFile(issueDir, 'p001.fr.txt', 'Texte corrigé.');
    writeSidecar(issueDir, 'p001.fr.txt.yml', COMPLETE_SIDECAR);

    expect(() => loadPageTranslation(issueDir, 'p001', '1879-08-15')).toThrow();
  });

  it('throws naming the missing field when the sidecar lacks sha256', () => {
    const issueDir = makeIssueDir();
    writeTranslationFile(issueDir, 'p001.fr.txt', 'Texte corrigé.');
    writeTranslationFile(issueDir, 'p001.en.txt', 'Corrected text.');
    writeSidecar(issueDir, 'p001.fr.txt.yml', {
      id: 'PB-P001',
      catalog_url: 'https://gallica.bnf.fr/ark:/12148/bpt6k56068358',
      rights_status: 'public-domain',
    });

    expect(() => loadPageTranslation(issueDir, 'p001', '1879-08-15')).toThrow(/sha256/);
  });

  it('throws naming the missing field when the sidecar lacks id', () => {
    const issueDir = makeIssueDir();
    writeTranslationFile(issueDir, 'p001.fr.txt', 'Texte corrigé.');
    writeTranslationFile(issueDir, 'p001.en.txt', 'Corrected text.');
    writeSidecar(issueDir, 'p001.fr.txt.yml', {
      catalog_url: 'https://gallica.bnf.fr/ark:/12148/bpt6k56068358',
      rights_status: 'public-domain',
      sha256: 'e2fac2bd47f230eadb4d85b233f868ab888229cb7e67bf83ef36bf55a18c34a3',
    });

    expect(() => loadPageTranslation(issueDir, 'p001', '1879-08-15')).toThrow(/id/);
  });

  it('throws naming the missing field when the sidecar lacks rights_status', () => {
    const issueDir = makeIssueDir();
    writeTranslationFile(issueDir, 'p001.fr.txt', 'Texte corrigé.');
    writeTranslationFile(issueDir, 'p001.en.txt', 'Corrected text.');
    writeSidecar(issueDir, 'p001.fr.txt.yml', {
      id: 'PB-P001',
      catalog_url: 'https://gallica.bnf.fr/ark:/12148/bpt6k56068358',
      sha256: 'e2fac2bd47f230eadb4d85b233f868ab888229cb7e67bf83ef36bf55a18c34a3',
    });

    expect(() => loadPageTranslation(issueDir, 'p001', '1879-08-15')).toThrow(/rights_status/);
  });

  it('throws when catalog_url has no parseable ark', () => {
    const issueDir = makeIssueDir();
    writeTranslationFile(issueDir, 'p001.fr.txt', 'Texte corrigé.');
    writeTranslationFile(issueDir, 'p001.en.txt', 'Corrected text.');
    writeSidecar(issueDir, 'p001.fr.txt.yml', {
      id: 'PB-P001',
      catalog_url: 'https://gallica.bnf.fr/no-ark-here',
      rights_status: 'public-domain',
      sha256: 'e2fac2bd47f230eadb4d85b233f868ab888229cb7e67bf83ef36bf55a18c34a3',
    });

    expect(() => loadPageTranslation(issueDir, 'p001', '1879-08-15')).toThrow();
  });

  it('throws when neither sidecar file exists', () => {
    const issueDir = makeIssueDir();
    writeTranslationFile(issueDir, 'p001.en.txt', 'Corrected text.');

    expect(() => loadPageTranslation(issueDir, 'p001', '1879-08-15')).toThrow();
  });
});
