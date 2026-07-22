import { describe, it, expect } from 'vitest';
import { sourceLayout } from '@/archive/location';

/**
 * T002: archive-direct target sources (PB-P054, PB-P055, PB-P002) must all
 * resolve a layout via `sourceLayout(sourceId)` -- each is a monograph filed
 * under `archive/cases/port-breton/books/<slug>/`. Slugs are verified against
 * the archive clone's on-disk directory names (folio sidecar `id:` field).
 */
describe('sourceLayout: archive-direct monograph targets', () => {
  it('resolves PB-P054 (Cour de cassation extract)', () => {
    expect(sourceLayout('PB-P054')).toEqual({
      case: 'port-breton',
      type: 'books',
      slug: 'cour-de-cassation-chambre-criminelle-arret-de-rejet-du-pourvoi-de-charles',
      kind: 'monograph',
    });
  });

  it('resolves PB-P055 (de Groote 1880 book)', () => {
    expect(sourceLayout('PB-P055')).toEqual({
      case: 'port-breton',
      type: 'books',
      slug: 'nouvelle-france-colonie-libre-de-port-breton-oceanie-uvre-de-colonisation',
      kind: 'monograph',
    });
  });

  it('resolves PB-P002 (Nouvelle France colonie libre)', () => {
    expect(sourceLayout('PB-P002')).toEqual({
      case: 'port-breton',
      type: 'books',
      slug: 'nouvelle-france-colonie-libre-port-breton',
      kind: 'monograph',
    });
  });

  it('fails loud for an unknown/unregistered source', () => {
    expect(() => sourceLayout('PB-P999-DOES-NOT-EXIST')).toThrow(
      /no archive layout registered/,
    );
  });
});
