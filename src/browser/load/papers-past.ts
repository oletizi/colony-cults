/**
 * The Papers Past CLIPPING loader path.
 *
 * A Papers Past (NZ National Library) source is a single English-language
 * newspaper article, stored in the archive as a FLAT single-unit directory
 * `archive/cases/<case>/newspapers/<slug>/` that holds ONLY folio sidecars
 * (`f001.yml…fNNN.yml`) -- the article sliced into 2..7 scan-region STRIPS.
 * There is NO `issue.txt`, NO `translation/`, and NO `<date>_<ark>` issue
 * subdirectory, so this path deliberately does NOT go through the Gallica
 * periodical loader (`@/browser/load/issues`) or the not-collected checks.
 *
 * The source resolves to ONE issue (the slug directory) with ONE page whose
 * `strips` are every folio sidecar in `f001…fNNN` order. Its ENGLISH reading
 * text is the OCR `.txt` asset the SSOT repository record points at
 * (`objectStoreKey` in B2); the loader stays SYNCHRONOUS and reads that text
 * from a LOCAL file at `path.join(archiveRoot, ocrKey)` -- `build-snapshot`
 * PRE-FETCHES it from the CDN into the archive worktree before the read.
 *
 * Fail-loud throughout: a missing slug directory, folio sidecar, OCR asset, or
 * OCR file throws naming the source rather than substituting a placeholder.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import type { LoadedSource } from '@/bibliography/load';
import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import type { AcquiredAsset } from '@/model/acquired-asset';
import type {
  ProvenanceRecord,
  RawIssue,
  RawPage,
  RawSource,
} from '@/browser/model';
import { attachIssueSummary, attachSourceSummary } from '@/browser/load/summary';

/** The holding-archive label identifying a Papers Past repository record. */
const PAPERS_PAST_ARCHIVE = 'Papers Past';
/** The Gallica holding-archive label; its presence excludes the clipping path. */
const GALLICA_ARCHIVE_LABEL = 'Gallica / BnF';
/** `fNNN.yml` per-folio image (strip) sidecar name. */
const FOLIO_SIDECAR_PATTERN = /^f(\d+)\.yml$/;
/**
 * The `YYYYMMDD` publication date embedded in a Papers Past article identifier
 * (e.g. `HNS18840103.2.19.3` -> `1884-01-03`): the first run of 8 digits that
 * is immediately followed by a `.` (the article-position suffix separator).
 */
const PP_IDENTIFIER_DATE_PATTERN = /(\d{4})(\d{2})(\d{2})\./;

/** The OCR text asset a Papers Past record points at (B2-resident `.txt`). */
export interface PapersPastOcrAsset {
  /** The `object_store` key of the OCR `.txt` (a `…/<sha>.txt` in B2). */
  objectStoreKey: string;
  /** The OCR text artifact's sha256 checksum (the provenance-rail hash). */
  checksum: string;
}

/**
 * Is `loaded` a Papers Past clipping source? True iff it has a repository
 * record whose `sourceArchive` is `Papers Past` and NO `Gallica / BnF` record
 * (a Gallica record routes to the standard periodical/monograph loader).
 */
export function isPapersPastSource(loaded: LoadedSource): boolean {
  const hasPapersPast = loaded.records.some((r) => r.sourceArchive === PAPERS_PAST_ARCHIVE);
  const hasGallica = loaded.records.some((r) => r.sourceArchive === GALLICA_ARCHIVE_LABEL);
  return hasPapersPast && !hasGallica;
}

/**
 * Resolves the OCR text asset (`objectStoreKey` + `checksum`) a Papers Past
 * source's repository record points at -- the `role: ocr-text` asset whose
 * `mediaType` is `text/plain`. Shared by `build-snapshot`'s CDN pre-fetch and
 * the synchronous loader. Fail-loud: no Papers Past record, or no usable OCR
 * asset, throws naming the source.
 */
export function papersPastOcrAsset(loaded: LoadedSource): PapersPastOcrAsset {
  const sourceId = loaded.source.sourceId;
  const record = papersPastRecord(loaded, sourceId);
  return ocrAsset(record, sourceId);
}

/**
 * Loads a Papers Past clipping source into its image-UNRESOLVED {@link RawSource}
 * (one issue, one multi-strip page). `title` is the SSOT canonical title
 * (computed by the caller). `archiveRoot` must contain both the slug directory
 * of folio sidecars AND the pre-fetched OCR `.txt` at `ocrKey`.
 */
export function loadPapersPastSource(
  archiveRoot: string,
  loaded: LoadedSource,
  title: string
): RawSource {
  const { source } = loaded;
  const sourceId = source.sourceId;
  const record = papersPastRecord(loaded, sourceId);

  const unit = resolvePapersPastUnit(archiveRoot, source.case, sourceId);
  const folios = listFolios(unit.dir);
  if (folios.length === 0) {
    throw new Error(
      `loadCorpus(${sourceId}): Papers Past slug directory ${unit.dir} has no folio ` +
        'sidecars (fNNN.yml) -- a clipping must have at least one image strip.'
    );
  }

  const strips = folios.map((folio) => ({
    folioId: folio.folioId,
    objectStoreKey: readFolio(unit.dir, folio.folioId).objectStoreKey,
  }));
  const first = readFolio(unit.dir, folios[0].folioId);

  const ark = papersPastArk(record, sourceId);
  const date = derivePapersPastDate(record, sourceId);
  const ocr = ocrAsset(record, sourceId);
  const english = readOcrText(archiveRoot, ocr.objectStoreKey, sourceId);

  const provenance: ProvenanceRecord = {
    sourceId,
    ark,
    date,
    rights: first.rightsStatus,
    page: 'p001',
    sha256: ocr.checksum,
  };

  const page: RawPage = {
    pageId: 'p001',
    folioId: folios[0].folioId,
    ark,
    objectStoreKey: first.objectStoreKey,
    imageSha256: first.imageSha256,
    strips,
    // English clipping: no French source layer; the OCR IS the reading text.
    ocrFrench: '',
    correctedFrench: null,
    english,
    ocrCondition: null,
    provenance,
  };

  // The clipping's single unit dir doubles as both the issue dir and the
  // source(-rollup) dir -- there is no separate newspapers/<slug> parent to
  // share across issues, unlike a periodical (mirrors the monograph case in
  // raw-corpus.ts's loadSource). attachIssueSummary/attachSourceSummary are
  // the SAME shared enrichment helpers the standard Gallica path routes
  // through (src/browser/load/raw-corpus.ts), so this loader cannot silently
  // diverge and drop a present concise-summary artifact (AUDIT-20260722-01).
  const issue: RawIssue = attachIssueSummary(
    {
      issueId: unit.issueId,
      date,
      sequence: 1,
      pages: [page],
    },
    unit.dir
  );

  const rawSource: RawSource = {
    sourceId,
    title,
    kind: 'periodical',
    language: 'English',
    ark,
    rights: first.rightsStatus,
    issues: [issue],
  };

  return attachSourceSummary(rawSource, unit.dir);
}

/** The Papers Past repository record, or throw naming the source. */
function papersPastRecord(loaded: LoadedSource, sourceId: string): AuthoredRepositoryRecord {
  const record = loaded.records.find((r) => r.sourceArchive === PAPERS_PAST_ARCHIVE);
  if (record === undefined) {
    throw new Error(
      `loadCorpus(${sourceId}): no "${PAPERS_PAST_ARCHIVE}" repository record -- ` +
        'cannot load this source as a Papers Past clipping.'
    );
  }
  return record;
}

/** The OCR text asset (`role: ocr-text`, text/plain), or throw naming the source. */
function ocrAsset(record: AuthoredRepositoryRecord, sourceId: string): PapersPastOcrAsset {
  const assets: AcquiredAsset[] = record.assets ?? [];
  const ocr = assets.find(
    (a) => a.role === 'ocr-text' || a.mediaType.startsWith('text/plain')
  );
  if (ocr === undefined) {
    throw new Error(
      `loadCorpus(${sourceId}): Papers Past record has no OCR-text asset ` +
        '(role "ocr-text" / mediaType "text/plain") -- cannot resolve the reading text.'
    );
  }
  const key = ocr.objectStoreKey.trim();
  if (key.length === 0) {
    throw new Error(
      `loadCorpus(${sourceId}): Papers Past OCR-text asset has an empty objectStoreKey.`
    );
  }
  const checksum = ocr.checksum.trim();
  if (checksum.length === 0) {
    throw new Error(
      `loadCorpus(${sourceId}): Papers Past OCR-text asset has an empty checksum.`
    );
  }
  return { objectStoreKey: key, checksum };
}

/** The source identifier (the record's `sourceUrl`, e.g. the Papers Past URL). */
function papersPastArk(record: AuthoredRepositoryRecord, sourceId: string): string {
  const url = record.sourceUrl?.trim();
  if (!url) {
    throw new Error(
      `loadCorpus(${sourceId}): Papers Past record has no "sourceUrl" -- ` +
        'cannot resolve the source identifier (the empty catalog_url means the ' +
        'sourceUrl is the generalized identifier).'
    );
  }
  return url;
}

/**
 * Derives the article's ISO publication date, in a documented order of
 * preference (each candidate is REAL data, not a placeholder fallback):
 *
 *  1. the `YYYYMMDD` embedded in the Papers Past identifier
 *     (`HNS18840103.2.19.3` -> `1884-01-03`) -- the publication date;
 *  2. else the record's `retrievedAt` timestamp date portion -- the
 *     acquisition date, a last resort when no identifier date is parseable.
 *
 * @throws Error naming the source if neither yields a date.
 */
function derivePapersPastDate(record: AuthoredRepositoryRecord, sourceId: string): string {
  const identifierValue =
    (record.identifiers ?? []).find((id) => id.type === 'papers-past')?.value ??
    (record.identifiers ?? [])[0]?.value;
  if (identifierValue !== undefined) {
    const match = identifierValue.match(PP_IDENTIFIER_DATE_PATTERN);
    if (match !== null) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
  }

  if (record.retrievedAt !== undefined) {
    const iso = record.retrievedAt.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso !== null) {
      return iso[1];
    }
  }

  throw new Error(
    `loadCorpus(${sourceId}): cannot derive the Papers Past article date -- ` +
      'no YYYYMMDD in the record identifier and no parseable "retrievedAt" timestamp.'
  );
}

/** One folio (strip) enumerated from a `fNNN.yml` sidecar, ordered by number. */
interface Folio {
  folioId: string;
  num: number;
}

/** Lists folios from the slug directory's `fNNN.yml` sidecars, ordered by number. */
function listFolios(dir: string): Folio[] {
  const folios: Folio[] = [];
  for (const name of readdirSync(dir)) {
    const match = FOLIO_SIDECAR_PATTERN.exec(name);
    if (match === null) {
      continue;
    }
    folios.push({ folioId: path.basename(name, '.yml'), num: Number.parseInt(match[1], 10) });
  }
  folios.sort((a, b) => a.num - b.num);
  return folios;
}

/** The fields read from one strip's `fNNN.yml` folio sidecar. */
interface FolioMeta {
  objectStoreKey: string | null;
  imageSha256: string | null;
  rightsStatus: string;
}

/**
 * Reads a strip's `fNNN.yml` sidecar: its `object_store.key` (the B2 strip
 * image), top-level `sha256` (the image-master checksum), and `rights_status`.
 * Fail-loud on a missing/non-mapping sidecar or a missing `rights_status`; the
 * image handles are permitted to be `null` (additive, provider-ignored) but
 * are present on every observed Papers Past strip.
 */
function readFolio(dir: string, folioId: string): FolioMeta {
  const sidecarPath = path.join(dir, `${folioId}.yml`);
  if (!existsSync(sidecarPath)) {
    throw new Error(`loadCorpus: missing Papers Past folio sidecar ${sidecarPath}.`);
  }
  const parsed: unknown = parseYaml(readFileSync(sidecarPath, 'utf-8'));
  if (!isRecord(parsed)) {
    throw new Error(`loadCorpus: Papers Past folio sidecar ${sidecarPath} is not a YAML mapping.`);
  }

  const objectStore = parsed.object_store;
  const key = isRecord(objectStore) ? objectStore.key : undefined;
  const objectStoreKey = typeof key === 'string' && key.trim().length > 0 ? key : null;

  const sha = parsed.sha256;
  const imageSha256 = typeof sha === 'string' && sha.trim().length > 0 ? sha : null;

  const rights = parsed.rights_status;
  if (typeof rights !== 'string' || rights.trim().length === 0) {
    throw new Error(
      `loadCorpus: Papers Past folio sidecar ${sidecarPath} is missing required "rights_status".`
    );
  }

  return { objectStoreKey, imageSha256, rightsStatus: rights };
}

/** The `id` of the first `fNNN.yml` sidecar in `dir`, or `null` (not a clipping dir). */
function firstFolioId(dir: string): string | null {
  const folios = listFolios(dir);
  if (folios.length === 0) {
    return null;
  }
  const sidecarPath = path.join(dir, `${folios[0].folioId}.yml`);
  const parsed: unknown = parseYaml(readFileSync(sidecarPath, 'utf-8'));
  if (!isRecord(parsed)) {
    return null;
  }
  const id = parsed.id;
  return typeof id === 'string' && id.trim().length > 0 ? id : null;
}

/** The resolved on-disk clipping unit (its slug directory). */
interface PapersPastUnit {
  issueId: string;
  dir: string;
}

/**
 * Resolves the slug directory for `sourceId` by SCANNING
 * `archive/cases/<case>/newspapers/` for the single subdirectory whose folio
 * sidecars carry `id: "<sourceId>"` (mirroring the monograph unit resolution;
 * the Gallica periodical slug directory has no top-level `fNNN.yml`, so it is
 * skipped). Deterministic: entries are sorted. Fail-loud: no case, no
 * newspapers directory, or no matching slug directory throws naming the source.
 */
function resolvePapersPastUnit(
  archiveRoot: string,
  sourceCase: string | undefined,
  sourceId: string
): PapersPastUnit {
  const caseName = sourceCase?.trim();
  if (!caseName) {
    throw new Error(
      `loadCorpus(${sourceId}): SSOT has no "case" -- cannot resolve the Papers Past directory.`
    );
  }

  const newspapersDir = path.join(archiveRoot, 'archive', 'cases', caseName, 'newspapers');
  if (!existsSync(newspapersDir)) {
    throw new Error(
      `loadCorpus(${sourceId}): newspapers directory does not exist: ${newspapersDir}. ` +
        'Verify CORPUS_ARCHIVE_PATH points to a clone containing this source.'
    );
  }

  for (const name of readdirSync(newspapersDir).sort()) {
    const dir = path.join(newspapersDir, name);
    if (!statSync(dir).isDirectory()) {
      continue;
    }
    if (firstFolioId(dir) === sourceId) {
      return { issueId: name, dir };
    }
  }

  throw new Error(
    `loadCorpus(${sourceId}): no slug directory under ${newspapersDir} has a folio sidecar ` +
      `whose "id" matches ${JSON.stringify(sourceId)}. ` +
      'A Papers Past clipping is the newspapers/<slug>/ directory whose fNNN.yml sidecars ' +
      'carry id: "<sourceId>".'
  );
}

/**
 * Reads the pre-fetched OCR reading text from the LOCAL archive worktree at
 * `path.join(archiveRoot, ocrKey)`. `build-snapshot` fetches it from the CDN
 * into that path before the read; the loader stays synchronous. Fail-loud: a
 * missing or empty file throws naming the source + key.
 */
function readOcrText(archiveRoot: string, ocrKey: string, sourceId: string): string {
  const ocrPath = path.join(archiveRoot, ocrKey);
  if (!existsSync(ocrPath)) {
    throw new Error(
      `loadCorpus(${sourceId}): Papers Past OCR text not found at ${ocrPath}. ` +
        'It is a B2-resident asset that build-snapshot pre-fetches from the CDN into the ' +
        'archive worktree before the read.'
    );
  }
  const text = readFileSync(ocrPath, 'utf-8');
  if (text.trim().length === 0) {
    throw new Error(
      `loadCorpus(${sourceId}): Papers Past OCR text at ${ocrPath} is empty.`
    );
  }
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
