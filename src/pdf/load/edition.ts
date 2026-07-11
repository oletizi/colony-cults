/**
 * The Edition builder (T013, spec 007): assemble the pure {@link Edition} view
 * model for ONE bibliographic item from the pinned snapshot + bibliography
 * SSOT + pin file. Data assembly ONLY -- no image bytes are fetched and no
 * Typst runs here (contract edition-builder.md; the downstream fetch stage
 * fills each `ImageAsset.bytesPath`).
 *
 * Guarantees enforced here (contracts/edition-builder.md, data-model.md
 * § fail-loud):
 *  - G-1 page-count coherence + source ordering; a zero-page item throws.
 *  - G-2 every page's `english` is non-empty (no issue-level fallback, FR-011).
 *  - G-3 every page has non-empty `ocrFrench` and a non-null `objectStoreKey` +
 *    `sha256`.
 *  - G-4 `title`/`rights` required; `creator`/`ark`/`catalogUrl` may be null.
 *  - G-5 colophon pin ref + per-image list + mandatory machine-assist label
 *    (delegated to `assembleColophon`).
 *  - G-7 determinism: `build()` is a pure function of its injected inputs.
 */

import type { PdfImageProviderKind } from '@/pdf/config';
import type {
  Edition,
  EditionPage,
  ImageAsset,
  MachineAssistLabel,
  TitlePageMeta,
} from '@/pdf/model';
import type { CorpusSnapshot, RawIssue, RawPage, RawSource } from '@/browser/model';
import { readSnapshotCorpus } from '@/browser/load/snapshot';
import { resolveArchiveRef } from '@/pdf/config';
import { assembleColophon } from '@/pdf/load/colophon';
import type { ColophonPageInput } from '@/pdf/load/colophon';
import type { SourceMetaReader } from '@/pdf/load/source-meta';

/** Reads the committed snapshot for one source (injected for testability). */
export interface CorpusSnapshotReader {
  /** @throws Error if the source's snapshot is missing/unparseable. */
  read(sourceId: string): CorpusSnapshot;
}

/** Reads the pinned archive ref from the pin sidecar (injected for testability). */
export interface ArchivePinReader {
  /** @throws Error if the pin file is missing or lacks a non-empty `ref`. */
  read(): string;
}

/** The contract this builder satisfies (contracts/edition-builder.md). */
export interface EditionBuilder {
  /**
   * @param sourceId snapshot source id (e.g. `PB-P001`).
   * @param itemId issue id for a periodical issue, or the source id for a monograph.
   * @throws Error on any fail-loud violation (see module doc).
   */
  build(sourceId: string, itemId: string): Edition;
}

/** Injected collaborators for {@link makeEditionBuilder}. */
export interface EditionBuilderDeps {
  snapshot: CorpusSnapshotReader;
  sourceMeta: SourceMetaReader;
  pin: ArchivePinReader;
  /**
   * Which image provider the downstream fetch stage will use. Mapped onto each
   * `ImageAsset.provider` now so the Edition records the intended source; the
   * bytes themselves are fetched later.
   */
  imageProvider: PdfImageProviderKind;
}

/** Map the env-config provider kind onto the ImageAsset provider tag. */
function mapProvider(kind: PdfImageProviderKind): ImageAsset['provider'] {
  return kind === 'b2' ? 'b2-cdn' : 'source-iiif';
}

/** Map the snapshot RawSource kind onto the Edition's built-unit kind. */
function mapKind(kind: RawSource['kind']): Edition['kind'] {
  return kind === 'periodical' ? 'issue' : 'monograph';
}

function requireNonEmpty(value: string, label: string, context: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${context}: ${label} is empty -- ${label} is required (data-model.md G-4).`);
  }
  return value;
}

/** Resolve the RawSource for `sourceId` from the snapshot, or throw. */
function selectSource(snapshot: CorpusSnapshot, sourceId: string): RawSource {
  const source = snapshot.sources.find((candidate) => candidate.sourceId === sourceId);
  if (source === undefined) {
    throw new Error(
      `EditionBuilder.build: snapshot for ${sourceId} contains no source with id ${sourceId} ` +
        `(found: ${snapshot.sources.map((s) => s.sourceId).join(', ') || 'none'}).`,
    );
  }
  return source;
}

/**
 * Select the built unit: the issue matching `itemId` for a periodical, or the
 * monograph's single unit when `itemId === sourceId`.
 */
function selectIssue(source: RawSource, itemId: string): RawIssue {
  if (source.kind === 'monograph') {
    if (itemId !== source.sourceId) {
      throw new Error(
        `EditionBuilder.build: monograph ${source.sourceId} is built as a whole; itemId ` +
          `must equal the source id, got ${JSON.stringify(itemId)}.`,
      );
    }
    const unit = source.issues[0];
    if (unit === undefined) {
      throw new Error(
        `EditionBuilder.build: monograph ${source.sourceId} has no unit in the snapshot ` +
          '(expected exactly one book directory).',
      );
    }
    return unit;
  }

  const issue = source.issues.find((candidate) => candidate.issueId === itemId);
  if (issue === undefined) {
    throw new Error(
      `EditionBuilder.build: source ${source.sourceId} has no issue ${JSON.stringify(itemId)} ` +
        `(found: ${source.issues.map((i) => i.issueId).join(', ') || 'none'}).`,
    );
  }
  return issue;
}

/** Map one RawPage to an EditionPage, enforcing G-2/G-3 fail-loud rules. */
function toEditionPage(
  page: RawPage,
  provider: ImageAsset['provider'],
  context: string,
): EditionPage {
  const pageContext = `${context}/page ${page.pageId}`;

  if (page.english.trim().length === 0) {
    throw new Error(
      `${pageContext}: english is empty -- every page requires its own English translation; ` +
        'there is no issue-level or placeholder fallback (G-2, FR-011).',
    );
  }

  const ocrFrench = page.correctedFrench ?? page.ocrFrench;
  if (ocrFrench.trim().length === 0) {
    throw new Error(`${pageContext}: ocrFrench is empty -- a French OCR layer is required (G-3).`);
  }

  const objectStoreKey = page.objectStoreKey;
  if (objectStoreKey === null || objectStoreKey.trim().length === 0) {
    throw new Error(
      `${pageContext}: objectStoreKey is ${objectStoreKey === null ? 'null' : 'empty'} -- the ` +
        'page image key is required (G-3, FR-009).',
    );
  }

  const sha256 = page.provenance.sha256;
  if (sha256.trim().length === 0) {
    throw new Error(`${pageContext}: provenance.sha256 is empty -- an image checksum is required (G-3).`);
  }

  const image: ImageAsset = {
    objectStoreKey,
    sha256,
    // Filled by the downstream fetch stage (build.ts, T021) after the bytes are
    // fetched + sha256-verified. Empty here is a documented pipeline-stage
    // marker, not a data fallback -- the Edition carries the fetch INPUTS only.
    bytesPath: '',
    provider,
    width: null,
    height: null,
  };

  return {
    pageId: page.pageId,
    folioId: page.folioId,
    image,
    ocrFrench,
    english: page.english,
    ocrCondition: page.ocrCondition,
  };
}

/** Map a snapshot (browser) machine-assist label onto the PDF model label. */
function toMachineAssist(page: RawPage): MachineAssistLabel | null {
  const label = page.provenance.machineAssist;
  if (label === undefined || label === null) {
    return null;
  }
  return { engine: label.engine, model: label.model, retrieved: label.retrieved };
}

/**
 * Build the Edition-builder over injected collaborators (dependency injection;
 * no inheritance). Deterministic: `build()` reads only its inputs.
 */
export function makeEditionBuilder(deps: EditionBuilderDeps): EditionBuilder {
  const provider = mapProvider(deps.imageProvider);

  return {
    build(sourceId: string, itemId: string): Edition {
      const snapshot = deps.snapshot.read(sourceId);
      const source = selectSource(snapshot, sourceId);
      const issue = selectIssue(source, itemId);
      const context = `EditionBuilder ${sourceId}/${itemId}`;

      if (issue.pages.length === 0) {
        throw new Error(
          `${context}: item ${JSON.stringify(itemId)} has zero pages -- an item with no pages ` +
            'cannot be built (G-1).',
        );
      }

      const catalog = deps.sourceMeta.read(sourceId);
      const titlePage: TitlePageMeta = {
        title: requireNonEmpty(source.title, 'title', context),
        creator: catalog.creator,
        date: issue.date,
        rights: requireNonEmpty(source.rights, 'rights', context),
        ark: catalog.ark,
        catalogUrl: catalog.catalogUrl,
      };

      const pages = issue.pages.map((page) => toEditionPage(page, provider, context));

      const colophonPages: ColophonPageInput[] = issue.pages.map((page) => ({
        pageId: page.pageId,
        folioId: page.folioId,
        // Non-null here: toEditionPage already threw on a null/empty key above.
        objectStoreKey: page.objectStoreKey ?? '',
        sha256: page.provenance.sha256,
        machineAssist: toMachineAssist(page),
      }));

      const colophon = assembleColophon({
        sourceId,
        itemId,
        archiveRef: deps.pin.read(),
        pages: colophonPages,
      });

      return {
        itemId,
        kind: mapKind(source.kind),
        titlePage,
        pages,
        colophon,
      };
    },
  };
}

/**
 * Concrete snapshot reader over `readSnapshotCorpus` (wraps a single source id
 * into the multi-source reader). For build.ts wiring.
 */
export function makeCorpusSnapshotReader(snapshotDir: string): CorpusSnapshotReader {
  return {
    read(sourceId: string): CorpusSnapshot {
      return readSnapshotCorpus(snapshotDir, [sourceId]);
    },
  };
}

/**
 * Concrete pin reader over `resolveArchiveRef`. For build.ts wiring.
 */
export function makeArchivePinReader(pinFile: string): ArchivePinReader {
  return {
    read(): string {
      return resolveArchiveRef({ pinFile });
    },
  };
}
