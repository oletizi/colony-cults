import { describe, expect, it } from 'vitest';

import type { CorpusSnapshot, MachineAssistLabel, RawIssue, RawPage, RawSource } from '@/browser/model';
import type { SourceCatalogMeta, SourceMetaReader } from '@/pdf/load/source-meta';
import type { ArchivePinReader, CorpusSnapshotReader } from '@/pdf/load/edition';
import { makeEditionBuilder } from '@/pdf/load/edition';

// ---------------------------------------------------------------------------
// Fixtures: a small in-memory snapshot + stub readers so the unit test needs
// no archive/network/filesystem. Every fake is a pure lookup over an object.
// ---------------------------------------------------------------------------

const SOURCE_ID = 'PB-P001';
const ISSUE_ID = '1879-08-15_bpt6k56068358';
const PIN_REF = 'abc123def456';

const MACHINE_ASSIST: MachineAssistLabel = {
  engine: 'claude-code-cli',
  model: 'claude-opus-4',
  retrieved: '2026-01-15',
};

function makePage(overrides: Partial<RawPage> = {}): RawPage {
  const pageId = overrides.pageId ?? 'p001';
  return {
    pageId,
    folioId: overrides.folioId ?? 'f001',
    ark: overrides.ark ?? 'ark:/12148/bpt6k56068358',
    objectStoreKey:
      overrides.objectStoreKey === undefined ? `object_store/${pageId}.jpg` : overrides.objectStoreKey,
    ocrFrench: overrides.ocrFrench ?? `french ocr ${pageId}`,
    correctedFrench: overrides.correctedFrench ?? null,
    english: overrides.english ?? `english translation ${pageId}`,
    ocrCondition: overrides.ocrCondition ?? null,
    provenance: overrides.provenance ?? {
      sourceId: SOURCE_ID,
      ark: 'ark:/12148/bpt6k56068358',
      date: '1879-08-15',
      rights: 'public-domain',
      page: pageId,
      sha256: `sha-${pageId}`,
      machineAssist: MACHINE_ASSIST,
    },
  };
}

function makeSnapshot(overrides: {
  pages?: RawPage[];
  kind?: RawSource['kind'];
  title?: string;
  rights?: string;
  issues?: RawIssue[];
} = {}): CorpusSnapshot {
  const pages = overrides.pages ?? [makePage({ pageId: 'p001', folioId: 'f001' }), makePage({ pageId: 'p002', folioId: 'f002' })];
  const issue: RawIssue = { issueId: ISSUE_ID, date: '1879-08-15', sequence: 1, pages };
  const source: RawSource = {
    sourceId: SOURCE_ID,
    title: overrides.title ?? 'Le Petit Journal',
    kind: overrides.kind ?? 'periodical',
    ark: 'ark:/12148/source',
    rights: overrides.rights ?? 'public-domain',
    issues: overrides.issues ?? [issue],
  };
  return { sources: [source], skipped: [] };
}

function snapshotReaderOf(snapshot: CorpusSnapshot): CorpusSnapshotReader {
  return {
    read(sourceId: string): CorpusSnapshot {
      if (!snapshot.sources.some((s) => s.sourceId === sourceId)) {
        throw new Error(`fake snapshot reader: no source ${sourceId}`);
      }
      return snapshot;
    },
  };
}

function pinReaderOf(ref: string): ArchivePinReader {
  return { read: () => ref };
}

function sourceMetaOf(meta: SourceCatalogMeta): SourceMetaReader {
  return { read: () => meta };
}

const NULL_META: SourceCatalogMeta = { creator: null, catalogUrl: null, ark: null };

function makeBuilderWith(
  snapshot: CorpusSnapshot,
  meta: SourceCatalogMeta = NULL_META,
  ref: string = PIN_REF,
) {
  return makeEditionBuilder({
    snapshot: snapshotReaderOf(snapshot),
    sourceMeta: sourceMetaOf(meta),
    pin: pinReaderOf(ref),
    imageProvider: 'b2',
  });
}

// ---------------------------------------------------------------------------

describe('makeEditionBuilder', () => {
  it('G-1: page-count coherence + ordering (pages follow source sequence)', () => {
    const edition = makeBuilderWith(makeSnapshot()).build(SOURCE_ID, ISSUE_ID);
    expect(edition.pages).toHaveLength(2);
    expect(edition.pages.map((p) => p.pageId)).toEqual(['p001', 'p002']);
    expect(edition.pages.map((p) => p.folioId)).toEqual(['f001', 'f002']);
    expect(edition.itemId).toBe(ISSUE_ID);
    expect(edition.kind).toBe('issue');
  });

  it('G-1: a zero-page item throws naming the item', () => {
    const snapshot = makeSnapshot({
      issues: [{ issueId: ISSUE_ID, date: '1879-08-15', sequence: 1, pages: [] }],
    });
    expect(() => makeBuilderWith(snapshot).build(SOURCE_ID, ISSUE_ID)).toThrow(/zero pages|no pages/i);
    expect(() => makeBuilderWith(snapshot).build(SOURCE_ID, ISSUE_ID)).toThrow(new RegExp(ISSUE_ID));
  });

  it('monograph: itemId === sourceId selects the single unit, kind monograph', () => {
    const snapshot = makeSnapshot({ kind: 'monograph' });
    const edition = makeBuilderWith(snapshot).build(SOURCE_ID, SOURCE_ID);
    expect(edition.kind).toBe('monograph');
    expect(edition.itemId).toBe(SOURCE_ID);
    expect(edition.pages).toHaveLength(2);
  });

  it('G-2: a page with empty english throws naming source/issue/page (FR-011, no fallback)', () => {
    const snapshot = makeSnapshot({
      pages: [makePage({ pageId: 'p001' }), makePage({ pageId: 'p002', english: '   ' })],
    });
    const build = () => makeBuilderWith(snapshot).build(SOURCE_ID, ISSUE_ID);
    expect(build).toThrow(/english/i);
    expect(build).toThrow(new RegExp(SOURCE_ID));
    expect(build).toThrow(new RegExp(ISSUE_ID));
    expect(build).toThrow(/p002/);
  });

  it('G-3: empty ocrFrench throws naming the page', () => {
    const snapshot = makeSnapshot({
      pages: [makePage({ pageId: 'p001', ocrFrench: '', correctedFrench: null })],
    });
    const build = () => makeBuilderWith(snapshot).build(SOURCE_ID, ISSUE_ID);
    expect(build).toThrow(/ocrFrench|french/i);
    expect(build).toThrow(/p001/);
  });

  it('G-3: correctedFrench is preferred over ocrFrench when present', () => {
    const snapshot = makeSnapshot({
      pages: [makePage({ pageId: 'p001', ocrFrench: 'noisy', correctedFrench: 'clean french' })],
    });
    const edition = makeBuilderWith(snapshot).build(SOURCE_ID, ISSUE_ID);
    expect(edition.pages[0].ocrFrench).toBe('clean french');
  });

  it('G-3: null objectStoreKey throws naming the page (FR-009)', () => {
    const snapshot = makeSnapshot({
      pages: [makePage({ pageId: 'p001', objectStoreKey: null })],
    });
    const build = () => makeBuilderWith(snapshot).build(SOURCE_ID, ISSUE_ID);
    expect(build).toThrow(/objectStoreKey|object store/i);
    expect(build).toThrow(/p001/);
  });

  it('image asset carries fetch inputs with empty bytesPath staging marker (b2 -> b2-cdn)', () => {
    const edition = makeBuilderWith(makeSnapshot()).build(SOURCE_ID, ISSUE_ID);
    const asset = edition.pages[0].image;
    expect(asset.objectStoreKey).toBe('object_store/p001.jpg');
    expect(asset.sha256).toBe('sha-p001');
    expect(asset.provider).toBe('b2-cdn');
    expect(asset.width).toBeNull();
    expect(asset.height).toBeNull();
    expect(asset.bytesPath).toBe('');
  });

  it('image provider iiif maps to source-iiif', () => {
    const builder = makeEditionBuilder({
      snapshot: snapshotReaderOf(makeSnapshot()),
      sourceMeta: sourceMetaOf(NULL_META),
      pin: pinReaderOf(PIN_REF),
      imageProvider: 'iiif',
    });
    expect(builder.build(SOURCE_ID, ISSUE_ID).pages[0].image.provider).toBe('source-iiif');
  });

  it('G-4: title required -> throws when snapshot title is empty', () => {
    const snapshot = makeSnapshot({ title: '  ' });
    expect(() => makeBuilderWith(snapshot).build(SOURCE_ID, ISSUE_ID)).toThrow(/title/i);
  });

  it('G-4: rights required -> throws when snapshot rights is empty', () => {
    const snapshot = makeSnapshot({ rights: '' });
    expect(() => makeBuilderWith(snapshot).build(SOURCE_ID, ISSUE_ID)).toThrow(/rights/i);
  });

  it('G-4: creator/ark/catalogUrl may be null without throwing', () => {
    const edition = makeBuilderWith(makeSnapshot(), NULL_META).build(SOURCE_ID, ISSUE_ID);
    expect(edition.titlePage.creator).toBeNull();
    expect(edition.titlePage.ark).toBeNull();
    expect(edition.titlePage.catalogUrl).toBeNull();
    expect(edition.titlePage.title).toBe('Le Petit Journal');
    expect(edition.titlePage.rights).toBe('public-domain');
    expect(edition.titlePage.date).toBe('1879-08-15');
  });

  it('G-4: creator/ark/catalogUrl from SSOT flow onto the title page', () => {
    const meta: SourceCatalogMeta = {
      creator: 'A. Author',
      catalogUrl: 'https://gallica.bnf.fr/ark:/12148/x',
      ark: 'ark:/12148/source-ark',
    };
    const edition = makeBuilderWith(makeSnapshot(), meta).build(SOURCE_ID, ISSUE_ID);
    expect(edition.titlePage.creator).toBe('A. Author');
    expect(edition.titlePage.catalogUrl).toBe('https://gallica.bnf.fr/ark:/12148/x');
    expect(edition.titlePage.ark).toBe('ark:/12148/source-ark');
  });

  it('G-5: colophon carries pin ref, per-image list, and machine-assist label', () => {
    const edition = makeBuilderWith(makeSnapshot()).build(SOURCE_ID, ISSUE_ID);
    expect(edition.colophon.archiveRef).toBe(PIN_REF);
    expect(edition.colophon.snapshotSourceId).toBe(SOURCE_ID);
    expect(edition.colophon.images).toEqual([
      { folioId: 'f001', objectStoreKey: 'object_store/p001.jpg', sha256: 'sha-p001' },
      { folioId: 'f002', objectStoreKey: 'object_store/p002.jpg', sha256: 'sha-p002' },
    ]);
    expect(edition.colophon.translation).toEqual(MACHINE_ASSIST);
    expect(edition.colophon.framing.length).toBeGreaterThan(0);
  });

  it('G-5: no machine-assist on any page throws (mandatory label, FR-005)', () => {
    const snapshot = makeSnapshot({
      pages: [
        makePage({
          pageId: 'p001',
          provenance: {
            sourceId: SOURCE_ID,
            ark: 'ark:/12148/bpt6k56068358',
            date: '1879-08-15',
            rights: 'public-domain',
            page: 'p001',
            sha256: 'sha-p001',
            machineAssist: null,
          },
        }),
      ],
    });
    expect(() => makeBuilderWith(snapshot).build(SOURCE_ID, ISSUE_ID)).toThrow(/machine|translation label/i);
  });

  it('G-7: determinism -- same inputs produce deep-equal Editions', () => {
    const builder = makeBuilderWith(makeSnapshot());
    const a = builder.build(SOURCE_ID, ISSUE_ID);
    const b = builder.build(SOURCE_ID, ISSUE_ID);
    expect(a).toEqual(b);
  });

  it('throws when the requested issue id is not in the snapshot', () => {
    expect(() => makeBuilderWith(makeSnapshot()).build(SOURCE_ID, 'no-such-issue')).toThrow(/no-such-issue/);
  });
});
