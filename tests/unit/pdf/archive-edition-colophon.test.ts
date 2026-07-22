import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeFixtureArchive } from './archive-fixture';
import { SOURCE_CASE, SOURCE_ID, SOURCE_SLUG, buildFrom, readerFor } from './archive-edition-helpers';

// This file covers the colophon / OCR-transcription DISCLOSURE derivation
// tests -- base disclosure (C6/C7), worst-across-folios caveat aggregation
// (AUDIT-01), and blank-recto exclusion from both the representative
// engineStatus and the worstCaveat channels (AUDIT-09/13), plus the
// malformed-provenance fail-loud case. The base Edition-assembly / shape /
// T014 end-to-end pipeline tests live in the sibling `archive-edition.test.ts`
// -- split out of that originally combined file to stay under the govern
// line-count / byte-size caps.

describe('makeArchiveEditionReader', () => {
  // ---------------------------------------------------------------------------
  // English colophon (spec 015, FR-013): OCR-transcription disclosure, no
  // machine-assist label (C6); low-fidelity caveat surfaces (C7 / FR-009).
  // ---------------------------------------------------------------------------

  it('English source: colophon carries an OCR-transcription disclosure, translation/machineAssist null, no OCR-transcription caveat (C6)', async () => {
    const fixture = await writeFixtureArchive({
      case: SOURCE_CASE,
      slug: SOURCE_SLUG,
      pageCount: 3,
      language: 'English',
      omitTranslationDir: true,
    });
    try {
      const edition = await buildFrom(fixture);

      expect(edition.colophon.translation).toBeNull();
      expect(edition.colophon.ocrTranscription).not.toBeNull();
      expect(edition.colophon.ocrTranscription?.engineStatus).toBe('tesseract 5 (searchable)');
      expect(edition.colophon.ocrTranscription?.caveat).toBeNull();

      // The per-page reading recto is the English OCR; no translation was read.
      for (const page of edition.pages) {
        expect(page.english.length).toBeGreaterThan(0);
        expect(page.ocrFrench).toBe('');
      }
    } finally {
      fixture.cleanup();
    }
  });

  it('English source with a sub-high OCR quality tier: the colophon disclosure carries the low-fidelity caveat (C7, FR-009)', async () => {
    const fixture = await writeFixtureArchive({
      case: SOURCE_CASE,
      slug: SOURCE_SLUG,
      pageCount: 1,
      language: 'English',
      omitTranslationDir: true,
      pages: [
        {
          ocrQuality: { method: 'aspell-realword-ratio-v1', language: 'en', ratio: 0.4, tier: 'low' },
        },
      ],
    });
    try {
      const edition = await buildFrom(fixture);

      expect(edition.colophon.ocrTranscription).not.toBeNull();
      expect(edition.colophon.ocrTranscription?.caveat).toBe('quality: low');
    } finally {
      fixture.cleanup();
    }
  });

  // ---------------------------------------------------------------------------
  // AUDIT-20260719-01 (HIGH, govern finding): the edition-level OCR-transcription
  // caveat MUST reflect the WORST OCR condition across ALL of the edition's
  // folios, not just the lead folio -- a clean lead with a sub-high (or failed)
  // LATER folio must still disclose that gap (Constitution I/III, evidence
  // honesty).
  // ---------------------------------------------------------------------------

  it('English source: a clean LEAD folio with a sub-high LATER folio still surfaces the worst caveat (AUDIT-20260719-01)', async () => {
    const fixture = await writeFixtureArchive({
      case: SOURCE_CASE,
      slug: SOURCE_SLUG,
      pageCount: 3,
      language: 'English',
      omitTranslationDir: true,
      pages: [
        {},
        {},
        {
          ocrQuality: { method: 'aspell-realword-ratio-v1', language: 'en', ratio: 0.4, tier: 'low' },
        },
      ],
    });
    try {
      const edition = await buildFrom(fixture);

      // The LEAD folio (page 1) is clean -- pre-fix, lead-only derivation
      // would render no caveat here even though page 3 is sub-high.
      expect(edition.colophon.ocrTranscription).not.toBeNull();
      expect(edition.colophon.ocrTranscription?.caveat).toBe('quality: low');
    } finally {
      fixture.cleanup();
    }
  });

  it('English source: every folio clean surfaces NO caveat (worst-of-all-clean is null)', async () => {
    const fixture = await writeFixtureArchive({
      case: SOURCE_CASE,
      slug: SOURCE_SLUG,
      pageCount: 4,
      language: 'English',
      omitTranslationDir: true,
      pages: [{}, {}, {}, {}],
    });
    try {
      const edition = await buildFrom(fixture);

      expect(edition.colophon.ocrTranscription).not.toBeNull();
      expect(edition.colophon.ocrTranscription?.caveat).toBeNull();
    } finally {
      fixture.cleanup();
    }
  });

  it('English source: ocr_status "failed" on a LATER folio surfaces the worst caveat', async () => {
    const fixture = await writeFixtureArchive({
      case: SOURCE_CASE,
      slug: SOURCE_SLUG,
      pageCount: 2,
      language: 'English',
      omitTranslationDir: true,
      pages: [{}, { ocrStatus: 'failed' }],
    });
    try {
      const edition = await buildFrom(fixture);

      expect(edition.colophon.ocrTranscription).not.toBeNull();
      expect(edition.colophon.ocrTranscription?.caveat).toBe('status: failed');
    } finally {
      fixture.cleanup();
    }
  });

  it('English source: a failed folio outranks a merely sub-high folio (severity ordering)', async () => {
    const fixture = await writeFixtureArchive({
      case: SOURCE_CASE,
      slug: SOURCE_SLUG,
      pageCount: 3,
      language: 'English',
      omitTranslationDir: true,
      pages: [
        {
          ocrQuality: { method: 'aspell-realword-ratio-v1', language: 'en', ratio: 0.6, tier: 'medium' },
        },
        { ocrStatus: 'failed' },
        {
          ocrQuality: { method: 'aspell-realword-ratio-v1', language: 'en', ratio: 0.4, tier: 'low' },
        },
      ],
    });
    try {
      const edition = await buildFrom(fixture);

      // failed (severity 3) outranks both medium (1) and low (2).
      expect(edition.colophon.ocrTranscription?.caveat).toBe('status: failed');
    } finally {
      fixture.cleanup();
    }
  });

  it('English source: a single-folio edition still works (worst-of-one)', async () => {
    const fixture = await writeFixtureArchive({
      case: SOURCE_CASE,
      slug: SOURCE_SLUG,
      pageCount: 1,
      language: 'English',
      omitTranslationDir: true,
    });
    try {
      const edition = await buildFrom(fixture);

      expect(edition.colophon.ocrTranscription).not.toBeNull();
      expect(edition.colophon.ocrTranscription?.caveat).toBeNull();
    } finally {
      fixture.cleanup();
    }
  });

  // ---------------------------------------------------------------------------
  // AUDIT-20260719-09 (HIGH, govern finding): the edition-level `engineStatus`
  // MUST be derived from a REPRESENTATIVE (non-blank_recto) folio, not the raw
  // lead folio -- T015's blank/plate marker lets an English edition's FIRST
  // folio be an intentionally-blank cover/plate, so the lead's own ocr_status
  // can be unrepresentative of the edition even though later folios carry the
  // real English OCR.
  // ---------------------------------------------------------------------------

  it('English source: a blank_recto LEAD folio does not leak its own ocr_status into the edition engineStatus (AUDIT-20260719-09)', async () => {
    const fixture = await writeFixtureArchive({
      case: SOURCE_CASE,
      slug: SOURCE_SLUG,
      pageCount: 3,
      language: 'English',
      omitTranslationDir: true,
      pages: [
        // Blank cover/plate: no real OCR was attempted -- its own ocr_status
        // ("none") must NOT become the edition-level engineStatus.
        { blankRecto: true, ocrFrench: '', ocrStatus: 'none' },
        {}, // real English OCR, default ocr_status "searchable"
        {},
      ],
    });
    try {
      const edition = await buildFrom(fixture);

      expect(edition.colophon.ocrTranscription).not.toBeNull();
      // The REPRESENTATIVE (first non-blank) folio's status, NOT the blank
      // lead folio's "none".
      expect(edition.colophon.ocrTranscription?.engineStatus).toBe('tesseract 5 (searchable)');
    } finally {
      fixture.cleanup();
    }
  });

  // ---------------------------------------------------------------------------
  // AUDIT-20260719-13 (HIGH, govern finding): a `blank_recto`-marked folio's
  // OWN ocr_status/ocr_quality must NOT leak into the edition-level
  // `worstCaveat` either -- the AUDIT-09 fix guarded only `representativeStatus`
  // (the engineStatus channel); this pins the sibling `worst`/caveat channel.
  // ---------------------------------------------------------------------------

  it('English source: a blank_recto folio with ocr_status "failed" does NOT poison worstCaveat alongside clean content folios (AUDIT-20260719-13)', async () => {
    const fixture = await writeFixtureArchive({
      case: SOURCE_CASE,
      slug: SOURCE_SLUG,
      pageCount: 3,
      language: 'English',
      omitTranslationDir: true,
      pages: [
        {}, // clean content folio, representative lead
        // Blank plate whose sidecar happens to record a "failed" OCR status --
        // must NOT become the edition's worstCaveat.
        { blankRecto: true, ocrFrench: '', ocrStatus: 'failed' },
        {}, // clean content folio
      ],
    });
    try {
      const edition = await buildFrom(fixture);

      expect(edition.colophon.ocrTranscription).not.toBeNull();
      expect(edition.colophon.ocrTranscription?.caveat).toBeNull();
      // Sanity: the representative engineStatus is still the clean lead's.
      expect(edition.colophon.ocrTranscription?.engineStatus).toBe('tesseract 5 (searchable)');
    } finally {
      fixture.cleanup();
    }
  });

  it('English source: a blank_recto folio with ocr_quality.tier "low" does NOT poison worstCaveat alongside clean content folios (AUDIT-20260719-13)', async () => {
    const fixture = await writeFixtureArchive({
      case: SOURCE_CASE,
      slug: SOURCE_SLUG,
      pageCount: 3,
      language: 'English',
      omitTranslationDir: true,
      pages: [
        {},
        {
          blankRecto: true,
          ocrFrench: '',
          ocrQuality: { method: 'aspell-realword-ratio-v1', language: 'en', ratio: 0.4, tier: 'low' },
        },
        {},
      ],
    });
    try {
      const edition = await buildFrom(fixture);

      expect(edition.colophon.ocrTranscription).not.toBeNull();
      expect(edition.colophon.ocrTranscription?.caveat).toBeNull();
    } finally {
      fixture.cleanup();
    }
  });

  it('fails loud (does not silently skip) when a non-lead folio has a malformed OCR provenance sidecar', async () => {
    const fixture = await writeFixtureArchive({
      case: SOURCE_CASE,
      slug: SOURCE_SLUG,
      pageCount: 2,
      language: 'English',
      omitTranslationDir: true,
    });
    try {
      const { writeFile } = await import('node:fs/promises');
      // Corrupt the SECOND folio's sidecar (still enumerated -- the folio
      // list is driven by the sidecar filename existing at all, so this
      // preserves the 2-folio shape while making that one unreadable). The
      // lead (first) folio is fine, so a lead-only reader would never
      // notice; the worst-across-folios aggregation must still attempt to
      // read it and fail loud rather than silently treating an unreadable
      // folio as clean.
      await writeFile(path.join(fixture.sourceDir, 'f002.yml'), 'id: "not-valid-provenance"\n');

      await expect(readerFor(fixture.archiveRoot).build(SOURCE_ID, SOURCE_ID)).rejects.toThrow(
        /missing required field/i,
      );
    } finally {
      fixture.cleanup();
    }
  });
});
