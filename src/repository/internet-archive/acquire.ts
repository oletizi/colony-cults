/**
 * `acquireInternetArchiveItem` -- the full `acquire` orchestration for the
 * Internet Archive acquisition path (T025, specs/013-archiveorg-acquisition-path,
 * contracts/internet-archive-adapter.md `acquire` section). Extracted from
 * `adapter.ts` so the adapter stays a thin facade and both files stay under the
 * size budget.
 *
 * This module OWNS NO fetch/parse/extract logic of its own -- it COMPOSES the
 * already-built + tested halves behind constructor DI (Principle VI) in the
 * contract's mandated order (each numbered step is marked inline in
 * `acquireInternetArchiveItem` below). The rights gate is first and fail-closed
 * before ANY fetch (IA-INV-B); the upload loop is LAST, so any earlier gate
 * failing writes NOTHING to the object store; `dryRun` withholds every B2 write
 * and retains staging (Principle XII).
 */

import { mkdir, readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type {
  AcquisitionContext,
  AcquisitionResult,
  MetadataSnapshot,
} from '@/repository/adapter';
import type { AcquiredAsset } from '@/model/acquired-asset';
import type { RepositoryRecord } from '@/model/repository-record';
import type {
  ExcludedLeaf,
  LeafRange,
  PageMethodProvenance,
} from '@/model/quality-assessment';
import type { ObjectStore } from '@/archive/object-store';
import type { CommandRunner, PopplerRunner } from '@/pdf/poppler/runner';
import { sha256OfBytes } from '@/archive/checksum';
import type {
  ArchiveHttpClient,
  ItemMetadata,
} from '@/repository/internet-archive/metadata';
import { fetchItemMetadata } from '@/repository/internet-archive/metadata';
import type { SelectedFiles } from '@/repository/internet-archive/file-select';
import { selectSourceFiles } from '@/repository/internet-archive/file-select';
import type { ScandataLeaf } from '@/repository/internet-archive/scandata';
import { parseScandata } from '@/repository/internet-archive/scandata';
import type { QualityGate } from '@/repository/internet-archive/quality-gate';
import { enforceQualityGate, seedProposedRange } from '@/repository/internet-archive/quality-gate';
import { assessFidelity } from '@/repository/internet-archive/fidelity';
import { extractPages } from '@/repository/internet-archive/extract';
import { explodeImageSet } from '@/repository/internet-archive/image-set';
import {
  cleanupStaging,
  pageMasterObjectKey,
  sourceObjectKey,
  stageFile,
  stagingDir,
} from '@/repository/internet-archive/staging';
import { recordItemSnapshot } from '@/repository/internet-archive/snapshot';

/**
 * Acquire-time dependencies, as handed down from the adapter. Every field
 * beyond `client` and `now` is OPTIONAL here (a resolve-only adapter is
 * constructed with just `client`); {@link requireAcquireDeps} fails loud when
 * an actually-required one is absent at acquire time.
 */
export interface InternetArchiveAcquireDeps {
  client: ArchiveHttpClient;
  poppler?: PopplerRunner;
  objectStore?: ObjectStore;
  qualityGate?: QualityGate;
  unzip?: CommandRunner;
  convert?: CommandRunner;
  stagingRoot?: string;
  baseDir?: string;
  now: () => string;
}

/** The same deps with every acquire-time field proven present. */
type ResolvedAcquireDeps = Required<InternetArchiveAcquireDeps>;

/** One produced page-master, normalized across the PDF-extract + image-set paths. */
interface ProducedMaster {
  logicalPage: number;
  filePath: string;
  sourceUrl: string;
  provenance: PageMethodProvenance;
}

/** One asset ready to upload, paired with the bytes its checksum was computed over. */
interface UploadItem {
  asset: AcquiredAsset;
  bytes: Uint8Array;
  contentType: string;
}

/** The archive.org download URL for a named file within an item. */
function downloadUrl(itemId: string, fileName: string): string {
  return `https://archive.org/download/${itemId}/${fileName}`;
}

/** Fail loud unless a required acquire-time dependency is present, narrowing away `undefined`. */
function req<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(
      `InternetArchiveAdapter.acquire: missing required acquire-time dependency "${name}" -- this ` +
        'adapter was constructed resolve-only and cannot acquire assets.',
    );
  }
  return value;
}

/** Prove every acquire-time dependency is present (fail-loud, no `as`). */
function requireAcquireDeps(deps: InternetArchiveAcquireDeps): ResolvedAcquireDeps {
  return {
    client: deps.client,
    poppler: req(deps.poppler, 'poppler'),
    objectStore: req(deps.objectStore, 'objectStore'),
    qualityGate: req(deps.qualityGate, 'qualityGate'),
    unzip: req(deps.unzip, 'unzip'),
    convert: req(deps.convert, 'convert'),
    stagingRoot: req(deps.stagingRoot, 'stagingRoot'),
    baseDir: req(deps.baseDir, 'baseDir'),
    now: deps.now,
  };
}

/** The `ia-item` identifier value on the record, failing loud when absent. */
function itemIdOf(record: RepositoryRecord): string {
  const identifier = (record.identifiers ?? []).find((id) => id.type === 'ia-item');
  const value = identifier?.value?.trim() ?? '';
  if (value.length === 0) {
    throw new Error(
      `acquireInternetArchiveItem: the RepositoryRecord for "${record.sourceId}" at ` +
        `"${record.sourceArchive}" carries no { type: 'ia-item' } identifier -- nothing to acquire.`,
    );
  }
  return value;
}

/**
 * Expected page count for the quality gate: the scandata leaf count when present
 * (authoritative), else the item metadata's `imagecount` (contract step 3a / D-10).
 */
function expectedPageCountOf(
  selected: SelectedFiles,
  scanLeaves: readonly ScandataLeaf[],
  meta: ItemMetadata,
): number {
  if (selected.scandata !== undefined) {
    return scanLeaves.length;
  }
  return imageCountFromRaw(meta);
}

/** Shape-check helper: is `value` a non-null, non-array object? */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read `metadata.imagecount` out of the raw item response, failing loud when absent/non-numeric. */
function imageCountFromRaw(meta: ItemMetadata): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(meta.raw);
  } catch (cause) {
    throw new Error(
      `acquireInternetArchiveItem: could not re-parse item metadata for "${meta.identifier}": ` +
        `${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const metadata = isRecord(parsed) ? parsed.metadata : undefined;
  const rawCount = isRecord(metadata) ? metadata.imagecount : undefined;
  const count = typeof rawCount === 'string' ? Number(rawCount) : rawCount;
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) {
    throw new Error(
      `acquireInternetArchiveItem: item "${meta.identifier}" has no scandata AND no usable ` +
        'metadata.imagecount -- cannot determine an expected page count without fabricating one.',
    );
  }
  return count;
}

/** The `.tif` / `.jp2` extension of the selected image set, failing loud otherwise. */
function imageSetExtension(fileName: string): 'tif' | 'jp2' {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('_jp2.zip')) {
    return 'jp2';
  }
  if (lower.endsWith('_tif.zip')) {
    return 'tif';
  }
  throw new Error(
    `acquireInternetArchiveItem: image-set file "${fileName}" is neither a _jp2.zip nor a _tif.zip ` +
      '-- refusing to guess its layout.',
  );
}

/**
 * Front/back-matter leaves to hand `extractPages`: non-`Normal` scandata leaves
 * OUTSIDE the approved range (a non-`Normal` leaf inside the range is left for
 * the extractor's own fail-loud contradiction).
 */
function excludedLeafTypesOutsideRange(
  scanLeaves: readonly ScandataLeaf[],
  range: LeafRange,
): Map<number, string> {
  const map = new Map<number, string>();
  for (const leaf of scanLeaves) {
    if (leaf.pageType !== 'Normal' && (leaf.leafNum < range.start || leaf.leafNum > range.end)) {
      map.set(leaf.leafNum, leaf.pageType);
    }
  }
  return map;
}

/** Resolve the concrete file a poppler `outputPath` PREFIX produced; fail loud on 0 or >1 matches. */
async function resolveProducedFile(outputPrefix: string): Promise<string> {
  const dir = dirname(outputPrefix);
  const base = basename(outputPrefix);
  const entries = await readdir(dir);
  const matches = entries.filter(
    (name) => name === base || name.startsWith(`${base}.`) || name.startsWith(`${base}-`),
  );
  if (matches.length === 0) {
    throw new Error(
      `acquireInternetArchiveItem: no produced page-master file for prefix "${outputPrefix}" in ${dir}.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `acquireInternetArchiveItem: ambiguous produced page-master files for prefix ` +
        `"${outputPrefix}": ${matches.join(', ')}.`,
    );
  }
  return join(dir, matches[0]);
}

/** The `.yml` provenance sidecar path for an asset, mirroring its object key. */
function provenancePathFor(objectStoreKey: string): string {
  return objectStoreKey.replace(/\.[^./]+$/, '.yml');
}

/**
 * Produce page-masters per the fidelity decision: `pdf` -> `extractPages`;
 * `image-set` -> stage the zip then `explodeImageSet`. Returns the normalized
 * masters + excluded leaves (the image-set path records none).
 */
async function produceMasters(params: {
  deps: ResolvedAcquireDeps;
  itemId: string;
  selected: SelectedFiles;
  scanLeaves: readonly ScandataLeaf[];
  approvedRange: LeafRange;
  fidelitySource: 'pdf' | 'image-set';
  pdfPath: string;
  pdfUrl: string;
  staging: string;
}): Promise<{ masters: ProducedMaster[]; excludedLeaves: ExcludedLeaf[] }> {
  const { deps, itemId, selected, scanLeaves, approvedRange, fidelitySource, pdfPath, pdfUrl } =
    params;

  if (fidelitySource === 'pdf') {
    const pagesDir = join(params.staging, 'pages');
    await mkdir(pagesDir, { recursive: true });
    const extraction = await extractPages({
      pdfPath,
      approvedRange,
      excludedLeafTypes: excludedLeafTypesOutsideRange(scanLeaves, approvedRange),
      scanLeaves,
      outDir: pagesDir,
      poppler: deps.poppler,
    });
    const masters: ProducedMaster[] = [];
    for (const page of extraction.pages) {
      masters.push({
        logicalPage: page.logicalPage,
        filePath: await resolveProducedFile(page.outputPath),
        sourceUrl: pdfUrl,
        provenance: page.provenance,
      });
    }
    return { masters, excludedLeaves: extraction.excludedLeaves };
  }

  // Fidelity judged the PDF materially degraded -> use the full-resolution set.
  if (selected.imageSet === undefined) {
    throw new Error(
      `acquireInternetArchiveItem: item "${itemId}" failed the fidelity gate (image set required) ` +
        'but exposes no _jp2.zip / _tif.zip image set -- refusing to explode a degraded PDF.',
    );
  }
  const extension = imageSetExtension(selected.imageSet.name);
  const imageSetUrl = downloadUrl(itemId, selected.imageSet.name);
  const zipPath = join(params.staging, selected.imageSet.name);
  await stageFile(imageSetUrl, zipPath, deps.client);
  const imageSetMasters = await explodeImageSet({
    zipPath,
    itemId,
    approvedRange,
    extension,
    outDir: join(params.staging, 'image-set'),
    unzip: deps.unzip,
    convert: deps.convert,
  });
  const masters: ProducedMaster[] = imageSetMasters.map((master) => ({
    logicalPage: master.logicalPage,
    filePath: master.pngPath,
    sourceUrl: imageSetUrl,
    provenance: master.provenance,
  }));
  return { masters, excludedLeaves: [] };
}

/** Assemble the repository-source + page-master upload items (bytes read from staging). */
async function assembleUploadItems(params: {
  itemId: string;
  pdfPath: string;
  pdfUrl: string;
  stagedSha256: string;
  stagedByteLength: number;
  masters: readonly ProducedMaster[];
}): Promise<UploadItem[]> {
  const { itemId, pdfPath, pdfUrl, stagedSha256, stagedByteLength, masters } = params;

  const sourceBytes = new Uint8Array(await readFile(pdfPath));
  const sourceKey = sourceObjectKey(itemId, stagedSha256);
  const sourceAsset: AcquiredAsset = {
    sourceUrl: pdfUrl,
    mediaType: 'application/pdf',
    objectStoreKey: sourceKey,
    checksum: stagedSha256,
    byteLength: stagedByteLength,
    provenancePath: provenancePathFor(sourceKey),
    role: 'repository-source',
  };
  const items: UploadItem[] = [
    { asset: sourceAsset, bytes: sourceBytes, contentType: 'application/pdf' },
  ];

  for (const master of masters) {
    const bytes = new Uint8Array(await readFile(master.filePath));
    const checksum = sha256OfBytes(bytes);
    const key = pageMasterObjectKey(itemId, master.logicalPage, checksum);
    const asset: AcquiredAsset = {
      sourceUrl: master.sourceUrl,
      mediaType: 'image/png',
      objectStoreKey: key,
      checksum,
      byteLength: bytes.byteLength,
      provenancePath: provenancePathFor(key),
      role: 'page-master',
      sequence: master.logicalPage,
    };
    items.push({ asset, bytes, contentType: 'image/png' });
  }
  return items;
}

/** Upload one asset idempotently (INV-E): match -> skip; mismatch -> fail-loud; absent -> PUT. */
async function uploadIdempotent(objectStore: ObjectStore, item: UploadItem): Promise<void> {
  const { asset, bytes, contentType } = item;
  const head = await objectStore.head(asset.objectStoreKey);
  if (head.exists) {
    if (head.sha256 === asset.checksum) {
      return; // already acquired -- identical bytes at this key
    }
    throw new Error(
      `acquireInternetArchiveItem: object "${asset.objectStoreKey}" already exists with checksum ` +
        `${head.sha256 ?? '(none)'} but this acquisition computed ${asset.checksum} -- the remote ` +
        'bytes changed; refusing to overwrite (INV-E).',
    );
  }
  await objectStore.put(asset.objectStoreKey, bytes, {
    sha256: asset.checksum,
    contentType,
  });
}

/** Acquire an Internet Archive item -- the composed, fail-closed pipeline (see module header). */
export async function acquireInternetArchiveItem(
  record: RepositoryRecord,
  ctx: AcquisitionContext,
  rawDeps: InternetArchiveAcquireDeps,
): Promise<AcquisitionResult> {
  if (record === null || typeof record !== 'object') {
    throw new Error('acquireInternetArchiveItem: record is required.');
  }

  // 1. Rights gate (IA-INV-B): assert BEFORE any dependency check or fetch.
  if (record.rightsAssessment?.rightsStatus !== 'public-domain') {
    const actual = record.rightsAssessment?.rightsStatus ?? '(no rightsAssessment)';
    throw new Error(
      `acquireInternetArchiveItem: the RepositoryRecord for "${record.sourceId}" at ` +
        `"${record.sourceArchive}" has rightsStatus "${actual}" -- only a public-domain assessment ` +
        'permits acquisition (fail-closed, IA-INV-B).',
    );
  }

  const deps = requireAcquireDeps(rawDeps);
  const itemId = itemIdOf(record);
  const repositoryRecordId = `${record.sourceId} @ ${record.sourceArchive}`;

  // 2. Resolve: metadata + file selection + write-once snapshot.
  const meta = await fetchItemMetadata(itemId, deps.client);
  const selected = selectSourceFiles(meta.files);
  const retrievedAt = deps.now();
  const stamp = retrievedAt.replace(/[^0-9A-Za-z]/g, '');
  record.metadataSnapshot = await recordItemSnapshot(
    deps.baseDir,
    record.sourceId,
    meta,
    retrievedAt,
    stamp,
  );
  const metadataSnapshot: MetadataSnapshot = { raw: meta.raw, retrievedAt };

  // 3. Stage the PDF under stagingRoot; record fixity.
  const staging = stagingDir(deps.stagingRoot, itemId);
  const pdfUrl = downloadUrl(itemId, selected.pdf.name);
  const staged = await stageFile(pdfUrl, join(staging, 'source.pdf'), deps.client);

  // 4. observedPageCount (poppler); expectedPageCount (scandata leaves | imagecount).
  const observedPageCount = (await deps.poppler.info(staged.path)).pages;
  let scanLeaves: ScandataLeaf[] = [];
  if (selected.scandata !== undefined) {
    const scandataXml = await deps.client.getText(downloadUrl(itemId, selected.scandata.name));
    scanLeaves = parseScandata(scandataXml);
  }
  const expectedPageCount = expectedPageCountOf(selected, scanLeaves, meta);

  // 5. Quality gate (IA-INV-C): seed range -> operator assess -> fail-closed enforce.
  const proposedRange = seedProposedRange(scanLeaves);
  const assessment = await deps.qualityGate.assess({
    pdfPath: staged.path,
    sourceFileChecksum: staged.sha256,
    expectedPageCount,
    observedPageCount,
    proposedRange,
  });
  enforceQualityGate(assessment, staged.sha256);
  record.qualityAssessment = assessment;

  // 6. Fidelity probe (FR-009): explode the PDF, or fetch the image set.
  const decision = await assessFidelity({
    pdfPath: staged.path,
    scanLeaves,
    leafRange: assessment.approvedLeafRange,
    poppler: deps.poppler,
  });

  // 7. Produce the page-masters from the chosen source.
  const { masters, excludedLeaves } = await produceMasters({
    deps,
    itemId,
    selected,
    scanLeaves,
    approvedRange: assessment.approvedLeafRange,
    fidelitySource: decision.source,
    pdfPath: staged.path,
    pdfUrl,
    staging,
  });

  // 8. Assemble assets (exactly one repository-source + one page-master per page).
  const uploadItems = await assembleUploadItems({
    itemId,
    pdfPath: staged.path,
    pdfUrl,
    stagedSha256: staged.sha256,
    stagedByteLength: staged.byteLength,
    masters,
  });
  const assets = uploadItems.map((item) => item.asset);

  // 10. Dry run: everything to staging, but NO B2 write and NO cleanup (retain).
  if (ctx?.dryRun === true) {
    return {
      repositoryRecordId,
      assets: [],
      metadataSnapshot,
      complete: false,
      reconciliationRequired: true,
    };
  }

  // 9. Upload with idempotent skip / remote-change fail-loud.
  for (const item of uploadItems) {
    await uploadIdempotent(deps.objectStore, item);
  }

  // 11. Success: cleanup staging, record excluded leaves.
  await cleanupStaging(staging);
  record.excludedLeaves = excludedLeaves;

  return {
    repositoryRecordId,
    assets,
    metadataSnapshot,
    complete: true,
    reconciliationRequired: true,
  };
}
