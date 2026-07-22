/**
 * Shared fixtures for the `makeArchiveEditionReader` tests
 * (`archive-edition.test.ts` / `archive-edition-colophon.test.ts`), split out
 * of the original combined `archive-edition.test.ts` (spec
 * 015-english-source-pdf) to keep each test file under the govern
 * line-count / byte-size caps. Behavior-preserving extract only -- no
 * fixture semantics changed.
 */
import { fileURLToPath } from 'node:url';

import type { Edition } from '@/pdf/model';
import type { SourceCatalogMeta, SourceMetaReader } from '@/pdf/load/source-meta';
import type { ArchivePinReader } from '@/pdf/load/edition';
import { makeArchiveEditionReader } from '@/pdf/load/archive-edition';

import type { WriteFixtureArchiveResult } from './archive-fixture';

// The real repo root -- so the reader's `loadSourceFile` resolves the committed
// `bibliography/sources/PB-P002.yml` SSOT (canonical title + affirmative
// public-domain rights). The archive bytes come from a fresh temp fixture; only
// the source record is read from the repo. From tests/unit/pdf/ up 3 = repo root.
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

// PB-P002 is a monograph registered in `@/archive/location`'s static layout
// (case port-breton / type books / slug below), so `resolveArchiveSource`
// resolves the fixture without any test-only registry mutation.
export const SOURCE_ID = 'PB-P002';
export const SOURCE_CASE = 'port-breton';
export const SOURCE_SLUG = 'nouvelle-france-colonie-libre-port-breton';
export const CANONICAL_TITLE = 'Colonie libre de Port-Breton : Nouvelle France en Océanie';
export const PIN_REF = 'pinref-abc123';

export const META: SourceCatalogMeta = {
  creator: 'Charles Du Breil de Rays',
  catalogUrl: 'https://catalogue.bnf.fr/ark:/12148/cb34139872z',
  ark: 'ark:/12148/source-ark',
};

export function sourceMetaOf(meta: SourceCatalogMeta): SourceMetaReader {
  return { read: () => meta };
}

export function pinReaderOf(ref: string): ArchivePinReader {
  return { read: () => ref };
}

export function readerFor(archiveRoot: string) {
  return makeArchiveEditionReader({
    archiveRoot,
    repoRoot: REPO_ROOT,
    sourceMeta: sourceMetaOf(META),
    pin: pinReaderOf(PIN_REF),
  });
}

export async function buildFrom(fixture: WriteFixtureArchiveResult): Promise<Edition> {
  return readerFor(fixture.archiveRoot).build(SOURCE_ID, SOURCE_ID);
}
