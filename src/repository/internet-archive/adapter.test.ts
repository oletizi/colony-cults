/**
 * Tests for {@link InternetArchiveAdapter} (`@/repository/internet-archive/adapter`),
 * T018/T019's `resolve` + `collectRightsEvidence` skeleton
 * (specs/013-archiveorg-acquisition-path,
 * contracts/internet-archive-adapter.md). `acquire` is asserted to be an
 * explicit fail-loud stub (T025 implements it later).
 *
 * Real-fixture coverage: `__fixtures__/metadata-nouvellefrancec00groogoog.json`
 * (the de Groote "Nouvelle-France" item). No network is ever touched -- a
 * fake `ArchiveHttpClient` returns the fixture (or a synthetic response) for
 * `getText`.
 *
 * T047 (specs/013-archiveorg-acquisition-path): also proves that
 * `selectSourceFiles`' fail-loud ambiguous/OCR-only-PDF rules
 * (`@/repository/internet-archive/file-select`, unit-tested in
 * `file-select.test.ts`) surface THROUGH `resolve`, not just the module
 * underneath it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ArchiveHttpClient } from '@/repository/internet-archive/metadata';
import type { RepositoryLocator } from '@/repository/adapter';
import type { RepositoryRecord } from '@/model/repository-record';
import { InternetArchiveAdapter } from '@/repository/internet-archive/adapter';

const fixturesDir = join(
  process.cwd(),
  'src',
  'repository',
  'internet-archive',
  '__fixtures__',
);

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf-8');
}

const ITEM_ID = 'nouvellefrancec00groogoog';
const FIXTURE_TEXT = readFixture(`metadata-${ITEM_ID}.json`);
const LOCATOR: RepositoryLocator = { repository: 'internet-archive', value: ITEM_ID };

/** A fake {@link ArchiveHttpClient} whose `getText` returns a fixed response, never touching the network. */
function fakeClient(responseText: string): ArchiveHttpClient {
  return {
    getText: async (_url: string) => responseText,
    getBytes: async (_url: string) => {
      throw new Error('fakeClient: getBytes is not used by this adapter skeleton.');
    },
  };
}

/** A synthetic non-`texts` item response (a `movies` item), for the fail-loud test. */
function nonTextsResponse(): string {
  const parsed: unknown = JSON.parse(FIXTURE_TEXT);
  if (typeof parsed !== 'object' || parsed === null || !('metadata' in parsed)) {
    throw new Error('test setup: fixture did not parse with a metadata field');
  }
  const metadata = (parsed as Record<string, unknown>).metadata;
  if (typeof metadata !== 'object' || metadata === null) {
    throw new Error('test setup: fixture metadata was not an object');
  }
  return JSON.stringify({ ...parsed, metadata: { ...metadata, mediatype: 'movies' } });
}

/** Shape-check helper mirroring the one in `metadata.ts` -- avoids `as` on `unknown`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The fixture's top-level `files[]` array, decoded without fabricating its shape. */
function fixtureFiles(): unknown[] {
  const parsed: unknown = JSON.parse(FIXTURE_TEXT);
  if (!isRecord(parsed) || !Array.isArray(parsed.files)) {
    throw new Error('test setup: fixture did not parse with a top-level "files" array');
  }
  return parsed.files;
}

/**
 * A synthetic response, otherwise identical to the real de Groote fixture, whose
 * `files[]` carries TWO `Image Container PDF` masters (the real item's plus a
 * synthetic second one). The Image-Container preference cannot single one out,
 * so selection is genuinely ambiguous and fails loud (FR-003 / SC-006 / IA-INV-A).
 */
function ambiguousPdfResponse(): string {
  const parsed: unknown = JSON.parse(FIXTURE_TEXT);
  if (!isRecord(parsed)) {
    throw new Error('test setup: fixture did not parse to an object');
  }
  const extraPdf = {
    name: `${ITEM_ID}_alt.pdf`,
    format: 'Image Container PDF',
    source: 'derivative',
  };
  return JSON.stringify({ ...parsed, files: [...fixtureFiles(), extraPdf] });
}

/**
 * A synthetic response with the NEWSPAPER shape: the real `Image Container PDF`
 * master plus a supplementary `Additional Text PDF` overlay. `selectSourceFiles`
 * prefers the Image Container master, so `resolve` SUCCEEDS (no false ambiguity).
 */
function newspaperShapeResponse(): string {
  const parsed: unknown = JSON.parse(FIXTURE_TEXT);
  if (!isRecord(parsed)) {
    throw new Error('test setup: fixture did not parse to an object');
  }
  const textPdf = {
    name: `${ITEM_ID}_text.pdf`,
    format: 'Additional Text PDF',
    source: 'derivative',
  };
  return JSON.stringify({ ...parsed, files: [...fixtureFiles(), textPdf] });
}

/**
 * A synthetic response whose only `.pdf` file is OCR-only (its `format` matches
 * neither `PAGE_IMAGE_PDF_FORMAT_MARKERS` marker) -- no page-image PDF exists at
 * all, so `selectSourceFiles` refuses to fall back to it (FR-003 / SC-006).
 */
function ocrOnlyOnlyResponse(): string {
  const parsed: unknown = JSON.parse(FIXTURE_TEXT);
  if (!isRecord(parsed)) {
    throw new Error('test setup: fixture did not parse to an object');
  }
  const replaced = fixtureFiles().map((file) => {
    if (!isRecord(file) || file.name !== `${ITEM_ID}.pdf`) {
      return file;
    }
    return { ...file, format: 'OCR-only PDF' };
  });
  return JSON.stringify({ ...parsed, files: replaced });
}

describe('InternetArchiveAdapter.resolve -- de Groote fixture (real archive.org shape)', () => {
  it('returns the ia-item identifier', async () => {
    const adapter = new InternetArchiveAdapter({ client: fakeClient(FIXTURE_TEXT) });
    const item = await adapter.resolve(LOCATOR, {});
    expect(item.identifiers).toEqual([{ type: 'ia-item', value: ITEM_ID }]);
  });

  it('returns a non-empty, mechanical title', async () => {
    const adapter = new InternetArchiveAdapter({ client: fakeClient(FIXTURE_TEXT) });
    const item = await adapter.resolve(LOCATOR, {});
    expect(item.title).toBe('Nouvelle-France: Colonie libre de Port-Breton, Océanie');
    expect(item.title.length).toBeGreaterThan(0);
  });

  it('returns the details page as sourceUrl', async () => {
    const adapter = new InternetArchiveAdapter({ client: fakeClient(FIXTURE_TEXT) });
    const item = await adapter.resolve(LOCATOR, {});
    expect(item.sourceUrl).toBe(`https://archive.org/details/${ITEM_ID}`);
  });

  it('builds assetLocators for the selected pdf, scandata, and image-set files', async () => {
    const adapter = new InternetArchiveAdapter({ client: fakeClient(FIXTURE_TEXT) });
    const item = await adapter.resolve(LOCATOR, {});
    expect(item.assetLocators).toEqual([
      {
        url: `https://archive.org/download/${ITEM_ID}/${ITEM_ID}.pdf`,
        role: 'pdf',
      },
      {
        url: `https://archive.org/download/${ITEM_ID}/${ITEM_ID}_scandata.xml`,
        role: 'scandata',
      },
      {
        url: `https://archive.org/download/${ITEM_ID}/${ITEM_ID}_tif.zip`,
        role: 'image-set',
      },
    ]);
  });

  it('grounds metadata.date from the item date/year, tied to the metadata endpoint', async () => {
    const adapter = new InternetArchiveAdapter({ client: fakeClient(FIXTURE_TEXT) });
    const item = await adapter.resolve(LOCATOR, {});
    expect(item.metadata.date.value).toBe('1880');
    expect(item.metadata.date.evidence.selector).toBe(
      `https://archive.org/metadata/${ITEM_ID}`,
    );
  });

  it('grounds metadata.creator', async () => {
    const adapter = new InternetArchiveAdapter({ client: fakeClient(FIXTURE_TEXT) });
    const item = await adapter.resolve(LOCATOR, {});
    expect(item.metadata.creator?.value).toBe('P. de Groote');
  });
});

describe('InternetArchiveAdapter.resolve -- fail-loud invariants (IA-INV-A)', () => {
  it('throws on a locator with an empty value', async () => {
    const adapter = new InternetArchiveAdapter({ client: fakeClient(FIXTURE_TEXT) });
    await expect(
      adapter.resolve({ repository: 'internet-archive', value: '' }, {}),
    ).rejects.toThrow();
  });

  it('throws when the fetched item is not mediatype "texts"', async () => {
    const adapter = new InternetArchiveAdapter({ client: fakeClient(nonTextsResponse()) });
    await expect(adapter.resolve(LOCATOR, {})).rejects.toThrow();
  });
});

describe('InternetArchiveAdapter.resolve -- file-select failures surfaced end-to-end (FR-003 / SC-006)', () => {
  // `selectSourceFiles` (`@/repository/internet-archive/file-select`) is unit-tested
  // for these ambiguity/absence rules in `file-select.test.ts`. These tests prove
  // the SAME failures propagate all the way through `InternetArchiveAdapter.resolve`
  // -- not just the module underneath it -- using the real fixture's shape plus one
  // crafted `files[]` entry, via the same fake-`ArchiveHttpClient` pattern used above.

  it('throws when the item exposes two Image Container PDF masters (genuine ambiguity)', async () => {
    const adapter = new InternetArchiveAdapter({ client: fakeClient(ambiguousPdfResponse()) });
    await expect(adapter.resolve(LOCATOR, {})).rejects.toThrow(/ambiguous/i);
  });

  it('prefers the Image Container master over an Additional Text PDF (newspaper shape)', async () => {
    const adapter = new InternetArchiveAdapter({ client: fakeClient(newspaperShapeResponse()) });
    const item = await adapter.resolve(LOCATOR, {});
    const pdfLocator = item.assetLocators.find((a) => a.role === 'pdf');
    expect(pdfLocator?.url).toContain(`${ITEM_ID}.pdf`);
    expect(pdfLocator?.url).not.toContain('_text.pdf');
  });

  it('throws when the item exposes only an OCR-only PDF (no page-image PDF)', async () => {
    const adapter = new InternetArchiveAdapter({ client: fakeClient(ocrOnlyOnlyResponse()) });
    await expect(adapter.resolve(LOCATOR, {})).rejects.toThrow(/no eligible page-image PDF/i);
  });
});

describe('InternetArchiveAdapter.collectRightsEvidence -- propose, never decide (FR-004/FR-006)', () => {
  it('returns rightsRaw and grounded date/creator, with no rights verdict field', async () => {
    const adapter = new InternetArchiveAdapter({ client: fakeClient(FIXTURE_TEXT) });
    const item = await adapter.resolve(LOCATOR, {});
    const evidence = await adapter.collectRightsEvidence(item);
    expect(evidence.rightsRaw).toBe('NOT_IN_COPYRIGHT');
    expect(evidence.date?.value).toBe('1880');
    expect(evidence.creator?.value).toBe('P. de Groote');
    expect(evidence).not.toHaveProperty('rightsStatus');
    expect(evidence).not.toHaveProperty('publicDomain');
    expect(evidence).not.toHaveProperty('verdict');
  });

  it('throws when given an item this adapter did not resolve', async () => {
    const adapter = new InternetArchiveAdapter({ client: fakeClient(FIXTURE_TEXT) });
    const foreignItem = {
      repository: 'internet-archive' as const,
      identifiers: [{ type: 'ia-item' as const, value: 'unrelated-item' }],
      sourceUrl: 'https://archive.org/details/unrelated-item',
      title: 'Unrelated',
      assetLocators: [],
      metadata: {
        date: {
          value: '1900',
          evidence: { excerpt: '1900' },
          interpretation: 'synthetic',
          provenance: {
            modelAssisted: true as const,
            engine: 'test',
            model: 'test',
            promptVersion: 'test',
            at: new Date().toISOString(),
          },
        },
      },
    };
    await expect(adapter.collectRightsEvidence(foreignItem)).rejects.toThrow();
  });
});

describe('InternetArchiveAdapter.acquire -- fail-closed rights gate (T025, IA-INV-B)', () => {
  it('throws (before any fetch) on a record with no public-domain rights assessment', async () => {
    const adapter = new InternetArchiveAdapter({ client: fakeClient(FIXTURE_TEXT) });
    const record = {} as RepositoryRecord;
    // The full acquire pipeline lives in `acquire.ts` (see acquire.test.ts). Here we
    // only assert the adapter delegates and the rights gate fails closed before any
    // fetch or acquire-time dependency is even consulted.
    await expect(adapter.acquire(record, {})).rejects.toThrow(/public-domain|rightsStatus/);
  });
});

describe('InternetArchiveAdapter constructor -- fail-loud dependency validation', () => {
  it('throws when deps.client is missing', () => {
    // @ts-expect-error -- intentionally omitting the required client to test the guard clause.
    expect(() => new InternetArchiveAdapter({})).toThrow();
  });
});
