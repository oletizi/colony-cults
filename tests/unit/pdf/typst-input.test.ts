/**
 * Unit tests for `@/pdf/render/typst-input` (specs/007-corpus-print-pdf/
 * contracts/typst-template.md): the `Edition` -> `TypstInput` mapping (G-1
 * facing structure, G-2 machine-derived labeling, G-3 provenance carried) and
 * `serializeTypstInput`'s stable sorted-key serialization (G-4).
 */

import { describe, expect, it } from 'vitest';

import type { ColophonMeta, Edition, EditionPage, TitlePageMeta } from '@/pdf/model';
import type { TypstInput } from '@/pdf/render/typst-input';
import { serializeTypstInput, toTypstInput } from '@/pdf/render/typst-input';

const titlePage: TitlePageMeta = {
  title: 'La Nouvelle France',
  creator: 'Société coloniale',
  date: '1879-08-15',
  rights: 'public-domain',
  ark: 'ark:/12148/x1',
  catalogUrl: 'https://catalogue.example/x1',
};

const colophon: ColophonMeta = {
  archiveRef: 'abc123def456',
  snapshotSourceId: 'PB-P001',
  images: [
    { folioId: 'f001', objectStoreKey: 'pb/p001/f001.jpg', sha256: 'sha-f001' },
    { folioId: 'f002', objectStoreKey: 'pb/p001/f002.jpg', sha256: 'sha-f002' },
  ],
  translation: {
    engine: 'claude-code-cli',
    model: 'claude-opus-4',
    retrieved: '2026-07-01',
  },
  ocrTranscription: null,
  framing: 'This material is propaganda, reproduced here as historical evidence.',
};

/** Builds a two-page fixture Edition; `bytesPathPrefix` simulates a build-temp dir that differs run to run. */
function makeEdition(bytesPathPrefix: string): Edition {
  const page = (n: 1 | 2): EditionPage => ({
    pageId: `p00${n}`,
    folioId: `f00${n}`,
    image: {
      objectStoreKey: `pb/p001/f00${n}.jpg`,
      sha256: `sha-f00${n}`,
      bytesPath: `${bytesPathPrefix}/f00${n}.jpg`,
      provider: 'b2-cdn',
      width: 2400,
      height: 3200,
    },
    ocrFrench: `Texte français page ${n}.`,
    english: `English text page ${n}.`,
    ocrCondition: n === 1 ? null : 'faint print',
  });

  return {
    itemId: 'PB-P001-1879-08-15',
    kind: 'issue',
    titlePage,
    pages: [page(1), page(2)],
    colophon,
  };
}

describe('toTypstInput (G-1 facing structure, G-2 machine-derived labels)', () => {
  it('presents each source page as a verso image + recto {ocrFrench, english}, in page order', () => {
    const edition = makeEdition('/tmp/build-abc');
    const input = toTypstInput(edition, true);

    expect(input.pages).toHaveLength(2);

    expect(input.pages[0].pageId).toBe('p001');
    expect(input.pages[0].folioId).toBe('f001');
    expect(input.pages[0].verso).toEqual({ imagePath: 'f001.jpg', sha256: 'sha-f001' });
    expect(input.pages[0].recto.ocrFrench).toBe('Texte français page 1.');
    expect(input.pages[0].recto.english).toBe('English text page 1.');
    expect(input.pages[0].recto.ocrCondition).toBeNull();

    expect(input.pages[1].pageId).toBe('p002');
    expect(input.pages[1].folioId).toBe('f002');
    expect(input.pages[1].verso).toEqual({ imagePath: 'f002.jpg', sha256: 'sha-f002' });
    expect(input.pages[1].recto.ocrFrench).toBe('Texte français page 2.');
    expect(input.pages[1].recto.english).toBe('English text page 2.');
    expect(input.pages[1].recto.ocrCondition).toBe('faint print');
  });

  it('never splits a page verso/recto across non-facing entries (one TypstPage per source page)', () => {
    const input = toTypstInput(makeEdition('/tmp/build-abc'), true);
    for (const page of input.pages) {
      expect(page.verso).toBeDefined();
      expect(page.recto).toBeDefined();
    }
  });

  it('carries the machine-derived translation label on every recto (G-2, SC-003)', () => {
    const input = toTypstInput(makeEdition('/tmp/build-abc'), true);
    for (const page of input.pages) {
      expect(page.recto.machineAssist).toEqual(colophon.translation);
    }
  });

  it('throws when the Edition has zero pages', () => {
    const edition = makeEdition('/tmp/build-abc');
    edition.pages = [];
    expect(() => toTypstInput(edition, true)).toThrow(/zero pages/);
  });
});

describe('toTypstInput (G-3 title-page + colophon provenance carried verbatim)', () => {
  it('carries titlePage verbatim', () => {
    const input = toTypstInput(makeEdition('/tmp/build-abc'), true);
    expect(input.titlePage).toEqual(titlePage);
  });

  it('carries colophon verbatim', () => {
    const input = toTypstInput(makeEdition('/tmp/build-abc'), true);
    expect(input.colophon).toEqual(colophon);
  });

  it('carries itemId and kind verbatim', () => {
    const input = toTypstInput(makeEdition('/tmp/build-abc'), true);
    expect(input.itemId).toBe('PB-P001-1879-08-15');
    expect(input.kind).toBe('issue');
  });
});

describe('toTypstInput (showFrench recto toggle, DESIGN.md § English-only recto)', () => {
  it('carries showFrench=true (parallel FR|EN study recto) verbatim', () => {
    const input = toTypstInput(makeEdition('/tmp/build-abc'), true);
    expect(input.showFrench).toBe(true);
  });

  it('carries showFrench=false (English-only reading recto) verbatim', () => {
    const input = toTypstInput(makeEdition('/tmp/build-abc'), false);
    expect(input.showFrench).toBe(false);
  });

  it('keeps recto.ocrFrench on every page regardless of mode (render toggle only)', () => {
    // English-only is a RENDER toggle -- the FR text is still carried in the
    // data (harmless when unused); the template branches on showFrench.
    const input = toTypstInput(makeEdition('/tmp/build-abc'), false);
    for (const page of input.pages) {
      expect(page.recto.ocrFrench.length).toBeGreaterThan(0);
    }
  });

  it('serializes showFrench stably (present in the sorted-key output)', () => {
    const on = serializeTypstInput(toTypstInput(makeEdition('/tmp/build-abc'), true));
    const off = serializeTypstInput(toTypstInput(makeEdition('/tmp/build-abc'), false));
    expect(on).toContain('"showFrench": true');
    expect(off).toContain('"showFrench": false');
    // Byte-stable across repeated calls at the same mode.
    expect(serializeTypstInput(toTypstInput(makeEdition('/tmp/build-abc'), false))).toBe(off);
  });
});

describe('serializeTypstInput (G-4 stable serialization)', () => {
  it('is byte-identical across two calls on the same Edition', () => {
    const edition = makeEdition('/tmp/build-abc');
    const first = serializeTypstInput(toTypstInput(edition, true));
    const second = serializeTypstInput(toTypstInput(edition, true));
    expect(first).toBe(second);
  });

  it('is byte-identical for two structurally-equal Editions built from different temp dirs', () => {
    // Simulates two separate build runs of the same source: the image
    // bytesPath differs (mkdtemp gives a fresh directory each run) but every
    // other field is identical -- the serialized TypstInput must not leak
    // that volatility (a precondition for reproducible PDFs, SC-004).
    const runA = serializeTypstInput(toTypstInput(makeEdition('/tmp/build-run-a-xyz123'), true));
    const runB = serializeTypstInput(toTypstInput(makeEdition('/tmp/build-run-b-qrs789'), true));
    expect(runA).toBe(runB);
  });

  it('emits sorted object keys regardless of source key insertion order', () => {
    const edition = makeEdition('/tmp/build-abc');
    const json = serializeTypstInput(toTypstInput(edition, true));
    const parsed = JSON.parse(json);
    expect(Object.keys(parsed)).toEqual([
      'colophon',
      'itemId',
      'kind',
      'pages',
      'showFrench',
      'titlePage',
    ]);
  });

  it('round-trips through JSON.parse to a value equal to the mapped TypstInput', () => {
    const edition = makeEdition('/tmp/build-abc');
    const input = toTypstInput(edition, true);
    const json = serializeTypstInput(input);
    expect(JSON.parse(json)).toEqual(input);
  });
});

describe('TypstVerso.segments (spec 017 T006, additive/backward-compatible)', () => {
  it('a verso WITHOUT segments serializes exactly as before (no "segments" key at all)', () => {
    const edition = makeEdition('/tmp/build-abc');
    const input = toTypstInput(edition, true);
    const json = serializeTypstInput(input);

    // toTypstInput does not populate `segments` (T008's job) -- the mapped
    // verso must be the plain two-key shape, and the serialized JSON must not
    // grow a `segments` key that didn't exist before this change.
    for (const page of input.pages) {
      expect(page.verso).toEqual({
        imagePath: expect.stringMatching(/^f\d+\.jpg$/),
        sha256: expect.stringMatching(/^sha-/),
      });
      expect(Object.keys(page.verso)).toEqual(['imagePath', 'sha256']);
    }
    expect(json).not.toContain('segments');
  });

  it('round-trips an ordered segments list through serializeTypstInput when present', () => {
    const edition = makeEdition('/tmp/build-abc');
    const input = toTypstInput(edition, true);

    // Simulate what T008 will do: attach an ordered segment list to one
    // page's verso. `segments` is optional on TypstVerso -- this is purely a
    // data-shape/round-trip check, not a claim about toTypstInput's mapping.
    const withSegments: TypstInput = {
      ...input,
      pages: input.pages.map((page, i) =>
        i === 0
          ? {
              ...page,
              verso: {
                ...page.verso,
                segments: [
                  { imagePath: 'f001-seg1.jpg', sha256: 'sha-seg1' },
                  { imagePath: 'f001-seg2.jpg', sha256: 'sha-seg2' },
                  { imagePath: 'f001-seg3.jpg', sha256: 'sha-seg3' },
                ],
              },
            }
          : page
      ),
    };

    const json = serializeTypstInput(withSegments);
    const parsed = JSON.parse(json) as TypstInput;

    expect(parsed.pages[0].verso.segments).toEqual([
      { imagePath: 'f001-seg1.jpg', sha256: 'sha-seg1' },
      { imagePath: 'f001-seg2.jpg', sha256: 'sha-seg2' },
      { imagePath: 'f001-seg3.jpg', sha256: 'sha-seg3' },
    ]);
    // Order preserved verbatim (ascending `sequence`, G-1/G-4) and the page
    // without segments is untouched.
    expect(parsed.pages[1].verso).toEqual(input.pages[1].verso);
    // Byte-identical across repeated calls (G-4).
    expect(serializeTypstInput(withSegments)).toBe(json);
  });
});
