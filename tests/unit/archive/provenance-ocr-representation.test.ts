import { describe, expect, it } from 'vitest';
import { serializeProvenance, parseProvenance } from '@/archive/provenance';
import type { ProvenanceFields } from '@/archive/provenance';
import { isAcquiredAssetRole } from '@/model/acquired-asset';

function baseFields(): ProvenanceFields {
  return {
    id: 'PB-P061', title: 'X', type: 'ocr-text', case: 'port-breton',
    language: 'English', source_archive: 'Papers Past', catalog_url: 'https://x',
    original_url: 'https://x', rights_status: 'public-domain', retrieved: '2026-07-21T00:00:00.000Z',
    local_path: 'archive/papers-past/hns.../a.txt', sha256: 'a'.repeat(64),
    format: 'text/plain; charset=utf-8', ocr_status: 'none', size: 12,
    object_store: null, rights_raw: '', notes: null,
  };
}

describe('ocr-text role + source_representation provenance', () => {
  it('accepts ocr-text as a known role', () => {
    expect(isAcquiredAssetRole('ocr-text')).toBe(true);
  });

  it('emits source_representation when present and round-trips', () => {
    const out = serializeProvenance({ ...baseFields(), source_representation: 'papers-past-text-tab' });
    // Quoted, matching the emitField/quotedScalar convention already used for
    // the engine/model/translation precedent (see tests/unit/provenance.test.ts).
    expect(out).toContain('source_representation: "papers-past-text-tab"');
    expect(parseProvenance(out).source_representation).toBe('papers-past-text-tab');
  });

  it('omits source_representation entirely when unset (byte-identical to no-key form)', () => {
    const out = serializeProvenance(baseFields());
    expect(out).not.toContain('source_representation');
  });
});
