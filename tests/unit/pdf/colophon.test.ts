import { describe, it, expect } from 'vitest';
import { assembleColophon, EVIDENCE_FRAMING } from '@/pdf/load/colophon';
import type { ColophonPageInput, ColophonInput } from '@/pdf/load/colophon';
import type { MachineAssistLabel, OcrTranscription } from '@/pdf/model';

describe('EVIDENCE_FRAMING', () => {
  it('is a non-empty string', () => {
    expect(typeof EVIDENCE_FRAMING).toBe('string');
    expect(EVIDENCE_FRAMING.length).toBeGreaterThan(0);
  });

  it('mentions evidence and propaganda', () => {
    expect(EVIDENCE_FRAMING).toMatch(/evidence|evidence|historical evidence/i);
    expect(EVIDENCE_FRAMING).toMatch(/propaganda/i);
  });

  it('mentions colonial settlement scheme', () => {
    expect(EVIDENCE_FRAMING).toMatch(/colonial[\s\S]*settlement[\s\S]*scheme|colonial settlement/i);
  });
});

describe('assembleColophon', () => {
  // ---------------------------------------------------------------------------
  // Fixtures
  // ---------------------------------------------------------------------------

  const SOURCE_ID = 'PB-P001';
  const ITEM_ID = '1879-08-15_bpt6k56068358';
  const ARCHIVE_REF = 'abc123def456';

  const MACHINE_ASSIST: MachineAssistLabel = {
    engine: 'claude-opus-4',
    model: 'claude-opus-4-20250514',
    retrieved: '2026-01-15',
  };

  // NOTE: `sha256` here is the IMAGE-master checksum (folio sidecar `sha256`),
  // which the Edition builder now feeds from `RawPage.imageSha256` -- NOT the
  // translation-text `provenance.sha256`. assembleColophon itself is agnostic:
  // it records whatever image checksum the builder supplies.
  function makePage(overrides: Partial<ColophonPageInput> = {}): ColophonPageInput {
    const pageId = overrides.pageId ?? 'p001';
    const machineAssist =
      'machineAssist' in overrides
        ? overrides.machineAssist === undefined
          ? MACHINE_ASSIST
          : overrides.machineAssist
        : MACHINE_ASSIST;
    return {
      pageId,
      folioId: overrides.folioId ?? 'f001',
      objectStoreKey: overrides.objectStoreKey ?? `b2://bucket/${pageId}.jpg`,
      sha256: overrides.sha256 ?? `sha256-${pageId}`,
      machineAssist,
    };
  }

  const OCR_TRANSCRIPTION: OcrTranscription = {
    engineStatus: 'tesseract 5 (searchable)',
    caveat: null,
  };

  // Defaults to the FRENCH path (spec-014 shape) so every pre-existing test
  // below is unaffected; English-path tests override `readingLanguage` +
  // `ocrTranscription` explicitly.
  function makeColophonInput(overrides: Partial<ColophonInput> = {}): ColophonInput {
    return {
      sourceId: overrides.sourceId ?? SOURCE_ID,
      itemId: overrides.itemId ?? ITEM_ID,
      archiveRef: overrides.archiveRef ?? ARCHIVE_REF,
      pages: overrides.pages ?? [
        makePage({ pageId: 'p001', folioId: 'f001' }),
        makePage({ pageId: 'p002', folioId: 'f002' }),
      ],
      readingLanguage: overrides.readingLanguage ?? 'french',
      ocrTranscription: overrides.ocrTranscription ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------

  it('assembles colophon metadata with archiveRef, per-image list, and translation label', () => {
    const input = makeColophonInput();

    const colophon = assembleColophon(input);

    expect(colophon.archiveRef).toBe(ARCHIVE_REF);
    expect(colophon.snapshotSourceId).toBe(SOURCE_ID);
    expect(colophon.translation).toBe(MACHINE_ASSIST);
    expect(colophon.framing).toBe(EVIDENCE_FRAMING);
  });

  it('populates images with folioId, objectStoreKey, and sha256 from pages', () => {
    const page1 = makePage({ pageId: 'p001', folioId: 'f001', objectStoreKey: 'key-1', sha256: 'sha-1' });
    const page2 = makePage({ pageId: 'p002', folioId: 'f002', objectStoreKey: 'key-2', sha256: 'sha-2' });
    const input = makeColophonInput({ pages: [page1, page2] });

    const colophon = assembleColophon(input);

    expect(colophon.images).toHaveLength(2);
    expect(colophon.images[0]).toEqual({
      folioId: 'f001',
      objectStoreKey: 'key-1',
      sha256: 'sha-1',
    });
    expect(colophon.images[1]).toEqual({
      folioId: 'f002',
      objectStoreKey: 'key-2',
      sha256: 'sha-2',
    });
  });

  it('uses the first page that carries a machine-assist label as the translation', () => {
    const assist1 = { engine: 'engine-1', model: null, retrieved: '2026-01-15' };
    const assist2 = { engine: 'engine-2', model: null, retrieved: '2026-01-16' };
    const page1 = makePage({ pageId: 'p001', machineAssist: null });
    const page2 = makePage({ pageId: 'p002', machineAssist: assist1 });
    const page3 = makePage({ pageId: 'p003', machineAssist: assist2 });

    const colophon = assembleColophon(makeColophonInput({ pages: [page1, page2, page3] }));

    expect(colophon.translation).toEqual(assist1);
  });

  it('handles a single-page edition', () => {
    const input = makeColophonInput({
      pages: [makePage({ pageId: 'p001', folioId: 'f001' })],
    });

    const colophon = assembleColophon(input);

    expect(colophon.images).toHaveLength(1);
    expect(colophon.images[0].folioId).toBe('f001');
  });

  it('handles many pages', () => {
    const pages = Array.from({ length: 100 }, (_, i) => {
      const num = String(i + 1).padStart(3, '0');
      return makePage({ pageId: `p${num}`, folioId: `f${num}` });
    });

    const colophon = assembleColophon(makeColophonInput({ pages }));

    expect(colophon.images).toHaveLength(100);
  });

  // ---------------------------------------------------------------------------
  // Error cases
  // ---------------------------------------------------------------------------

  it('throws when archiveRef is empty', () => {
    const input = makeColophonInput({ archiveRef: '' });

    expect(() => assembleColophon(input)).toThrow(
      /assembleColophon[\s\S]*archiveRef is empty[\s\S]*pinned archive[\s\S]*reproducible/
    );
  });

  it('throws when archiveRef is whitespace only', () => {
    const input = makeColophonInput({ archiveRef: '   ' });

    expect(() => assembleColophon(input)).toThrow(
      /assembleColophon[\s\S]*archiveRef is empty/
    );
  });

  it('throws when no page carries a machine-assist label (readingLanguage: french, default)', () => {
    const pages = [
      makePage({ pageId: 'p001', machineAssist: null }),
      makePage({ pageId: 'p002', machineAssist: null }),
    ];
    const input = makeColophonInput({ pages });

    expect(() => assembleColophon(input)).toThrow(
      /assembleColophon[\s\S]*no page carries a machine-assist translation[\s\S]*label is mandatory[\s\S]*FR-005/
    );
  });

  it('French source with NO machine-assist label STILL throws (spec-014 safety net intact, spec 015 regression check)', () => {
    // Explicit readingLanguage: 'french' -- the spec-014 mandatory-label gate
    // MUST NOT be weakened by the addition of the English path (FR-013).
    const pages = [
      makePage({ pageId: 'p001', machineAssist: null }),
      makePage({ pageId: 'p002', machineAssist: null }),
    ];
    const input = makeColophonInput({ pages, readingLanguage: 'french' });

    expect(() => assembleColophon(input)).toThrow(
      /assembleColophon[\s\S]*no page carries a machine-assist translation[\s\S]*label is mandatory/
    );
  });

  it('throws with source context (sourceId/itemId) in error message', () => {
    const input = makeColophonInput({
      sourceId: 'MY-SOURCE',
      itemId: 'MY-ITEM',
      archiveRef: '',
    });

    expect(() => assembleColophon(input)).toThrow(/MY-SOURCE\/MY-ITEM/);
  });

  // ---------------------------------------------------------------------------
  // English path (spec 015, FR-013): OCR-transcription disclosure, no
  // machine-assist label required/expected.
  // ---------------------------------------------------------------------------

  it('English source: translation null, ocrTranscription carried through, no machine-assist label required (C6)', () => {
    const pages = [
      makePage({ pageId: 'p001', machineAssist: null }),
      makePage({ pageId: 'p002', machineAssist: null }),
    ];
    const input = makeColophonInput({
      pages,
      readingLanguage: 'english',
      ocrTranscription: OCR_TRANSCRIPTION,
    });

    const colophon = assembleColophon(input);

    expect(colophon.translation).toBeNull();
    expect(colophon.ocrTranscription).toEqual(OCR_TRANSCRIPTION);
    expect(colophon.framing).toBe(EVIDENCE_FRAMING);
  });

  it('English source: a low-fidelity caveat on the OCR-transcription disclosure is carried through (C7 / FR-009)', () => {
    const withCaveat: OcrTranscription = { engineStatus: 'tesseract 5 (searchable)', caveat: 'quality: low' };
    const input = makeColophonInput({
      readingLanguage: 'english',
      ocrTranscription: withCaveat,
    });

    const colophon = assembleColophon(input);

    expect(colophon.ocrTranscription?.caveat).toBe('quality: low');
  });

  it('English source: throws when the OCR-transcription disclosure is missing (no silent empty disclosure, Principle V)', () => {
    const input = makeColophonInput({
      readingLanguage: 'english',
      ocrTranscription: null,
    });

    expect(() => assembleColophon(input)).toThrow(
      /assembleColophon[\s\S]*English source has no OCR-transcription disclosure[\s\S]*mandatory/
    );
  });

  it('English source: throws when the OCR-transcription disclosure has an empty engineStatus', () => {
    const input = makeColophonInput({
      readingLanguage: 'english',
      ocrTranscription: { engineStatus: '   ', caveat: null },
    });

    expect(() => assembleColophon(input)).toThrow(
      /assembleColophon[\s\S]*English source has no OCR-transcription disclosure/
    );
  });
});
