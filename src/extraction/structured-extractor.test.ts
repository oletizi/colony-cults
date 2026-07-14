import { describe, it, expect } from 'vitest';
import type {
  FetchedDocument,
  GroundedField,
  GroundedExtraction,
  MuseumItemFields,
  ExtractionSchema,
} from '@/extraction/structured-extractor';

describe('StructuredExtractor types', () => {
  it('constructs a valid GroundedField<string>', () => {
    const field: GroundedField<string> = {
      value: '1950-06-15',
      evidence: {
        excerpt: 'Created on June 15, 1950',
        selector: '#metadata .date',
      },
      interpretation: 'item creation date',
      provenance: {
        modelAssisted: true,
        engine: 'codex',
        model: 'claude-3-5-sonnet-20241022',
        promptVersion: '1.0.0',
        at: '2026-07-14T10:00:00Z',
      },
    };

    expect(field).toBeDefined();
    expect(field.value).toBe('1950-06-15');
  });

  it('constructs a valid GroundedExtraction<MuseumItemFields>', () => {
    const extraction: GroundedExtraction<MuseumItemFields> = {
      date: {
        value: '1950',
        evidence: {
          excerpt: 'dated 1950',
          selector: '.date-field',
        },
        interpretation: 'item creation date',
        provenance: {
          modelAssisted: true,
          engine: 'codex',
          model: 'claude-3-5-sonnet-20241022',
          promptVersion: '1.0.0',
          at: '2026-07-14T10:00:00Z',
        },
      },
      creator: {
        value: 'Unknown Artist',
        evidence: {
          excerpt: 'Artist: Unknown',
          selector: '.artist-name',
        },
        interpretation: 'primary creator',
        provenance: {
          modelAssisted: true,
          engine: 'codex',
          model: 'claude-3-5-sonnet-20241022',
          promptVersion: '1.0.0',
          at: '2026-07-14T10:00:00Z',
        },
      },
      description: {
        value: 'Oil on canvas painting of a landscape',
        evidence: {
          excerpt: 'oil on canvas',
          selector: '.description',
        },
        interpretation: 'content description',
        provenance: {
          modelAssisted: true,
          engine: 'codex',
          model: 'claude-3-5-sonnet-20241022',
          promptVersion: '1.0.0',
          at: '2026-07-14T10:00:00Z',
        },
      },
      statedCredit: {
        value: 'Gift of the Artist',
        evidence: {
          excerpt: 'Gift of the Artist',
          selector: '.credit-line',
        },
        interpretation: 'credit statement',
        provenance: {
          modelAssisted: true,
          engine: 'codex',
          model: 'claude-3-5-sonnet-20241022',
          promptVersion: '1.0.0',
          at: '2026-07-14T10:00:00Z',
        },
      },
    };

    expect(extraction).toBeDefined();
    expect(extraction.date.value).toBe('1950');
    expect(extraction.creator?.value).toBe('Unknown Artist');
  });

  it('types ExtractionSchema<MuseumItemFields> correctly', () => {
    const schema: ExtractionSchema<MuseumItemFields> = {
      fields: ['date', 'creator', 'description', 'statedCredit'],
      rightsCriticalFields: ['date'],
    };

    expect(schema.fields).toContain('date');
    expect(schema.rightsCriticalFields).toContain('date');
  });

  it('satisfies FetchedDocument interface', () => {
    const doc: FetchedDocument = {
      bytes: 'Item Date: 1950\nArtist: Unknown\nDescription: A painting',
      url: 'https://example.org/item/123',
    };

    expect(doc.url).toContain('example.org');
  });
});
