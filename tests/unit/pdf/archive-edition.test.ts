import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { Edition } from '@/pdf/model';
import type { SourceCatalogMeta, SourceMetaReader } from '@/pdf/load/source-meta';
import type { ArchivePinReader } from '@/pdf/load/edition';
import { makeArchiveEditionReader } from '@/pdf/load/archive-edition';
import { serializeTypstInput, toTypstInput } from '@/pdf/render/typst-input';

import { writeFixtureArchive } from './archive-fixture';
import type { WriteFixtureArchiveResult } from './archive-fixture';

// The real repo root -- so the reader's `loadSourceFile` resolves the committed
// `bibliography/sources/PB-P002.yml` SSOT (canonical title + affirmative
// public-domain rights). The archive bytes come from a fresh temp fixture; only
// the source record is read from the repo. From tests/unit/pdf/ up 3 = repo root.
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

// PB-P002 is a monograph registered in `@/archive/location`'s static layout
// (case port-breton / type books / slug below), so `resolveArchiveSource`
// resolves the fixture without any test-only registry mutation.
const SOURCE_ID = 'PB-P002';
const SOURCE_CASE = 'port-breton';
const SOURCE_SLUG = 'nouvelle-france-colonie-libre-port-breton';
const CANONICAL_TITLE = 'Colonie libre de Port-Breton : Nouvelle France en Océanie';
const PIN_REF = 'pinref-abc123';

const META: SourceCatalogMeta = {
  creator: 'Charles Du Breil de Rays',
  catalogUrl: 'https://catalogue.bnf.fr/ark:/12148/cb34139872z',
  ark: 'ark:/12148/source-ark',
};

function sourceMetaOf(meta: SourceCatalogMeta): SourceMetaReader {
  return { read: () => meta };
}

function pinReaderOf(ref: string): ArchivePinReader {
  return { read: () => ref };
}

function readerFor(archiveRoot: string) {
  return makeArchiveEditionReader({
    archiveRoot,
    repoRoot: REPO_ROOT,
    sourceMeta: sourceMetaOf(META),
    pin: pinReaderOf(PIN_REF),
  });
}

async function buildFrom(fixture: WriteFixtureArchiveResult): Promise<Edition> {
  return readerFor(fixture.archiveRoot).build(SOURCE_ID, SOURCE_ID);
}

describe('makeArchiveEditionReader', () => {
  it('assembles a well-formed Edition directly from the archive', async () => {
    const fixture = await writeFixtureArchive({
      case: SOURCE_CASE,
      slug: SOURCE_SLUG,
      pageCount: 3,
    });
    try {
      const edition = await buildFrom(fixture);

      // Ordered pages, extract-relative page ids, folio ids in order.
      expect(edition.itemId).toBe(SOURCE_ID);
      expect(edition.kind).toBe('monograph');
      expect(edition.pages).toHaveLength(3);
      expect(edition.pages.map((p) => p.pageId)).toEqual(['p001', 'p002', 'p003']);
      expect(edition.pages.map((p) => p.folioId)).toEqual(['f001', 'f002', 'f003']);

      // Every page's image is a b2 fetch-input with the staging bytesPath marker.
      for (const page of edition.pages) {
        expect(page.image.objectStoreKey.length).toBeGreaterThan(0);
        expect(page.image.sha256.length).toBeGreaterThan(0);
        expect(page.image.bytesPath).toBe('');
        expect(page.image.provider).toBe('b2-cdn');
        expect(page.image.width).toBeNull();
        expect(page.image.height).toBeNull();
        expect(page.ocrFrench.length).toBeGreaterThan(0);
        expect(page.english.length).toBeGreaterThan(0);
      }

      // Title page: title + rights from the SSOT; creator/catalogUrl/ark from meta.
      expect(edition.titlePage.title).toBe(CANONICAL_TITLE);
      expect(edition.titlePage.rights).toBe('public-domain');
      expect(edition.titlePage.creator).toBe(META.creator);
      expect(edition.titlePage.catalogUrl).toBe(META.catalogUrl);
      expect(edition.titlePage.ark).toBe(META.ark);
      expect(edition.titlePage.date.length).toBeGreaterThan(0);

      // Colophon: injected pin ref + per-image list + a machine-assist label
      // (French source -- ocrTranscription null, spec 015 FR-013).
      expect(edition.colophon.archiveRef).toBe(PIN_REF);
      expect(edition.colophon.snapshotSourceId).toBe(SOURCE_ID);
      expect(edition.colophon.images).toHaveLength(3);
      expect(edition.colophon.translation).not.toBeNull();
      expect(edition.colophon.translation?.engine).toBe('claude-code-cli');
      expect(edition.colophon.translation?.retrieved.length).toBeGreaterThan(0);
      expect(edition.colophon.ocrTranscription).toBeNull();
      expect(edition.colophon.framing.length).toBeGreaterThan(0);
    } finally {
      fixture.cleanup();
    }
  });

  it('carries an untranslatable page through with english === "" (no fail-loud)', async () => {
    const fixture = await writeFixtureArchive({
      case: SOURCE_CASE,
      slug: SOURCE_SLUG,
      pageCount: 3,
      pages: [{}, { translationLabel: 'untranslatable' }, {}],
    });
    try {
      const edition = await buildFrom(fixture);
      expect(edition.pages).toHaveLength(3);
      expect(edition.pages[1].english).toBe('');
      // The surrounding machine-assisted pages still carry their english.
      expect(edition.pages[0].english.length).toBeGreaterThan(0);
      expect(edition.pages[2].english.length).toBeGreaterThan(0);
    } finally {
      fixture.cleanup();
    }
  });

  it('produces pages with NO ark and an Edition matching @/pdf/model exactly', async () => {
    const fixture = await writeFixtureArchive({
      case: SOURCE_CASE,
      slug: SOURCE_SLUG,
      pageCount: 1,
    });
    try {
      const edition = await buildFrom(fixture);

      // The reader is archive-direct: pages carry no ark (image is object_store).
      expect('ark' in edition.pages[0]).toBe(false);

      // Exact shape parity with the @/pdf/model view-model.
      expect(Object.keys(edition).sort()).toEqual(
        ['colophon', 'itemId', 'kind', 'pages', 'titlePage'].sort(),
      );
      expect(Object.keys(edition.titlePage).sort()).toEqual(
        ['ark', 'catalogUrl', 'creator', 'date', 'rights', 'title'].sort(),
      );
      expect(Object.keys(edition.pages[0]).sort()).toEqual(
        ['english', 'folioId', 'image', 'ocrCondition', 'ocrFrench', 'pageId'].sort(),
      );
      expect(Object.keys(edition.pages[0].image).sort()).toEqual(
        ['bytesPath', 'height', 'objectStoreKey', 'provider', 'sha256', 'width'].sort(),
      );
      expect(Object.keys(edition.colophon).sort()).toEqual(
        ['archiveRef', 'framing', 'images', 'ocrTranscription', 'snapshotSourceId', 'translation'].sort(),
      );
    } finally {
      fixture.cleanup();
    }
  });

  it('fails loud when the requested periodical/monograph item is not resolvable', async () => {
    const fixture = await writeFixtureArchive({
      case: SOURCE_CASE,
      slug: SOURCE_SLUG,
      pageCount: 1,
    });
    try {
      // A monograph is built as a whole: itemId must equal the source id.
      await expect(
        readerFor(fixture.archiveRoot).build(SOURCE_ID, 'not-the-source'),
      ).rejects.toThrow(/not-the-source|source id/i);
    } finally {
      fixture.cleanup();
    }
  });

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

// ---------------------------------------------------------------------------
// T014 (spec 015, US1+US3): English end-to-end integration --
// makeArchiveEditionReader(...).build() -> toTypstInput(edition, false) ->
// serializeTypstInput(...). Proves the full English-source pipeline, not just
// `build()` in isolation: the reading recto is populated from the resolved
// English OCR (C2), and the honest colophon (no machine-assist label, an
// OCR-transcription disclosure instead) survives the Typst-input mapping and
// deterministic serialization (C6/C7). Reuses this file's English fixture
// options (`language: 'English'`, `omitTranslationDir: true`) and its
// `readerFor`/`buildFrom` helpers -- no new fixture plumbing.
// ---------------------------------------------------------------------------

describe('English source end-to-end: build() -> toTypstInput(showFrench=false) -> serializeTypstInput() (T014)', () => {
  it('builds without throwing and the english-only recto carries the resolved English OCR at every page (C1, C2)', async () => {
    const fixture = await writeFixtureArchive({
      case: SOURCE_CASE,
      slug: SOURCE_SLUG,
      pageCount: 3,
      language: 'English',
      omitTranslationDir: true,
    });
    try {
      // C1: build() RESOLVES for an English source with no machine-assist
      // label anywhere in the archive -- pre-feature, assembleColophon threw
      // unconditionally when no page carried one.
      const edition = await buildFrom(fixture);
      expect(edition.pages).toHaveLength(3);

      const typstInput = toTypstInput(edition, false);
      expect(typstInput.showFrench).toBe(false);
      expect(typstInput.pages).toHaveLength(3);

      typstInput.pages.forEach((typstPage, index) => {
        const sourcePage = edition.pages[index];
        expect(sourcePage).toBeDefined();
        if (sourcePage === undefined) {
          throw new Error(`test: edition.pages[${index}] unexpectedly missing`);
        }

        // C2: the english-only variant's reading column is the page's
        // resolved positional OCR text, carried verbatim from the Edition
        // (the load-bearing placement: `english`, not `ocrFrench`).
        expect(typstPage.recto.english).toBe(sourcePage.english);
        expect(typstPage.recto.english.length).toBeGreaterThan(0);
        expect(typstPage.recto.english).toContain(`page 00${index + 1}`);

        // No French OCR on this path (Edition.pages[i].ocrFrench === '');
        // carried through as "" -- harmless, never rendered in this mode.
        expect(typstPage.recto.ocrFrench).toBe('');

        // No machine-assist label for an English-source edition.
        expect(typstPage.recto.machineAssist).toBeNull();
      });
    } finally {
      fixture.cleanup();
    }
  });

  it('serializes an honest colophon: translation null, an OCR-transcription disclosure present, no machine-assist label anywhere (C6)', async () => {
    const fixture = await writeFixtureArchive({
      case: SOURCE_CASE,
      slug: SOURCE_SLUG,
      pageCount: 2,
      language: 'English',
      omitTranslationDir: true,
    });
    try {
      const edition = await buildFrom(fixture);
      const typstInput = toTypstInput(edition, false);
      const serialized = serializeTypstInput(typstInput);
      const parsed: unknown = JSON.parse(serialized);

      expect(parsed).toMatchObject({
        colophon: {
          translation: null,
          ocrTranscription: {
            engineStatus: 'tesseract 5 (searchable)',
            caveat: null,
          },
        },
      });

      // Deterministic: two serializations of the same TypstInput are
      // byte-identical (mirrors the real-snapshot integration test's check).
      const again = serializeTypstInput(toTypstInput(edition, false));
      expect(serialized).toBe(again);
    } finally {
      fixture.cleanup();
    }
  });

  it('a sub-high OCR quality tier surfaces its low-fidelity caveat through serialization (C7)', async () => {
    const fixture = await writeFixtureArchive({
      case: SOURCE_CASE,
      slug: SOURCE_SLUG,
      pageCount: 1,
      language: 'English',
      omitTranslationDir: true,
      pages: [
        { ocrQuality: { method: 'aspell-realword-ratio-v1', language: 'en', ratio: 0.4, tier: 'low' } },
      ],
    });
    try {
      const edition = await buildFrom(fixture);
      const typstInput = toTypstInput(edition, false);
      const parsed: unknown = JSON.parse(serializeTypstInput(typstInput));

      expect(parsed).toMatchObject({
        colophon: {
          translation: null,
          ocrTranscription: { caveat: 'quality: low' },
        },
      });
    } finally {
      fixture.cleanup();
    }
  });

  it('French contrast: a French source serializes with a machine-assist label and no OCR-transcription disclosure', async () => {
    // Default fixture language is French (no `language`/`omitTranslationDir`
    // override) -- reuses the same fixture helper the file's first test uses,
    // routed here through toTypstInput/serializeTypstInput instead of
    // asserting on the Edition alone.
    const fixture = await writeFixtureArchive({
      case: SOURCE_CASE,
      slug: SOURCE_SLUG,
      pageCount: 2,
    });
    try {
      const edition = await buildFrom(fixture);
      const typstInput = toTypstInput(edition, true);
      const parsed: unknown = JSON.parse(serializeTypstInput(typstInput));

      expect(parsed).toMatchObject({
        colophon: {
          ocrTranscription: null,
        },
      });
      expect(typstInput.colophon.translation).not.toBeNull();
      expect(typstInput.pages[0].recto.machineAssist).toEqual(typstInput.colophon.translation);
    } finally {
      fixture.cleanup();
    }
  });
});
