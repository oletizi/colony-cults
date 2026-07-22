import { describe, it, expect } from 'vitest';
import type { Source } from '@/model/source';
import { deriveSourceLayout, registerSourceLayout, sourceLayout } from '@/archive/location';

/**
 * Tests for the runtime archive-layout overlay (`registerSourceLayout` /
 * `sourceLayout`) and `deriveSourceLayout` -- the gap-fix that lets a
 * source-group member (created by `bib inventory`, never hand-added to the
 * static `SOURCE_LAYOUTS` registry) still resolve an archive layout when
 * `bib acquire` drives it through the shipped fetcher.
 */

function member(overrides: Partial<Source> = {}): Source {
  return {
    sourceId: 'PB-P900',
    titles: [{ text: 'Le Petit Journal', role: 'canonical' }],
    kind: 'monograph',
    identifiers: [],
    ...overrides,
  };
}

describe('deriveSourceLayout', () => {
  it('derives type/kind "books"/"monograph" for a monograph source', () => {
    const layout = deriveSourceLayout(member({ kind: 'monograph', case: 'port-breton' }));
    expect(layout.type).toBe('books');
    expect(layout.kind).toBe('monograph');
  });

  it('derives type "newspapers" and kind "periodical" for a STANDALONE periodical source (no partOf)', () => {
    // No `partOf` override here: `member(...)` does not set `partOf` by
    // default, so this is a standalone source -- the ONLY case that keeps
    // `kind: 'periodical'` (it is the only shape a census actually enumerates
    // into dated issue directories).
    const layout = deriveSourceLayout(
      member({ kind: 'periodical', case: 'port-breton', partOf: undefined }),
    );
    expect(layout.type).toBe('newspapers');
    expect(layout.kind).toBe('periodical');
  });

  it('derives kind "monograph" (not "periodical") for a source-group MEMBER, even a periodical one', () => {
    // A source-group member is filed FLAT on disk (f001.yml..fNNN.yml, no
    // dated issue subdirectories) regardless of its bibliographic
    // `Source.kind` -- so `partOf` being set must win over `kind: 'periodical'`
    // for LAYOUT purposes. `type` still reflects the bibliographic kind
    // (newspapers), only the resolution-strategy `kind` flips to monograph.
    const layout = deriveSourceLayout(
      member({ kind: 'periodical', case: 'port-breton', partOf: 'PB-P061' }),
    );
    expect(layout.type).toBe('newspapers');
    expect(layout.kind).toBe('monograph');
  });

  it('uses the source\'s own case when present, ignoring the fallback', () => {
    const layout = deriveSourceLayout(
      member({ case: 'port-breton' }),
      'some-other-case',
    );
    expect(layout.case).toBe('port-breton');
  });

  it('falls back to the given fallback case when the source has none', () => {
    const layout = deriveSourceLayout(member({ case: undefined }), 'port-breton');
    expect(layout.case).toBe('port-breton');
  });

  it('throws when neither the source nor a fallback carries a case', () => {
    expect(() => deriveSourceLayout(member({ case: undefined }))).toThrow(/case/i);
  });

  it('derives a slug from the canonical title: lowercased, non-alnum collapsed to hyphens', () => {
    const layout = deriveSourceLayout(
      member({
        case: 'port-breton',
        titles: [
          { text: 'Some Archive Title', role: 'archive' },
          { text: "L'Aventure de Port-Breton, 1883!", role: 'canonical' },
        ],
      }),
    );
    expect(layout.slug).toBe('l-aventure-de-port-breton-1883');
  });

  it('falls back to the first title when no title is canonical', () => {
    const layout = deriveSourceLayout(
      member({
        case: 'port-breton',
        titles: [{ text: 'Only A Title', role: 'archive' }],
      }),
    );
    expect(layout.slug).toBe('only-a-title');
  });

  it('falls back to the lowercased sourceId when the source has no titles', () => {
    const layout = deriveSourceLayout(
      member({ case: 'port-breton', sourceId: 'PB-P901', titles: [] }),
    );
    expect(layout.slug).toBe('pb-p901');
  });
});

describe('registerSourceLayout / sourceLayout overlay', () => {
  it('resolves a runtime-registered layout for a source absent from the static registry', () => {
    const layout = deriveSourceLayout(member({ sourceId: 'PB-P910', case: 'port-breton' }));
    registerSourceLayout('PB-P910', layout);
    expect(sourceLayout('PB-P910')).toEqual(layout);
  });

  it('is idempotent: re-registering the same id with an equal layout does not throw', () => {
    const layout = deriveSourceLayout(member({ sourceId: 'PB-P911', case: 'port-breton' }));
    registerSourceLayout('PB-P911', layout);
    expect(() => registerSourceLayout('PB-P911', { ...layout })).not.toThrow();
    expect(sourceLayout('PB-P911')).toEqual(layout);
  });

  it('throws on a conflicting re-registration of the same id', () => {
    const layout = deriveSourceLayout(member({ sourceId: 'PB-P912', case: 'port-breton' }));
    registerSourceLayout('PB-P912', layout);
    expect(() =>
      registerSourceLayout('PB-P912', { ...layout, slug: 'a-different-slug' }),
    ).toThrow(/already registered/i);
  });

  it('the static registry always wins over the overlay for the same id', () => {
    // PB-P002 is a real static entry (see SOURCE_LAYOUTS): books/monograph
    // under port-breton with a hand-authored slug. Registering a conflicting
    // overlay entry for it must not change what sourceLayout resolves.
    const conflicting = deriveSourceLayout(
      member({
        sourceId: 'PB-P002',
        case: 'some-other-case',
        kind: 'periodical',
        titles: [{ text: 'A Completely Different Title', role: 'canonical' }],
      }),
    );
    registerSourceLayout('PB-P002', conflicting);
    const resolved = sourceLayout('PB-P002');
    expect(resolved.case).toBe('port-breton');
    expect(resolved.kind).toBe('monograph');
    expect(resolved.slug).toBe('nouvelle-france-colonie-libre-port-breton');
  });

  it('throws for a source registered in neither the static registry nor the overlay', () => {
    expect(() => sourceLayout('PB-P999-not-registered-anywhere')).toThrow(
      /no archive layout registered/i,
    );
  });
});
