import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateTranslationLabels } from '@/bibliography/validate-companion-coverage';
import { serializeProvenance, type ProvenanceFields } from '@/archive/provenance';

/**
 * The translation-label gate: an EMPTY translation artifact must be labeled
 * `untranslatable`, a NON-EMPTY one `machine-assisted`. Either mismatch (or a
 * provenance sidecar with no text file) is flagged, so an intentional empty is
 * never confused with corruption.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function prov(translation: string): ProvenanceFields {
  return {
    id: 'PB-P001',
    title: 'X',
    type: 'english-translation',
    case: 'port-breton',
    language: 'English',
    source_archive: 'Gallica / BnF',
    catalog_url: 'https://gallica.bnf.fr/ark:/12148/bpt6k1',
    original_url: '',
    rights_status: 'public-domain',
    retrieved: '2026-07-17T00:00:00.000Z',
    local_path: 'archive/cases/x/translation/p001.en.txt',
    sha256: 'deadbeef',
    size: 0,
    format: 'text/plain',
    ocr_status: 'searchable',
    engine: 'codex-cli',
    model: 'gpt-5.5',
    translation,
    object_store: null,
    rights_raw: '<results/>',
    notes: null,
  };
}

/** Write a translation artifact (text + provenance sidecar) into a tmp archive. */
function archiveWith(
  artifacts: Array<{ name: string; text: string; label: string }>,
): string {
  const root = mkdtempSync(path.join(tmpdir(), 'cc-tl-'));
  roots.push(root);
  const dir = path.join(root, 'archive', 'cases', 'x', 'translation');
  mkdirSync(dir, { recursive: true });
  for (const a of artifacts) {
    writeFileSync(path.join(dir, a.name), a.text);
    writeFileSync(path.join(dir, `${a.name}.yml`), serializeProvenance(prov(a.label)));
  }
  return root;
}

describe('validateTranslationLabels', () => {
  it('is silent on consistent artifacts (empty=untranslatable, non-empty=machine-assisted)', () => {
    const root = archiveWith([
      { name: 'p001.en.txt', text: 'A real translation.', label: 'machine-assisted' },
      { name: 'p002.en.txt', text: '', label: 'untranslatable' },
    ]);
    expect(validateTranslationLabels(root)).toEqual([]);
  });

  it('flags an EMPTY artifact labeled machine-assisted (the corruption-lookalike)', () => {
    const root = archiveWith([
      { name: 'p001.en.txt', text: '', label: 'machine-assisted' },
    ]);
    const f = validateTranslationLabels(root);
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe('translation-label-inconsistent');
    expect(f[0].detail).toMatch(/EMPTY.*machine-assisted.*expected "untranslatable"/);
  });

  it('flags a NON-EMPTY artifact labeled untranslatable (a contradiction)', () => {
    const root = archiveWith([
      { name: 'p001.en.txt', text: 'has content', label: 'untranslatable' },
    ]);
    const f = validateTranslationLabels(root);
    expect(f).toHaveLength(1);
    expect(f[0].detail).toMatch(/non-empty.*untranslatable.*expected "machine-assisted"/);
  });
});
