import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { Edition } from '@/pdf/model';
import type { SourceCatalogMeta, SourceMetaReader } from '@/pdf/load/source-meta';
import type { ArchivePinReader } from '@/pdf/load/edition';
import { makeArchiveEditionReader } from '@/pdf/load/archive-edition';

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
});
