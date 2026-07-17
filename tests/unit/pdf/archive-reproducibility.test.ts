import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { SourceCatalogMeta, SourceMetaReader } from '@/pdf/load/source-meta';
import type { ArchivePinReader } from '@/pdf/load/edition';
import { makeArchiveEditionReader } from '@/pdf/load/archive-edition';

import { writeFixtureArchive } from './archive-fixture';

/**
 * T015 (US4): prove the reproducibility pin (SC-005, FR-009).
 *
 * The archive-direct Edition reader's colophon.archiveRef comes straight from
 * the injected `pin.read()` (see `@/pdf/load/archive-edition`'s `build()`,
 * which sets `archiveRef: deps.pin.read()`). This test proves two things:
 *  1. the injected pin ref flows through verbatim onto the colophon
 *     (a known 40-hex commit sha, not a fabricated/derived value);
 *  2. building the SAME item twice against the SAME pin is deterministic --
 *     both builds report the identical archiveRef.
 */

// From tests/unit/pdf/ up 3 = repo root, so loadSourceFile resolves the real
// committed `bibliography/sources/PB-P002.yml` SSOT (mirrors archive-edition.test.ts).
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const SOURCE_ID = 'PB-P002';
const SOURCE_CASE = 'port-breton';
const SOURCE_SLUG = 'nouvelle-france-colonie-libre-port-breton';

// A known 40-hex git commit sha -- the shape a real ArchivePinReader would
// read from `site/data/archive-source.json` (SC-005/FR-009's reproducibility pin).
const KNOWN_COMMIT_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e';

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

function readerFor(archiveRoot: string, pinRef: string) {
  return makeArchiveEditionReader({
    archiveRoot,
    repoRoot: REPO_ROOT,
    sourceMeta: sourceMetaOf(META),
    pin: pinReaderOf(pinRef),
  });
}

describe('archive-direct Edition reproducibility pin (SC-005, FR-009)', () => {
  it('the colophon archiveRef is exactly the injected pin ref', async () => {
    const fixture = await writeFixtureArchive({
      case: SOURCE_CASE,
      slug: SOURCE_SLUG,
      pageCount: 2,
    });
    try {
      const edition = await readerFor(fixture.archiveRoot, KNOWN_COMMIT_SHA).build(
        SOURCE_ID,
        SOURCE_ID,
      );
      expect(edition.colophon.archiveRef).toBe(KNOWN_COMMIT_SHA);
    } finally {
      fixture.cleanup();
    }
  });

  it('two builds against the same injected pin produce the same archiveRef (deterministic)', async () => {
    const fixture = await writeFixtureArchive({
      case: SOURCE_CASE,
      slug: SOURCE_SLUG,
      pageCount: 2,
    });
    try {
      const reader = readerFor(fixture.archiveRoot, KNOWN_COMMIT_SHA);
      const first = await reader.build(SOURCE_ID, SOURCE_ID);
      const second = await reader.build(SOURCE_ID, SOURCE_ID);
      expect(first.colophon.archiveRef).toBe(KNOWN_COMMIT_SHA);
      expect(second.colophon.archiveRef).toBe(KNOWN_COMMIT_SHA);
      expect(first.colophon.archiveRef).toBe(second.colophon.archiveRef);
    } finally {
      fixture.cleanup();
    }
  });
});
