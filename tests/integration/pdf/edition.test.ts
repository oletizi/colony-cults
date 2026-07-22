/**
 * INTEGRATION test (T010, spec 007): builds a REAL PB-P001 issue end-to-end
 * from the committed snapshot (`site/data/PB-P001.json.gz`), the bibliography
 * SSOT (`bibliography/sources/PB-P001.yml`), and the pin sidecar
 * (`site/data/archive-source.json`) -- through `makeEditionBuilder` with its
 * CONCRETE readers -- and then through `toTypstInput` + `serializeTypstInput`.
 *
 * No archive/network access: every reader here only touches files already
 * committed to this repo. Image bytes and Typst itself are out of scope --
 * `ImageAsset.bytesPath` stays the documented empty pipeline-stage marker
 * (edition.ts), and `toTypstInput` derives its verso filename from `folioId`
 * alone (typst-input.ts), so nothing here needs a fetched image or a Typst
 * binary.
 */

import { describe, expect, it, beforeAll } from 'vitest';

import type { CorpusSnapshot } from '@/browser/model';
import { resolveRepoRoot } from '@/browser/load/repo-root';
import {
  makeArchivePinReader,
  makeCorpusSnapshotReader,
  makeEditionBuilder,
} from '@/pdf/load/edition';
import { makeSourceMetaReader } from '@/pdf/load/source-meta';
import { resolvePdfConfig } from '@/pdf/config';
import { serializeTypstInput, toTypstInput } from '@/pdf/render/typst-input';
import type { Edition } from '@/pdf/model';

const SOURCE_ID = 'PB-P001';

/**
 * Picks the first issue in source order that has at least one page (G-1: an
 * item with zero pages cannot be built). Derived from the real, committed
 * snapshot rather than hardcoded, so this test tracks the corpus rather than
 * a possibly-skipped/renamed issue id.
 */
function firstBuildableIssueId(snapshot: CorpusSnapshot, sourceId: string): string {
  const source = snapshot.sources.find((candidate) => candidate.sourceId === sourceId);
  if (source === undefined) {
    throw new Error(`test setup: snapshot has no source ${sourceId}`);
  }
  const issue = source.issues.find((candidate) => candidate.pages.length > 0);
  if (issue === undefined) {
    throw new Error(`test setup: source ${sourceId} has no issue with pages in the committed snapshot`);
  }
  return issue.issueId;
}

describe('integration: real PB-P001 issue -> Edition -> TypstInput', () => {
  const repoRoot = resolveRepoRoot();
  const config = resolvePdfConfig({});

  let issueId: string;
  let edition: Edition;
  let realPinRef: string;

  beforeAll(() => {
    const snapshotReader = makeCorpusSnapshotReader(config.snapshotDir);
    const rawSnapshot = snapshotReader.read(SOURCE_ID);
    issueId = firstBuildableIssueId(rawSnapshot, SOURCE_ID);

    const builder = makeEditionBuilder({
      snapshot: snapshotReader,
      sourceMeta: makeSourceMetaReader(repoRoot),
      pin: makeArchivePinReader(config.pinFile),
      imageProvider: config.imageProvider,
    });
    edition = builder.build(SOURCE_ID, issueId);

    const pinReader = makeArchivePinReader(config.pinFile);
    realPinRef = pinReader.read();
  });

  it('builds a real issue Edition with correct identity + page-count coherence (G-1)', () => {
    // Re-derive the expected page count/order straight from the snapshot so
    // this assertion tracks the real corpus, not a hardcoded number.
    const rawSnapshot = makeCorpusSnapshotReader(config.snapshotDir).read(SOURCE_ID);
    const rawSource = rawSnapshot.sources.find((s) => s.sourceId === SOURCE_ID);
    if (rawSource === undefined) {
      throw new Error('test: snapshot has no PB-P001 source');
    }
    const rawIssue = rawSource.issues.find((i) => i.issueId === issueId);
    if (rawIssue === undefined) {
      throw new Error(`test: snapshot has no issue ${issueId}`);
    }

    expect(edition.kind).toBe('issue');
    expect(edition.itemId).toBe(issueId);
    expect(edition.pages).toHaveLength(rawIssue.pages.length);
    expect(edition.pages.map((p) => p.pageId)).toEqual(rawIssue.pages.map((p) => p.pageId));
    expect(edition.pages.length).toBeGreaterThan(0);
  });

  it('every page carries real, non-empty OCR/translation text + a real image key/checksum', () => {
    // Re-read the raw snapshot so we can prove the image checksum is the folio
    // sidecar's IMAGE-master sha256 (RawPage.imageSha256), NOT the
    // translation-text provenance.sha256.
    const rawSource = makeCorpusSnapshotReader(config.snapshotDir)
      .read(SOURCE_ID)
      .sources.find((s) => s.sourceId === SOURCE_ID);
    if (rawSource === undefined) {
      throw new Error('test: snapshot has no PB-P001 source');
    }
    const rawIssue = rawSource.issues.find((i) => i.issueId === issueId);
    if (rawIssue === undefined) {
      throw new Error(`test: snapshot has no issue ${issueId}`);
    }

    edition.pages.forEach((page, index) => {
      const rawPage = rawIssue.pages[index];
      expect(rawPage).toBeDefined();
      if (rawPage === undefined) {
        throw new Error(`test: raw page ${index} missing`);
      }

      expect(page.ocrFrench.trim().length).toBeGreaterThan(0);
      expect(page.english.trim().length).toBeGreaterThan(0);
      expect(page.image.objectStoreKey.trim().length).toBeGreaterThan(0);
      expect(page.image.sha256.trim().length).toBeGreaterThan(0);

      // The embedded-image checksum is the folio sidecar's image-master hash,
      // and it is DISTINCT from the translation-text provenance hash.
      expect(page.image.sha256).toBe(rawPage.imageSha256);
      expect(page.image.sha256).not.toBe(rawPage.provenance.sha256);

      // Bytes are not fetched by the builder (documented pipeline-stage
      // marker) -- assert the marker, not a fetched path.
      expect(page.image.bytesPath).toBe('');
    });
  });

  it('title page carries real, non-empty title + rights', () => {
    expect(edition.titlePage.title.trim().length).toBeGreaterThan(0);
    expect(edition.titlePage.rights.trim().length).toBeGreaterThan(0);
  });

  it('colophon carries the real pin ref, covers every page, and a real machine-assist label', () => {
    expect(realPinRef.trim().length).toBeGreaterThan(0);
    expect(edition.colophon.archiveRef).toBe(realPinRef);
    expect(edition.colophon.snapshotSourceId).toBe(SOURCE_ID);

    expect(edition.colophon.images).toHaveLength(edition.pages.length);
    expect(edition.colophon.images.map((img) => img.folioId)).toEqual(
      edition.pages.map((p) => p.folioId),
    );

    expect(edition.colophon.translation).not.toBeNull();
    expect(edition.colophon.translation?.engine.trim().length).toBeGreaterThan(0);
    expect(edition.colophon.translation?.retrieved.trim().length).toBeGreaterThan(0);
  });

  describe('toTypstInput + serializeTypstInput over the real Edition', () => {
    it('produces one facing-page spread per source page, in order, with verso image + recto text', () => {
      const typstInput = toTypstInput(edition, true);

      expect(typstInput.itemId).toBe(edition.itemId);
      expect(typstInput.kind).toBe(edition.kind);
      expect(typstInput.pages).toHaveLength(edition.pages.length);

      typstInput.pages.forEach((typstPage, index) => {
        const sourcePage = edition.pages[index];
        expect(sourcePage).toBeDefined();
        if (sourcePage === undefined) {
          throw new Error(`test: edition.pages[${index}] unexpectedly missing`);
        }

        expect(typstPage.pageId).toBe(sourcePage.pageId);
        expect(typstPage.folioId).toBe(sourcePage.folioId);

        // Verso: a stable, non-empty image reference + the real checksum.
        expect(typstPage.verso.imagePath.trim().length).toBeGreaterThan(0);
        expect(typstPage.verso.imagePath.startsWith(sourcePage.folioId)).toBe(true);
        expect(typstPage.verso.sha256).toBe(sourcePage.image.sha256);

        // Recto: real FR OCR + real EN translation, machine-assist carried.
        expect(typstPage.recto.ocrFrench).toBe(sourcePage.ocrFrench);
        expect(typstPage.recto.english).toBe(sourcePage.english);
        expect(typstPage.recto.machineAssist).toEqual(edition.colophon.translation);
      });
    });

    it('carries title-page + colophon provenance verbatim onto the TypstInput', () => {
      const typstInput = toTypstInput(edition, true);
      expect(typstInput.titlePage).toEqual(edition.titlePage);
      expect(typstInput.colophon).toEqual(edition.colophon);
    });

    it('serializes deterministically: two serializations of the same input are byte-identical', () => {
      const typstInput = toTypstInput(edition, true);
      const first = serializeTypstInput(typstInput);
      const second = serializeTypstInput(toTypstInput(edition, true));

      expect(first).toBe(second);
      expect(first.length).toBeGreaterThan(0);

      // Sanity: the serialized JSON round-trips + carries the real item id.
      const parsed: unknown = JSON.parse(first);
      expect(parsed).toMatchObject({ itemId: issueId, kind: 'issue' });
    });
  });
});
