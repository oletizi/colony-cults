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
import type {
  Edition,
  EditionPage,
  ImageAsset,
  OcrTranscription,
  TitlePageMeta,
} from '@/pdf/model';
import type { ArchivePageContent } from '@/pdf/load/archive-page';
import { loadArchivePage } from '@/pdf/load/archive-page';
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

/** Read the first folio's provenance sidecar -- the source-level date/rights fallback. */
async function readLeadProvenance(unit: SelectedUnit, context: string): Promise<ProvenanceFields> {
  const lead = unit.folios[0];
  if (lead === undefined) {
    throw new Error(`${context}: the resolved item has no folios.`);
  }
  return readProvenance(path.join(lead.pageDir, `${lead.folioId}.yml`));
}

/**
 * The OCR pipeline's fixed engine (`@/ocr/preflight` requires `tesseract`;
 * the archive's provenance schema has no per-page OCR-engine field -- every
 * OCR-text artifact in this archive was produced by this one pipeline tool).
 */
const OCR_ENGINE = 'tesseract 5';

/**
 * One folio's OCR-condition severity, worst-first: a `failed` `ocr_status`
 * outranks any sub-`high` quality tier, which in turn outranks a clean
 * (`high`-tier or unscored) folio. Higher `severity` is worse.
 */
interface OcrSeverity {
  severity: 0 | 1 | 2 | 3;
  /** The caveat text this folio alone would contribute, or `null` if clean. */
  caveat: string | null;
}

/**
 * Rank one folio's provenance on the OCR-condition severity scale (AUDIT-
 * 20260719-01): `failed` (3) worst, then `quality.tier` `low` (2) / `medium`
 * (1), then clean (`high`-tier or unscored quality, 0) -- no caveat.
 */
function ocrSeverityOf(provenance: ProvenanceFields): OcrSeverity {
  if (provenance.ocr_status === 'failed') {
    return { severity: 3, caveat: 'status: failed' };
  }
  const tier = provenance.ocr_quality?.tier;
  if (tier === 'low') {
    return { severity: 2, caveat: 'quality: low' };
  }
  if (tier === 'medium') {
    return { severity: 1, caveat: 'quality: medium' };
  }
  return { severity: 0, caveat: null };
}

/**
 * The edition-level OCR-transcription caveat (spec 015 FR-009; fixes AUDIT-
 * 20260719-01, HIGH): the WORST OCR condition across ALL of the unit's
 * folios, not just the lead folio -- a lead folio that is clean must NOT
 * suppress a disclosure that a LATER folio is sub-`high` or `ocr_status:
 * failed` (Constitution I/III, evidence honesty). Reads every folio's
 * sidecar directly (not the per-page `ArchivePageContent.ocrCondition`
 * apparatus-note string, whose free-text format does not preserve the
 * severity ordering needed to pick a worst); fails loud, naming the sidecar
 * path (via `readProvenance`), on any folio whose sidecar is missing or
 * malformed -- no folio is silently skipped from the aggregation.
 */
async function deriveWorstOcrCaveat(unit: SelectedUnit): Promise<string | null> {
  const provenances = await Promise.all(
    unit.folios.map((folio) =>
      readProvenance(path.join(folio.pageDir, `${folio.folioId}.yml`)),
    ),
  );
  let worst: OcrSeverity = { severity: 0, caveat: null };
  for (const provenance of provenances) {
    const candidate = ocrSeverityOf(provenance);
    if (candidate.severity > worst.severity) {
      worst = candidate;
    }
  }
  return worst.caveat;
}

/**
 * Build the English-path OCR-transcription disclosure (spec 015, FR-013):
 * `engineStatus` composes the pipeline's fixed OCR engine with the LEAD
 * folio's recorded `ocr_status` (e.g. `tesseract 5 (searchable)`) -- engine
 * identity is uniform across one edition's pipeline run, so the lead folio is
 * representative there. `caveat` is the pre-computed worst-across-all-folios
 * condition (see `deriveWorstOcrCaveat`, AUDIT-20260719-01) -- NOT derived
 * from the lead folio alone.
 */
function buildOcrTranscription(
  leadProvenance: ProvenanceFields,
  worstCaveat: string | null,
  context: string,
): OcrTranscription {
  const status = requireNonEmpty(leadProvenance.ocr_status, 'ocr_status', context);
  return {
    engineStatus: `${OCR_ENGINE} (${status})`,
    caveat: worstCaveat,
  };
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

      const leadProvenance = await readLeadProvenance(unit, context);
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
      // WORST OCR condition across all folios, not just the lead
      // (AUDIT-20260719-01).
      const ocrTranscription =
        unit.readingLanguage === 'english'
          ? buildOcrTranscription(leadProvenance, await deriveWorstOcrCaveat(unit), context)
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
