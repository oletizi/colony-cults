import { describe, expect, it } from 'vitest';

import { serializeTypstInput, toTypstInput } from '@/pdf/render/typst-input';

import { writeFixtureArchive } from './archive-fixture';
import {
  SOURCE_CASE,
  SOURCE_ID,
  SOURCE_SLUG,
  CANONICAL_TITLE,
  META,
  PIN_REF,
  buildFrom,
  readerFor,
} from './archive-edition-helpers';

// This file covers the base Edition-ASSEMBLY / shape / fail-loud tests, plus
// the T014 end-to-end pipeline (build() -> toTypstInput() ->
// serializeTypstInput()). The colophon / OCR-transcription DISCLOSURE and
// blank-recto/caveat-derivation tests (C6/C7, AUDIT-01/09/13) live in the
// sibling `archive-edition-colophon.test.ts` -- split out of this originally
// combined file to stay under the govern line-count / byte-size caps.

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
