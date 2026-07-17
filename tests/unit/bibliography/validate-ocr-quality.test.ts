import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateOcrTextQuality } from '@/bibliography/validate-companion-coverage';
import { serializeProvenance, type ProvenanceFields } from '@/archive/provenance';

/**
 * The OCR-quality gate (Constitution III): `bib validate` must flag any
 * `type: ocr-text` artifact that lacks the mandatory `ocr_quality` block, and
 * stay silent on page-image companions and on ocr-text artifacts that carry it.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function base(): ProvenanceFields {
  return {
    id: 'PB-P001',
    title: 'X',
    type: 'page-image',
    case: 'port-breton',
    language: 'French',
    source_archive: 'Gallica / BnF',
    catalog_url: 'https://gallica.bnf.fr/ark:/12148/bpt6k1',
    original_url: '',
    rights_status: 'public-domain',
    retrieved: '2026-07-17T00:00:00.000Z',
    local_path: 'archive/cases/x/f001.jpg',
    sha256: 'deadbeef',
    size: 1,
    format: 'image/jpeg',
    ocr_status: 'none',
    object_store: null,
    rights_raw: '<results/>',
    notes: null,
  };
}

function archiveWith(files: Record<string, ProvenanceFields>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'cc-ocrq-'));
  roots.push(root);
  const dir = path.join(root, 'archive', 'cases', 'x');
  mkdirSync(dir, { recursive: true });
  for (const [name, fields] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), serializeProvenance(fields));
  }
  return root;
}

describe('validateOcrTextQuality', () => {
  it('flags an ocr-text artifact missing ocr_quality, ignoring page images', () => {
    const root = archiveWith({
      'f001.yml': base(), // page-image -> ignored
      'issue.txt.yml': { ...base(), type: 'ocr-text' }, // ocr-text, NO quality
    });
    const findings = validateOcrTextQuality(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('ocr-quality-missing');
    expect(findings[0].path).toMatch(/issue\.txt\.yml$/);
  });

  it('stays silent when the ocr-text artifact carries ocr_quality', () => {
    const root = archiveWith({
      'issue.txt.yml': {
        ...base(),
        type: 'ocr-text',
        ocr_quality: {
          method: 'aspell-realword-ratio-v1',
          language: 'fr',
          ratio: 0.9,
          tier: 'high',
        },
      },
    });
    expect(validateOcrTextQuality(root)).toEqual([]);
  });

  it('is empty when the archive tree is absent', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'cc-ocrq-empty-'));
    roots.push(root);
    expect(validateOcrTextQuality(root)).toEqual([]);
  });
});
