import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  serializeProvenance,
  parseProvenance,
  type ProvenanceFields,
} from '@/archive/provenance';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(here, '../fixtures/page-provenance.yml');

/** A legacy fetcher record: no engine/model/translation keys, notes null. */
function legacyFields(): ProvenanceFields {
  return {
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
    local_path: 'archive/cases/port-breton/PB-P001/f001.jpg',
    sha256: 'deadbeef',
    format: 'image/jpeg',
    ocr_status: 'none',
    rights_raw: '<results/>',
    notes: null,
  };
}

describe('serializeProvenance backward compatibility', () => {
  it('re-serializes an existing fixture record byte-identically', () => {
    // The committed fixture predates the machine-assistance keys. Parsing then
    // re-serializing it MUST reproduce the exact bytes on disk, proving no
    // regression from the additive optional keys.
    const original = readFileSync(FIXTURE_PATH, 'utf-8');
    const roundTripped = serializeProvenance(parseProvenance(original));
    expect(roundTripped).toBe(original);
  });

  it('omits absent optional keys entirely (no engine/model/translation lines)', () => {
    const yaml = serializeProvenance(legacyFields());
    expect(yaml).not.toMatch(/^engine:/m);
    expect(yaml).not.toMatch(/^model:/m);
    expect(yaml).not.toMatch(/^translation:/m);
  });

  it('still emits notes: null exactly as before', () => {
    const yaml = serializeProvenance(legacyFields());
    expect(yaml).toMatch(/^notes: null$/m);
  });

  it('is deterministic: identical input yields byte-identical output', () => {
    expect(serializeProvenance(legacyFields())).toBe(
      serializeProvenance(legacyFields()),
    );
  });
});

describe('serializeProvenance machine-assistance keys', () => {
  it('emits engine/model/translation in KEY_ORDER position (after ocr_status, before notes)', () => {
    const fields: ProvenanceFields = {
      ...legacyFields(),
      type: 'english-translation',
      format: 'text/plain',
      engine: 'claude-code-cli',
      model: 'claude-opus-4',
      translation: 'machine-assisted',
    };
    const yaml = serializeProvenance(fields);
    const lines = yaml.trimEnd().split('\n');
    const keyOf = (line: string): string => line.slice(0, line.indexOf(':'));
    const keys = lines.map(keyOf);

    const ocrIdx = keys.indexOf('ocr_status');
    const engineIdx = keys.indexOf('engine');
    const modelIdx = keys.indexOf('model');
    const translationIdx = keys.indexOf('translation');
    const notesIdx = keys.indexOf('notes');

    expect(ocrIdx).toBeGreaterThanOrEqual(0);
    expect(engineIdx).toBe(ocrIdx + 1);
    expect(modelIdx).toBe(engineIdx + 1);
    expect(translationIdx).toBe(modelIdx + 1);
    expect(notesIdx).toBe(translationIdx + 1);

    expect(yaml).toContain('engine: "claude-code-cli"');
    expect(yaml).toContain('model: "claude-opus-4"');
    expect(yaml).toContain('translation: "machine-assisted"');
  });

  it('round-trips a record WITH the new fields (parse ∘ serialize == identity on the field set)', () => {
    const fields: ProvenanceFields = {
      ...legacyFields(),
      engine: 'claude-code-cli',
      model: 'claude-opus-4',
      translation: 'machine-assisted',
      notes: 'corrected then translated',
    };
    const parsed = parseProvenance(serializeProvenance(fields));
    expect(parsed).toEqual(fields);
    // And serialize is stable across the round trip.
    expect(serializeProvenance(parsed)).toBe(serializeProvenance(fields));
  });

  it('leaves the new keys undefined when a partial record supplies only some', () => {
    const fields: ProvenanceFields = {
      ...legacyFields(),
      translation: 'machine-assisted',
    };
    const yaml = serializeProvenance(fields);
    expect(yaml).not.toMatch(/^engine:/m);
    expect(yaml).not.toMatch(/^model:/m);
    expect(yaml).toContain('translation: "machine-assisted"');

    const parsed = parseProvenance(yaml);
    expect(parsed.engine).toBeUndefined();
    expect(parsed.model).toBeUndefined();
    expect(parsed.translation).toBe('machine-assisted');
  });
});
