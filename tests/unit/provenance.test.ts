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
    size: 2245452,
    format: 'image/jpeg',
    ocr_status: 'none',
    object_store: null,
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
  it('emits engine/model/translation in KEY_ORDER position (after ocr_status, before object_store)', () => {
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
    const objectStoreIdx = keys.indexOf('object_store');

    expect(ocrIdx).toBeGreaterThanOrEqual(0);
    expect(engineIdx).toBe(ocrIdx + 1);
    expect(modelIdx).toBe(engineIdx + 1);
    expect(translationIdx).toBe(modelIdx + 1);
    // The object-store block follows the machine-assistance keys (merged schema).
    expect(objectStoreIdx).toBe(translationIdx + 1);

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

describe('serializeProvenance ocr_quality block', () => {
  it('round-trips an ocr-text record carrying ocr_quality', () => {
    const fields: ProvenanceFields = {
      ...legacyFields(),
      type: 'ocr-text',
      format: 'text/plain',
      ocr_quality: {
        method: 'aspell-realword-ratio-v1',
        language: 'en',
        ratio: 0.46,
        tier: 'low',
      },
    };
    const yaml = serializeProvenance(fields);
    expect(yaml).toContain('ocr_quality:');
    expect(yaml).toContain('  method: "aspell-realword-ratio-v1"');
    expect(yaml).toContain('  ratio: 0.46'); // bare number, not quoted
    expect(yaml).toContain('  tier: "low"');
    // The block sits between object_store and notes (KEY_ORDER).
    const keys = yaml.trimEnd().split('\n').filter((l) => !l.startsWith('  '));
    const idx = (k: string) => keys.findIndex((l) => l.startsWith(`${k}:`));
    expect(idx('ocr_quality')).toBe(idx('object_store') + 1);
    expect(idx('notes')).toBe(idx('ocr_quality') + 1);

    const parsed = parseProvenance(yaml);
    expect(parsed).toEqual(fields);
    expect(serializeProvenance(parsed)).toBe(yaml);
  });

  it('omits ocr_quality entirely when absent (legacy records re-serialize byte-identically)', () => {
    const yaml = serializeProvenance(legacyFields());
    expect(yaml).not.toMatch(/^ocr_quality:/m);
    expect(parseProvenance(yaml).ocr_quality).toBeUndefined();
  });

  it('rejects an invalid tier in an ocr_quality block', () => {
    const yaml = serializeProvenance({
      ...legacyFields(),
      type: 'ocr-text',
      ocr_quality: {
        method: 'aspell-realword-ratio-v1',
        language: 'en',
        ratio: 0.5,
        tier: 'low',
      },
    }).replace('tier: "low"', 'tier: "bogus"');
    expect(() => parseProvenance(yaml)).toThrow(/tier must be low\|medium\|high/);
  });
});

describe('serializeProvenance blank_recto marker (FR-014)', () => {
  it('emits blank_recto in KEY_ORDER position (after translation, before object_store)', () => {
    const fields: ProvenanceFields = {
      ...legacyFields(),
      language: 'English',
      translation: 'machine-assisted',
      blank_recto: true,
    };
    const yaml = serializeProvenance(fields);
    const lines = yaml.trimEnd().split('\n');
    const keyOf = (line: string): string => line.slice(0, line.indexOf(':'));
    const keys = lines.map(keyOf);

    const translationIdx = keys.indexOf('translation');
    const blankRectoIdx = keys.indexOf('blank_recto');
    const objectStoreIdx = keys.indexOf('object_store');

    expect(translationIdx).toBeGreaterThanOrEqual(0);
    expect(blankRectoIdx).toBe(translationIdx + 1);
    expect(objectStoreIdx).toBe(blankRectoIdx + 1);

    // Bare (unquoted) boolean scalar, not a quoted string.
    expect(yaml).toContain('blank_recto: true');
    expect(yaml).not.toContain('blank_recto: "true"');
  });

  it('round-trips a record WITH blank_recto: true (parse ∘ serialize == identity)', () => {
    const fields: ProvenanceFields = {
      ...legacyFields(),
      language: 'English',
      blank_recto: true,
    };
    const parsed = parseProvenance(serializeProvenance(fields));
    expect(parsed).toEqual(fields);
    expect(parsed.blank_recto).toBe(true);
    expect(serializeProvenance(parsed)).toBe(serializeProvenance(fields));
  });

  it('omits blank_recto entirely when unset (unmarked folios re-serialize byte-identically)', () => {
    const yaml = serializeProvenance(legacyFields());
    expect(yaml).not.toMatch(/^blank_recto:/m);
    expect(parseProvenance(yaml).blank_recto).toBeUndefined();
  });

  it('rejects a malformed blank_recto value (not a boolean scalar)', () => {
    const yaml = serializeProvenance({
      ...legacyFields(),
      blank_recto: true,
    }).replace('blank_recto: true', 'blank_recto: maybe');
    expect(() => parseProvenance(yaml)).toThrow(/field "blank_recto" must be a boolean/);
  });
});
