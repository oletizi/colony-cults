import { describe, it, expect } from 'vitest';
import {
  serializeProvenance,
  parseProvenance,
  type ObjectStoreLocation,
  type ProvenanceFields,
} from '@/archive/provenance';

const OBJECT_STORE: ObjectStoreLocation = {
  provider: 'backblaze-b2',
  bucket: 'colony-cults',
  key: 'archive/cases/port-breton/f001.jpg',
  endpoint: 'https://s3.us-west-004.backblazeb2.com',
};

function baseFields(overrides: Partial<ProvenanceFields> = {}): ProvenanceFields {
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
    local_path: 'archive/cases/port-breton/f001.jpg',
    sha256: 'a'.repeat(64),
    format: 'image/jpeg',
    ocr_status: 'none',
    size: 123456,
    object_store: OBJECT_STORE,
    rights_raw: '<results/>',
    notes: null,
    ...overrides,
  };
}

describe('provenance size + object_store (T008/T009)', () => {
  it('serializes size as a bare (unquoted) integer', () => {
    const yaml = serializeProvenance(baseFields());
    expect(yaml).toContain('\nsize: 123456\n');
    expect(yaml).not.toContain('size: "123456"');
  });

  it('serializes object_store as a fixed sub-key-order nested block', () => {
    const yaml = serializeProvenance(baseFields());
    expect(yaml).toContain(
      [
        'object_store:',
        '  provider: "backblaze-b2"',
        '  bucket: "colony-cults"',
        '  key: "archive/cases/port-breton/f001.jpg"',
        '  endpoint: "https://s3.us-west-004.backblazeb2.com"',
      ].join('\n'),
    );
  });

  it('emits the object_store block before notes and rights_raw', () => {
    const yaml = serializeProvenance(baseFields());
    expect(yaml.indexOf('object_store:')).toBeLessThan(yaml.indexOf('\nnotes:'));
    expect(yaml.indexOf('\nnotes:')).toBeLessThan(yaml.indexOf('rights_raw:'));
  });

  it('round-trips a populated object_store byte-identically', () => {
    const original = serializeProvenance(baseFields());
    const parsed = parseProvenance(original);
    const reserialized = serializeProvenance(parsed);
    expect(reserialized).toBe(original);
  });

  it('recovers size as a number and object_store as typed fields', () => {
    const parsed = parseProvenance(serializeProvenance(baseFields()));
    expect(parsed.size).toBe(123456);
    expect(typeof parsed.size).toBe('number');
    expect(parsed.object_store).toEqual(OBJECT_STORE);
  });

  it('round-trips object_store: null byte-identically', () => {
    const original = serializeProvenance(baseFields({ object_store: null }));
    expect(original).toContain('\nobject_store: null\n');
    const parsed = parseProvenance(original);
    expect(parsed.object_store).toBeNull();
    expect(serializeProvenance(parsed)).toBe(original);
  });
});
