import { describe, it, expect } from 'vitest';
import { verifyGrounded } from '@/extraction/grounding-verifier';
import type {
  FetchedDocument,
  GroundedExtraction,
  MuseumItemFields,
} from '@/extraction/structured-extractor';

const PROVENANCE = {
  modelAssisted: true as const,
  engine: 'codex',
  model: 'claude-3-5-sonnet-20241022',
  promptVersion: '1.0.0',
  at: '2026-07-14T10:00:00Z',
};

function makeDoc(bytes: string): FetchedDocument {
  return { bytes, url: 'https://example.org/item/123' };
}

function makeExtraction(overrides?: {
  dateExcerpt?: string;
  dateValue?: string;
}): GroundedExtraction<MuseumItemFields> {
  return {
    date: {
      value: overrides?.dateValue ?? '1950',
      evidence: {
        excerpt: overrides?.dateExcerpt ?? 'dated 1950',
        selector: '.date-field',
      },
      interpretation: 'item creation date',
      provenance: PROVENANCE,
    },
    creator: {
      value: 'Unknown Artist',
      evidence: { excerpt: 'Artist: Unknown', selector: '.artist-name' },
      interpretation: 'primary creator',
      provenance: PROVENANCE,
    },
    description: {
      value: 'Oil on canvas painting of a landscape',
      evidence: { excerpt: 'oil on canvas', selector: '.description' },
      interpretation: 'content description',
      provenance: PROVENANCE,
    },
    statedCredit: {
      value: 'Gift of the Artist',
      evidence: { excerpt: 'Gift of the Artist', selector: '.credit-line' },
      interpretation: 'credit statement',
      provenance: PROVENANCE,
    },
  };
}

const VALID_PAGE =
  'Item record.\nItem was dated 1950 by the curator.\nArtist: Unknown\n' +
  'The piece is oil on canvas, showing a landscape.\nProvenance: Gift of the Artist.';

describe('verifyGrounded', () => {
  it('does not throw on a fully grounded, correctly attributed extraction', () => {
    const doc = makeDoc(VALID_PAGE);
    const extraction = makeExtraction();

    expect(() => verifyGrounded(doc, extraction, ['date'])).not.toThrow();
  });

  it('throws on an empty/whitespace-only excerpt (code-review #1: includes("") is vacuously true)', () => {
    const doc = makeDoc(VALID_PAGE);
    // A fabricated NON-rights-critical field with an empty excerpt must NOT
    // slip through: an empty excerpt is not grounding.
    const empty = makeExtraction();
    empty.creator = {
      value: 'Fabricated Photographer',
      evidence: { excerpt: '', selector: '.artist-name' },
      interpretation: 'primary creator',
      provenance: PROVENANCE,
    };
    expect(() => verifyGrounded(doc, empty, ['date'])).toThrow(/empty evidence excerpt/i);

    const whitespace = makeExtraction();
    whitespace.creator = {
      value: 'Fabricated Photographer',
      evidence: { excerpt: '   \n\t  ', selector: '.artist-name' },
      interpretation: 'primary creator',
      provenance: PROVENANCE,
    };
    expect(() => verifyGrounded(doc, whitespace, ['date'])).toThrow(/empty evidence excerpt/i);
  });

  it('INV-X1: throws when a field excerpt is fabricated (not present on the page)', () => {
    const doc = makeDoc(VALID_PAGE);
    const extraction = makeExtraction({
      dateExcerpt: 'this text never appears on the page anywhere',
    });

    expect(() => verifyGrounded(doc, extraction, ['date'])).toThrow(/date/);
    expect(() => verifyGrounded(doc, extraction, ['date'])).toThrow(
      /not grounded|does not appear/,
    );
  });

  it('INV-X2: throws when a rights-critical excerpt does not contain the field value', () => {
    const doc = makeDoc(VALID_PAGE);
    // The excerpt is real (present verbatim on the page) but does not mention
    // the claimed date value — a mis-attribution / fabrication guard.
    const extraction = makeExtraction({
      dateExcerpt: 'Artist: Unknown',
      dateValue: '1950',
    });

    expect(() => verifyGrounded(doc, extraction, ['date'])).toThrow(/date/);
    expect(() => verifyGrounded(doc, extraction, ['date'])).toThrow(
      /mis-attributed|does not contain/,
    );
  });

  it('INV-X3: verifies identically across repeated calls (deterministic, no throw on valid input)', () => {
    const doc = makeDoc(VALID_PAGE);
    const extraction = makeExtraction();

    const first = (): void => verifyGrounded(doc, extraction, ['date']);
    const second = (): void => verifyGrounded(doc, extraction, ['date']);

    expect(first).not.toThrow();
    expect(second).not.toThrow();
  });

  it('is insensitive to whitespace differences (collapsed/newline whitespace) between excerpt and page', () => {
    const doc = makeDoc(
      `${VALID_PAGE}\n\nItem   was\n\ndated    1950   by the   curator.`,
    );
    const extraction = makeExtraction({
      dateExcerpt: 'dated\n1950   by the curator',
      dateValue: '1950',
    });

    expect(() => verifyGrounded(doc, extraction, ['date'])).not.toThrow();
  });

  it('does not apply the value-in-excerpt check to non-rights-critical fields', () => {
    const doc = makeDoc(VALID_PAGE);
    // creator's excerpt is present on the page, but does not contain its own
    // value ("Unknown Artist" is not a substring of "Artist: Unknown").
    // Since 'creator' is not in rightsCriticalKeys, this must still pass.
    const extraction = makeExtraction();

    expect(() => verifyGrounded(doc, extraction, ['date'])).not.toThrow();
  });

  it('throws for a fabricated non-rights-critical field excerpt too (all fields are checked)', () => {
    const doc = makeDoc(VALID_PAGE);
    const withFabricatedCreator: GroundedExtraction<MuseumItemFields> = {
      ...makeExtraction(),
      creator: {
        value: 'Unknown Artist',
        evidence: { excerpt: 'a wholly invented creator excerpt', selector: '.artist-name' },
        interpretation: 'primary creator',
        provenance: PROVENANCE,
      },
    };

    expect(() => verifyGrounded(doc, withFabricatedCreator, ['date'])).toThrow(/creator/);
  });

  it('does not mutate the document or extraction inputs', () => {
    const doc = makeDoc(VALID_PAGE);
    const extraction = makeExtraction();
    const docSnapshot = JSON.stringify(doc);
    const extractionSnapshot = JSON.stringify(extraction);

    verifyGrounded(doc, extraction, ['date']);

    expect(JSON.stringify(doc)).toBe(docSnapshot);
    expect(JSON.stringify(extraction)).toBe(extractionSnapshot);
  });
});
