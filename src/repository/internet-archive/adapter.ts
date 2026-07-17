/**
 * `InternetArchiveAdapter` -- the `RepositoryAdapter` (`@/repository/adapter`)
 * for the Internet Archive acquisition path
 * (specs/013-archiveorg-acquisition-path,
 * contracts/internet-archive-adapter.md). Mirrors `NewItalyMuseumAdapter`'s
 * composition + constructor-DI shape (`@/repository/new-italy-museum/adapter`):
 * this class owns NO new fetch/parse logic of its own -- it composes the
 * already-shipped halves:
 *
 *   - `fetchItemMetadata` (`@/repository/internet-archive/metadata`) -- the
 *     deterministic `GET /metadata/<id>` client + typed parse. Throws on a
 *     non-`texts` item or a missing identifier/title (no fabrication,
 *     IA-INV-A) -- `resolve` below relies on this, it does not re-check.
 *   - `selectSourceFiles` (`@/repository/internet-archive/file-select`) --
 *     deterministic, fail-loud file selection over `files[]` (FR-003).
 *   - `collectRightsEvidence` (`@/repository/internet-archive/rights`) -- the
 *     rights-EVIDENCE proposal (never a verdict, INV-B) over the parsed
 *     `ItemMetadata`.
 *   - `acquireInternetArchiveItem`
 *     (`@/repository/internet-archive/acquire`) -- the full fetch -> quality
 *     gate -> fidelity probe -> page-to-leaf -> upload pipeline. `acquire`
 *     below is a thin facade that validates its acquire-time deps are present
 *     and delegates; the orchestration lives in that module so this file stays
 *     small.
 */

import type {
  AcquisitionContext,
  AcquisitionResult,
  AssetLocator,
  RepositoryAdapter,
  RepositoryLocator,
  ResolutionContext,
  ResolvedRepositoryItem,
  RightsEvidence,
} from '@/repository/adapter';
import type { RepositoryRecord } from '@/model/repository-record';
import type { GroundedExtraction, MuseumItemFields } from '@/extraction/structured-extractor';
import type { ArchiveHttpClient, ItemMetadata } from '@/repository/internet-archive/metadata';
import type { ObjectStore } from '@/archive/object-store';
import type { CommandRunner, PopplerRunner } from '@/pdf/poppler/runner';
import type { QualityGate } from '@/repository/internet-archive/quality-gate';
import { fetchItemMetadata } from '@/repository/internet-archive/metadata';
import { selectSourceFiles } from '@/repository/internet-archive/file-select';
import { collectRightsEvidence as buildRightsEvidence } from '@/repository/internet-archive/rights';
import { acquireInternetArchiveItem } from '@/repository/internet-archive/acquire';

/**
 * Construction dependencies for {@link InternetArchiveAdapter}.
 *
 * Only `client` is required at construction: a resolve-only caller (e.g.
 * `bib inventory --repository`) constructs this adapter with just the fetch
 * client and never pays for the acquire-time toolchain. Every acquire-time
 * dependency is OPTIONAL here and validated (fail-loud) inside `acquire` when
 * actually needed -- mirroring how `NewItalyMuseumAdapterDeps.objectStore` is
 * optional-at-construction-but-required-for-acquire.
 */
export interface InternetArchiveAdapterDeps {
  /** Fetch client for item metadata + asset bytes. REQUIRED. */
  client: ArchiveHttpClient;
  /** Injected poppler wrapper (`info`/`imagesList`/`extractImage`/`rasterise`). Required to acquire. */
  poppler?: PopplerRunner;
  /** Object store the assets are PUT to (B2 in prod). Required to acquire. */
  objectStore?: ObjectStore;
  /** Operator quality-gate seam (records the `QualityAssessment`). Required to acquire. */
  qualityGate?: QualityGate;
  /** `unzip` command runner for the image-set fallback. Required to acquire. */
  unzip?: CommandRunner;
  /** `magick`/`convert` command runner for the image-set fallback. Required to acquire. */
  convert?: CommandRunner;
  /** Scratch root under `COLONY_ARCHIVE_ROOT` staging lives under. Required to acquire. */
  stagingRoot?: string;
  /** Base dir the write-once metadata snapshot is recorded under. Required to acquire. */
  baseDir?: string;
  /** Clock for snapshot + assessment timestamps; defaults to wall clock. */
  now?: () => string;
}

/**
 * `InternetArchiveAdapter` -- resolve + rights-evidence for archive.org
 * `texts` items, composed from injected parts. `acquire` is a fail-loud stub
 * until T025.
 */
export class InternetArchiveAdapter implements RepositoryAdapter {
  readonly repository = 'internet-archive' as const;

  private readonly client: ArchiveHttpClient;
  private readonly poppler: PopplerRunner | undefined;
  private readonly objectStore: ObjectStore | undefined;
  private readonly qualityGate: QualityGate | undefined;
  private readonly unzip: CommandRunner | undefined;
  private readonly convert: CommandRunner | undefined;
  private readonly stagingRoot: string | undefined;
  private readonly baseDir: string | undefined;
  private readonly now: () => string;

  /**
   * Threads the `ItemMetadata`-derived `RightsEvidence` computed during
   * `resolve` through to `collectRightsEvidence`, keyed by object identity of
   * the exact `ResolvedRepositoryItem` `resolve` returned.
   *
   * Why a cache instead of re-fetching in `collectRightsEvidence`: the
   * `RepositoryAdapter` interface's `collectRightsEvidence(item)` receives
   * only a `ResolvedRepositoryItem` (whose `metadata` field is typed as
   * `GroundedExtraction<MuseumItemFields>` -- it carries no `rightsRaw` or
   * other archive.org-specific evidence). Re-fetching
   * `https://archive.org/metadata/<id>` a second time to recover that data
   * would pay a redundant network round-trip and risk a non-deterministic
   * result (the remote could have changed between calls) for evidence this
   * adapter already computed once, honestly, during `resolve`. Threading the
   * already-computed evidence through is the honest, frugal choice; a
   * `WeakMap` avoids retaining metadata for items that are no longer
   * referenced.
   */
  private readonly rightsEvidenceByItem = new WeakMap<ResolvedRepositoryItem, RightsEvidence>();

  constructor(deps: InternetArchiveAdapterDeps) {
    if (deps === null || typeof deps !== 'object') {
      throw new Error('InternetArchiveAdapter: deps is required.');
    }
    if (deps.client === null || typeof deps.client !== 'object') {
      throw new Error('InternetArchiveAdapter: deps.client is required (the fetch client).');
    }
    this.client = deps.client;
    this.poppler = deps.poppler;
    this.objectStore = deps.objectStore;
    this.qualityGate = deps.qualityGate;
    this.unzip = deps.unzip;
    this.convert = deps.convert;
    this.stagingRoot = deps.stagingRoot;
    this.baseDir = deps.baseDir;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  /**
   * Resolve an archive.org item-id locator (`locator.value`) to a concrete
   * `texts` item. `fetchItemMetadata` throws (no fabrication, IA-INV-A) when
   * the item does not exist, is not `mediatype: 'texts'`, or is missing a
   * durable `identifier`/`title`; `selectSourceFiles` throws (fail loud) on
   * an absent or ambiguous page-image PDF. Neither check is duplicated here.
   */
  async resolve(
    locator: RepositoryLocator,
    _ctx: ResolutionContext,
  ): Promise<ResolvedRepositoryItem> {
    if (locator === null || typeof locator !== 'object') {
      throw new Error('InternetArchiveAdapter.resolve: locator is required.');
    }
    const itemId = typeof locator.value === 'string' ? locator.value.trim() : '';
    if (itemId.length === 0) {
      throw new Error(
        'InternetArchiveAdapter.resolve: locator.value (the archive.org item id) is required.',
      );
    }

    const meta: ItemMetadata = await fetchItemMetadata(itemId, this.client);
    const selected = selectSourceFiles(meta.files);

    // Compute rights evidence ONCE, here, from the genuinely parsed
    // ItemMetadata -- reused both to ground `metadata` below and to answer
    // `collectRightsEvidence` later (see the cache's doc comment) without a
    // second fetch or a second, divergent grounding computation.
    const rightsEvidence = buildRightsEvidence(meta);
    if (rightsEvidence.date === undefined) {
      throw new Error(
        `InternetArchiveAdapter.resolve: item "${meta.identifier}" has neither "date" nor "year" ` +
          'metadata -- cannot produce the required grounded date field without fabricating it.',
      );
    }

    const groundedMetadata: GroundedExtraction<MuseumItemFields> = {
      date: rightsEvidence.date,
    };
    if (rightsEvidence.creator !== undefined) {
      groundedMetadata.creator = rightsEvidence.creator;
    }

    const assetLocators: AssetLocator[] = [
      { url: downloadUrl(meta.identifier, selected.pdf.name), role: 'pdf' },
    ];
    if (selected.scandata !== undefined) {
      assetLocators.push({
        url: downloadUrl(meta.identifier, selected.scandata.name),
        role: 'scandata',
      });
    }
    if (selected.imageSet !== undefined) {
      assetLocators.push({
        url: downloadUrl(meta.identifier, selected.imageSet.name),
        role: 'image-set',
      });
    }

    const item: ResolvedRepositoryItem = {
      repository: this.repository,
      identifiers: [{ type: 'ia-item', value: meta.identifier }],
      sourceUrl: meta.detailsUrl,
      title: meta.title,
      assetLocators,
      metadata: groundedMetadata,
    };

    this.rightsEvidenceByItem.set(item, rightsEvidence);
    return item;
  }

  /**
   * Collect rights EVIDENCE for a resolved item. PROPOSES only; never
   * authors a rights judgment (INV-B) -- delegates entirely to
   * `@/repository/internet-archive/rights`'s `collectRightsEvidence`, whose
   * result was computed once during this item's `resolve` call and threaded
   * through the identity cache (see that field's doc comment).
   */
  async collectRightsEvidence(item: ResolvedRepositoryItem): Promise<RightsEvidence> {
    if (item === null || typeof item !== 'object') {
      throw new Error('InternetArchiveAdapter.collectRightsEvidence: item is required.');
    }
    const evidence = this.rightsEvidenceByItem.get(item);
    if (evidence === undefined) {
      throw new Error(
        'InternetArchiveAdapter.collectRightsEvidence: no rights evidence is cached for this ' +
          'item -- it must be the exact ResolvedRepositoryItem this adapter\'s own resolve() ' +
          'returned. Refusing to re-fetch archive.org metadata a second time (see the cache\'s ' +
          'doc comment) or to fabricate evidence.',
      );
    }
    return evidence;
  }

  /**
   * Acquire assets for an `ia-item` record -- the full fetch -> quality-gate ->
   * fidelity probe -> page-to-leaf -> upload pipeline
   * (`contracts/internet-archive-adapter.md`'s `acquire` section). A thin
   * facade over `acquireInternetArchiveItem`
   * (`@/repository/internet-archive/acquire`): it forwards this adapter's
   * injected deps (the orchestration validates the acquire-time ones are
   * present and fails loud otherwise) and never re-implements any step.
   */
  async acquire(record: RepositoryRecord, ctx: AcquisitionContext): Promise<AcquisitionResult> {
    return acquireInternetArchiveItem(record, ctx, {
      client: this.client,
      poppler: this.poppler,
      objectStore: this.objectStore,
      qualityGate: this.qualityGate,
      unzip: this.unzip,
      convert: this.convert,
      stagingRoot: this.stagingRoot,
      baseDir: this.baseDir,
      now: this.now,
    });
  }
}

/** The archive.org download URL for a named file within an item. */
function downloadUrl(itemId: string, fileName: string): string {
  return `https://archive.org/download/${itemId}/${fileName}`;
}
