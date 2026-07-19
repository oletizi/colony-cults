/**
 * The archive -> {@link Edition} orchestrator (spec 014, T007): assemble the
 * full PDF Edition view-model for ONE bibliographic item DIRECTLY from the
 * private archive, with no committed snapshot in the loop.
 *
 * This mirrors the shape `@/pdf/load/edition` assembles from a snapshot -- the
 * same {@link Edition}/{@link EditionPage}/{@link TitlePageMeta}/
 * {@link ColophonMeta} output, reusing the SAME colophon assembler
 * (`assembleColophon`), source-meta reader (`SourceMetaReader`), and pin reader
 * (`ArchivePinReader`) -- so nothing downstream changes. What differs is the
 * SOURCE of the data: folios + provenance + `issue.txt` + `translation/*` under
 * the archive root, resolved via `resolveArchiveSource` + `loadArchivePage`,
 * instead of a `CorpusSnapshot`.
 *
 * Deliberate differences from the snapshot builder (per the spec):
 *  - There is NO empty-`english` fail-loud guard. An `untranslatable`-labeled
 *    page legitimately carries `english: ''` (the blank-column marker, already
 *    resolved by `loadArchivePage`/T004); the reader passes it through.
 *  - Pages carry NO ark. This reader is archive-direct: the image is the
 *    object-store master (`objectStoreKey` + image-master `sha256`), and the
 *    `EditionPage` view-model has no per-page ark field at all.
 *
 * Title/rights are NOT in the folio provenance's `object_store` metadata, so
 * they come from the bibliography SSOT (`loadSourceFile`): the canonical title
 * (required) and the affirmative work-level `rights.status` (with the folio
 * provenance's `rights_status` as the fallback). Both are required non-empty.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { splitIssueOcr } from '@/browser/load/ocr-pages';
import { loadSourceFile } from '@/bibliography/load';
import type { ProvenanceFields } from '@/archive/provenance';
import { readProvenance } from '@/archive/provenance';
import type { PdfImageProviderKind } from '@/pdf/config';
import type { Edition, EditionPage, ImageAsset, TitlePageMeta } from '@/pdf/model';
import type { ArchivePageContent } from '@/pdf/load/archive-page';
import { loadArchivePage } from '@/pdf/load/archive-page';
import { buildOcrTranscription, deriveOcrDisclosureAggregate } from '@/pdf/load/archive-ocr-disclosure';
import type { ArchivePageSource, ReadingLanguage } from '@/pdf/load/archive-source';
import { resolveArchiveSource } from '@/pdf/load/archive-source';
import { assembleColophon } from '@/pdf/load/colophon';
import type { ColophonPageInput } from '@/pdf/load/colophon';
import type { ArchivePinReader } from '@/pdf/load/edition';
import type { SourceMetaReader } from '@/pdf/load/source-meta';

/** Injected collaborators for {@link makeArchiveEditionReader}. */
export interface ArchiveEditionReaderDeps {
  /** The resolved private archive root (see `resolveArchiveRoot`). */
  archiveRoot: string;
  /** The repo root holding `bibliography/sources/` (for the SSOT title/rights). */
  repoRoot: string;
  /** Reads the SSOT catalog fields (creator/catalogUrl/ark). Injectable. */
  sourceMeta: SourceMetaReader;
  /** Reads the pinned archive ref (`site/data/archive-source.json`). Injectable. */
  pin: ArchivePinReader;
  /**
   * Which image provider the downstream fetch stage will use. Recorded onto
   * each `ImageAsset.provider` now (the bytes are fetched later). Defaults to
   * `b2` -> `ImageAsset.provider === 'b2-cdn'`.
   */
  imageProvider?: PdfImageProviderKind;
}

/** The archive-direct Edition reader. */
export interface ArchiveEditionReader {
  /**
   * @param sourceId bibliography source id (e.g. `PB-P002`).
   * @param itemId the source id for a monograph (built as a whole), or the
   *   issue id for a periodical issue.
   * @throws Error on any fail-loud violation (missing item, missing SSOT,
   *   empty title/rights, missing date, or any per-page/colophon failure).
   */
  build(sourceId: string, itemId: string): Promise<Edition>;
}

/** Map the env-config provider kind onto the ImageAsset provider tag. */
function mapProvider(kind: PdfImageProviderKind): ImageAsset['provider'] {
  return kind === 'b2' ? 'b2-cdn' : 'source-iiif';
}

/** A non-empty trimmed value, or throw naming the field + context. */
function requireNonEmpty(value: string, label: string, context: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${context}: ${label} is empty -- ${label} is required.`);
  }
  return value;
}

/** The selected built unit: its ordered folios, its dir, its Edition kind, and its reading language. */
interface SelectedUnit {
  folios: ArchivePageSource[];
  pageDir: string;
  kind: Edition['kind'];
  /**
   * The source's resolved reading-language path (spec 015, FR-001), threaded
   * into every `loadArchivePage` call so per-page assembly branches without
   * re-deriving it. Source-level (from `resolveArchiveSource`), so it is the
   * same for every folio/issue of this unit.
   */
  readingLanguage: ReadingLanguage;
}

/**
 * Resolve the item to build. A monograph is built as a whole (`itemId` must
 * equal the source id); a periodical resolves to the issue whose id matches
 * `itemId`. Fail loud (naming the item) when the selection cannot be made.
 */
async function selectUnit(
  sourceId: string,
  itemId: string,
  archiveRoot: string,
  context: string,
): Promise<SelectedUnit> {
  const resolution = await resolveArchiveSource({ sourceId, archiveRoot });

  if (resolution.kind === 'monograph') {
    if (itemId !== sourceId) {
      throw new Error(
        `${context}: monograph ${sourceId} is built as a whole; itemId must equal the source ` +
          `id, got ${JSON.stringify(itemId)}.`,
      );
    }
    return {
      folios: resolution.folios,
      pageDir: resolution.pageDir,
      kind: 'monograph',
      readingLanguage: resolution.readingLanguage,
    };
  }

  const issue = resolution.issues.find((candidate) => candidate.issueId === itemId);
  if (issue === undefined) {
    throw new Error(
      `${context}: periodical ${sourceId} has no issue ${JSON.stringify(itemId)} ` +
        `(found: ${resolution.issues.map((i) => i.issueId).join(', ') || 'none'}).`,
    );
  }
  return {
    folios: issue.folios,
    pageDir: issue.pageDir,
    kind: 'issue',
    readingLanguage: resolution.readingLanguage,
  };
}

/**
 * The title page's `date`. For a periodical issue, the issue date is the
 * `YYYY-MM-DD` prefix of the issue id (mirroring the snapshot builder's
 * `issue.date`). Otherwise -- and always for a monograph, which has no dated
 * directory -- the only date the archive carries per folio is the provenance
 * `retrieved` timestamp; its `YYYY-MM-DD` portion is used. Fail loud when
 * neither yields a date (no fabricated value).
 */
function resolveDate(
  kind: Edition['kind'],
  itemId: string,
  provenance: ProvenanceFields,
  context: string,
): string {
  const isoDate = /^(\d{4}-\d{2}-\d{2})/;
  if (kind === 'issue') {
    const match = isoDate.exec(itemId);
    if (match !== null) {
      return match[1];
    }
  }
  const retrieved = provenance.retrieved.trim();
  const retrievedDate = isoDate.exec(retrieved);
  if (retrievedDate !== null) {
    return retrievedDate[1];
  }
  if (retrieved.length > 0) {
    return retrieved;
  }
  throw new Error(
    `${context}: no date available -- neither the item id nor the folio provenance ` +
      `("retrieved") yielded a date.`,
  );
}

/**
 * The title-page `title` + `rights` from the bibliography SSOT, on one read:
 *  - `title`: the canonical (or first) title text, required non-empty.
 *  - `rights`: the affirmative work-level `rights.status` when present, else the
 *    folio provenance's `rights_status`; required non-empty.
 */
function resolveTitleAndRights(
  repoRoot: string,
  sourceId: string,
  provenance: ProvenanceFields,
  context: string,
): { title: string; rights: string } {
  const filePath = path.join(repoRoot, 'bibliography', 'sources', `${sourceId}.yml`);
  const { source } = loadSourceFile(filePath);

  const canonical = source.titles.find((title) => title.role === 'canonical');
  const chosen = canonical ?? source.titles[0];
  const title = requireNonEmpty(chosen === undefined ? '' : chosen.text, 'title', context);

  const rights = requireNonEmpty(
    source.rights?.status ?? provenance.rights_status,
    'rights',
    context,
  );

  return { title, rights };
}

/** Read one folio's provenance sidecar (`fNNN.yml`) by path. */
async function readFolioSidecar(folio: ArchivePageSource): Promise<ProvenanceFields> {
  return readProvenance(path.join(folio.pageDir, `${folio.folioId}.yml`));
}

/** The provenance sidecars `build()` needs, read at most once each (AUDIT-19). */
interface LeadAndAggregateProvenances {
  /** The lead (first) folio's provenance -- the title-page date/rights fallback. */
  leadProvenance: ProvenanceFields;
  /**
   * Every folio's provenance, in `unit.folios` order -- populated ONLY on the
   * English path, where {@link deriveOcrDisclosureAggregate} needs the whole
   * unit anyway; `null` on the French path (no aggregate is computed there,
   * so only the lead folio is read).
   */
  allProvenances: ProvenanceFields[] | null;
}

/**
 * Resolve both provenance-derived needs of `build()` -- the lead folio's
 * fields and, on the English path, the all-folios OCR-disclosure aggregate
 * input -- reading each folio's sidecar AT MOST ONCE (AUDIT-19, fixes the
 * prior double-read: the lead folio's sidecar was read once for the
 * title-page fields and AGAIN inside `deriveOcrDisclosureAggregate`'s own
 * `Promise.all` on the English path).
 *
 * On the English path, `deriveOcrDisclosureAggregate` needs every folio's
 * provenance regardless, so that single all-folios read also supplies the
 * lead (`folios[0]`) -- no separate lead-only read follows. On the French
 * path (no aggregate), only the lead folio's provenance is read, exactly as
 * before -- this does NOT widen the French path to an all-folios read it
 * never needed.
 *
 * `unit.folios` is non-empty by the time this is called (`build()` fails
 * loud on a zero-folio unit first), so the lead is always defined.
 */
async function resolveLeadAndAggregateProvenances(
  unit: SelectedUnit,
): Promise<LeadAndAggregateProvenances> {
  if (unit.readingLanguage === 'english') {
    const allProvenances = await Promise.all(unit.folios.map(readFolioSidecar));
    return { leadProvenance: allProvenances[0], allProvenances };
  }
  const leadProvenance = await readFolioSidecar(unit.folios[0]);
  return { leadProvenance, allProvenances: null };
}

/** Map one folio + its assembled content to an EditionPage (no empty-english guard). */
function toEditionPage(
  folio: ArchivePageSource,
  content: ArchivePageContent,
  provider: ImageAsset['provider'],
): EditionPage {
  const image: ImageAsset = {
    objectStoreKey: folio.objectStoreKey,
    sha256: folio.imageSha256,
    // Filled by the downstream fetch stage after the bytes are fetched +
    // sha256-verified. Empty here is a documented pipeline-stage marker (the
    // Edition carries the fetch INPUTS only), not a data fallback.
    bytesPath: '',
    provider,
    width: null,
    height: null,
  };
  return {
    pageId: content.pageId,
    folioId: content.folioId,
    image,
    ocrFrench: content.ocrFrench,
    // MAY be '' for an untranslatable page -- the blank-column marker was
    // already resolved by loadArchivePage; the reader passes it through.
    english: content.english,
    ocrCondition: content.ocrCondition,
  };
}

/**
 * Build the archive-direct Edition reader over injected collaborators
 * (dependency injection; no inheritance). `build()` is a pure function of the
 * archive contents + the injected readers.
 */
export function makeArchiveEditionReader(deps: ArchiveEditionReaderDeps): ArchiveEditionReader {
  const provider = mapProvider(deps.imageProvider ?? 'b2');

  return {
    async build(sourceId: string, itemId: string): Promise<Edition> {
      const context = `ArchiveEditionReader ${sourceId}/${itemId}`;

      const unit = await selectUnit(sourceId, itemId, deps.archiveRoot, context);
      if (unit.folios.length === 0) {
        throw new Error(`${context}: the resolved item has zero folios -- cannot build.`);
      }

      // Split the source's issue.txt ONCE; per-folio content keys off the
      // position-th segment (loadArchivePage's OCR fallback).
      const issueText = await readFile(path.join(unit.pageDir, 'issue.txt'), 'utf-8');
      const segments = splitIssueOcr(issueText).map((page) => page.ocrFrench);

      const contents = await Promise.all(
        unit.folios.map((folio) => loadArchivePage(folio, segments, unit.readingLanguage)),
      );
      const pages: EditionPage[] = unit.folios.map((folio, index) =>
        toEditionPage(folio, contents[index], provider),
      );

      const { leadProvenance, allProvenances } = await resolveLeadAndAggregateProvenances(unit);
      const catalog = deps.sourceMeta.read(sourceId);
      const { title, rights } = resolveTitleAndRights(
        deps.repoRoot,
        sourceId,
        leadProvenance,
        context,
      );
      const titlePage: TitlePageMeta = {
        title,
        creator: catalog.creator,
        date: resolveDate(unit.kind, itemId, leadProvenance, context),
        rights,
        // Archive-direct: the source-level ark comes from the SSOT catalog, not
        // from the folio (the folio's identity is its object-store key).
        ark: catalog.ark,
        catalogUrl: catalog.catalogUrl,
      };

      const colophonPages: ColophonPageInput[] = pages.map((page, index) => ({
        pageId: page.pageId,
        folioId: page.folioId,
        objectStoreKey: page.image.objectStoreKey,
        sha256: page.image.sha256,
        machineAssist: contents[index].machineAssist,
      }));

      // English editions carry no machine-assist label -- instead an honest
      // OCR-transcription disclosure (spec 015, FR-013), whose caveat is the
      // WORST OCR condition across all folios (AUDIT-20260719-01) and whose
      // engineStatus is a REPRESENTATIVE (non-blank_recto) folio's status,
      // never the raw lead folio's alone (AUDIT-20260719-09). `allProvenances`
      // is the same all-folios read `resolveLeadAndAggregateProvenances`
      // already did above -- not re-read here (AUDIT-19).
      const ocrTranscription =
        unit.readingLanguage === 'english' && allProvenances !== null
          ? buildOcrTranscription(deriveOcrDisclosureAggregate(allProvenances, context))
          : null;

      const colophon = assembleColophon({
        sourceId,
        itemId,
        archiveRef: deps.pin.read(),
        pages: colophonPages,
        readingLanguage: unit.readingLanguage,
        ocrTranscription,
      });

      return { itemId, kind: unit.kind, titlePage, pages, colophon };
    },
  };
}
