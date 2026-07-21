import { describe, it, expect } from 'vitest';
import { buildSearchDocuments } from '@/browser/search/documents';
import type { CorpusView, PageView, ProvenanceRecord } from '@/browser/model';

/**
 * `buildSearchDocuments` turns a `CorpusView` into one `SearchDocument` per
 * page (search-document contract; data-model.md SearchDocument). These tests
 * build a small synthetic `CorpusView` in-test -- no dependency on the real
 * archive clone or the corpus loader.
 */

const PROVENANCE: ProvenanceRecord = {
  sourceId: 'PB-P001',
  ark: 'ark:/12148/bpt6k56068358',
  date: '1879-08-15',
  rights: 'public-domain',
  page: 'p001',
  sha256: 'e2fac2bd47f230eadb4d85b233f868ab888229cb7e67bf83ef36bf55a18c34a3',
};

function makePage(overrides: Partial<PageView> & Pick<PageView, 'pageId'>): PageView {
  return {
    folioId: 'f001',
    image: { kind: 'full-image', url: 'https://example.test/image.jpg' },
    ocrFrench: 'OCR brut.',
    correctedFrench: null,
    english: 'English text.',
    provenance: { ...PROVENANCE, page: overrides.pageId },
    ocrCondition: null,
    ...overrides,
  };
}

function makeCorpus(): CorpusView {
  return {
    sources: [
      {
        sourceId: 'PB-P001',
        title: 'Le Petit Bonapartiste',
        kind: 'periodical',
        language: 'French',
        ark: 'ark:/12148/bpt6k56068358',
        rights: 'public-domain',
        issues: [
          {
            issueId: '1879-08-15_bpt6k56068358',
            date: '1879-08-15',
            sequence: 1,
            pageCount: 2,
            pages: [
              makePage({
                pageId: 'p001',
                ocrFrench: 'Texte OCR brut un.',
                correctedFrench: 'Texte corrigé un.',
                english: 'Corrected text one.',
              }),
              makePage({
                pageId: 'p002',
                ocrFrench: 'Texte OCR brut deux.',
                correctedFrench: null,
                english: 'Corrected text two.',
              }),
            ],
          },
        ],
      },
    ],
  };
}

describe('buildSearchDocuments', () => {
  it('returns one SearchDocument per page across all sources/issues/pages', () => {
    const docs = buildSearchDocuments(makeCorpus());

    expect(docs).toHaveLength(2);
  });

  it('builds the correct routeUrl, ids, and french/english text for a page with corrected French', () => {
    const [first] = buildSearchDocuments(makeCorpus());

    expect(first).toEqual({
      pageId: 'p001',
      issueId: '1879-08-15_bpt6k56068358',
      sourceId: 'PB-P001',
      routeUrl: '/sources/PB-P001/issues/1879-08-15_bpt6k56068358/pages/p001/',
      french: expect.stringContaining('Texte OCR brut un.'),
      english: 'Corrected text one.',
    });
    expect(first.french).toContain('Texte corrigé un.');
  });

  it('includes the raw OCR in french when correctedFrench is null, without crashing or emitting the literal "null"', () => {
    const [, second] = buildSearchDocuments(makeCorpus());

    expect(second.pageId).toBe('p002');
    expect(second.french).toContain('Texte OCR brut deux.');
    expect(second.french).not.toContain('null');
  });

  it('gives every doc a routeUrl that starts with /sources/ and ends with /', () => {
    const docs = buildSearchDocuments(makeCorpus());

    for (const doc of docs) {
      expect(doc.routeUrl.startsWith('/sources/')).toBe(true);
      expect(doc.routeUrl.endsWith('/')).toBe(true);
    }
  });

  it('preserves corpus order (source -> issue -> page) deterministically', () => {
    const docs = buildSearchDocuments(makeCorpus());

    expect(docs.map((doc) => doc.pageId)).toEqual(['p001', 'p002']);
  });
});
