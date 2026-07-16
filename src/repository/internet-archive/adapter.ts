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
 *
 * THIS FILE IS A SKELETON (T018/T019): only `resolve` and
 * `collectRightsEvidence` are implemented. `acquire` (the fetch -> quality
 * gate -> fidelity probe -> page-to-leaf -> upload pipeline,
 * contracts/internet-archive-adapter.md `acquire` section) is a later task
 * (T025) and is stubbed here as an explicit, fail-loud "not yet implemented"
 * throw -- never a silent no-op, never fabricated assets.
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
import { fetchItemMetadata } from '@/repository/internet-archive/metadata';
import { selectSourceFiles } from '@/repository/internet-archive/file-select';
import { collectRightsEvidence as buildRightsEvidence } from '@/repository/internet-archive/rights';

/**
 * Construction dependencies for {@link InternetArchiveAdapter}.
 *
 * NOTE (T018/T019 skeleton): `acquire`-time dependencies (a `PopplerRunner`,
 * an `ObjectStore`, a `QualityGate`, a `stagingRoot`, and a clock -- see
 * `contracts/internet-archive-adapter.md`'s `InternetArchiveAdapterDeps`) are
 * intentionally NOT declared here. They are added when `acquire` is actually
 * implemented (T025). Stubbing them now with fakes/placeholders would invite
 * exactly the kind of fabricated, untested wiring this codebase forbids
 * (Principle V) -- an adapter constructed today can only ever resolve items
 * and propose rights evidence, never acquire.
 */
export interface InternetArchiveAdapterDeps {
  /** Fetch client for item metadata (and, later, asset bytes). REQUIRED. */
  client: ArchiveHttpClient;
}

/**
 * `InternetArchiveAdapter` -- resolve + rights-evidence for archive.org
 * `texts` items, composed from injected parts. `acquire` is a fail-loud stub
 * until T025.
 */
export class InternetArchiveAdapter implements RepositoryAdapter {
  readonly repository = 'internet-archive' as const;

  private readonly client: ArchiveHttpClient;

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
   * NOT YET IMPLEMENTED (T025). The full fetch -> quality-gate -> fidelity
   * probe -> page-to-leaf -> upload pipeline
   * (`contracts/internet-archive-adapter.md`'s `acquire` section) requires
   * dependencies this skeleton's {@link InternetArchiveAdapterDeps}
   * deliberately does not declare (a `PopplerRunner`, an `ObjectStore`, a
   * `QualityGate`, a `stagingRoot`, a clock). Fails loud rather than
   * returning a fabricated or partial `AcquisitionResult`.
   */
  async acquire(_record: RepositoryRecord, _ctx: AcquisitionContext): Promise<AcquisitionResult> {
    throw new Error('InternetArchiveAdapter.acquire: not yet implemented (T025)');
  }
}

/** The archive.org download URL for a named file within an item. */
function downloadUrl(itemId: string, fileName: string): string {
  return `https://archive.org/download/${itemId}/${fileName}`;
}
