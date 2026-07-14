/**
 * `GallicaAdapter` -- the `RepositoryAdapter` (`@/repository/adapter`) that
 * wraps the SHIPPED Gallica acquisition path so a later task (T012) can route
 * `bib acquire` through the registry -> adapter with NO behavior change.
 *
 * This adapter owns NO new fetch/network code. Everything it needs is INJECTED
 * (composition + constructor DI, {@link GallicaAdapterDeps}):
 *   - `fetch`      -- the shipped `runFetchSource` (`@/cli/fetch-source`),
 *                     narrowed to {@link FetchSourceFn} exactly as
 *                     `runAcquire` (`@/sourcegroup/acquire`) injects it, so the
 *                     page-image/OCR/provenance/object-store pipeline is never
 *                     duplicated and tests never touch the network or B2.
 *   - `resolveArk` -- the rich Gallica OAIRecord resolver
 *                     (`gallicaArkMetadataResolver` from
 *                     `@/sourcegroup/gallica-ark-resolver`, an
 *                     {@link ArkResolver}), used by {@link GallicaAdapter.resolve}.
 *   - `now`        -- a clock, injected for deterministic timestamps; defaults
 *                     to `() => new Date().toISOString()` at the boundary.
 *
 * ADDITIVE (spec 011, T011): `runAcquire` stays as-is; T012 does the cutover.
 * `GallicaAdapter.acquire` REPLICATES `runAcquire`'s record-level core exactly
 * -- see the gate-boundary note on {@link GallicaAdapter.acquire}.
 */

import type {
  AcquisitionContext,
  AcquisitionResult,
  MetadataSnapshot,
  RepositoryAdapter,
  RepositoryLocator,
  ResolutionContext,
  ResolvedRepositoryItem,
  RightsEvidence,
} from '@/repository/adapter';
import type { AcquiredAsset } from '@/model/acquired-asset';
import type { CopyIdentifier, RepositoryRecord } from '@/model/repository-record';
import type { ParsedArgs } from '@/cli/parse';
import type { FetchSourceFn } from '@/sourcegroup/acquire';
import type { ArkMetadata, ArkResolver } from '@/sourcegroup/inventory';
import type {
  GroundedExtraction,
  GroundedField,
  MuseumItemFields,
} from '@/extraction/structured-extractor';
import { issueLandingUrl } from '@/gallica/gallica-client';

/**
 * Gallica-specific acquisition options, carried on the `acquire` context.
 *
 * The shared {@link AcquisitionContext} is (intentionally) an empty extension
 * point; the operator flags the shipped fetch-source path forwards
 * (`--object-store`, `--dry-run`, `--checkpoint`, `--checkpoint-every`) live
 * here, mirroring `AcquireInput`'s passthrough fields on `runAcquire`. All are
 * optional and default to `runAcquire`'s exact defaults (`false` / `undefined`)
 * so a bare `acquire(record, {})` reproduces the pinned baseline args.
 */
export interface GallicaAcquisitionContext extends AcquisitionContext {
  /** Forwarded to the fetcher as `--object-store` (default `false`). */
  objectStore?: boolean;
  /** Forwarded to the fetcher as `--dry-run` (default `false`). */
  dryRun?: boolean;
  /** Forwarded to the fetcher as `--checkpoint` (default `false`). */
  checkpoint?: boolean;
  /** Forwarded to the fetcher as `--checkpoint-every <N>` (default `undefined`). */
  checkpointEvery?: number;
}

/** Constructor dependencies for {@link GallicaAdapter} (all injected; no globals). */
export interface GallicaAdapterDeps {
  /**
   * The injected shipped fetcher (see {@link FetchSourceFn}). REQUIRED -- there
   * is no fallback fetch path. Production wiring passes `runFetchSource`
   * straight through, unchanged.
   */
  fetch: FetchSourceFn;
  /**
   * The rich Gallica OAIRecord resolver (`gallicaArkMetadataResolver(gallica)`
   * -> {@link ArkResolver}). Injected the same way `runInventory`
   * (`@/sourcegroup/inventory`) takes its resolver, so `resolve` never reaches
   * the network directly and stays testable.
   */
  resolveArk: ArkResolver;
  /**
   * Clock for the metadata-snapshot / grounding timestamps, injected for
   * determinism. Defaults to `() => new Date().toISOString()`.
   */
  now?: () => string;
}

/** The record's ark value (the first `ark`-typed copy identifier), if any. */
function arkOf(record: RepositoryRecord): string | undefined {
  const identifier: CopyIdentifier | undefined = (record.identifiers ?? []).find(
    (id) => id.type === 'ark',
  );
  return identifier?.value;
}

/**
 * Build one grounded field from a Gallica OAIRecord Dublin Core value.
 *
 * The `value` and `evidence.excerpt` are GENUINELY grounded -- the value is the
 * verbatim DC text the injected resolver parsed out of the OAIRecord response
 * ({@link ArkMetadata.rawResponse}), so the excerpt is a real, verbatim
 * substring of that response (it passes `@/extraction/grounding-verifier`).
 *
 * Type-fidelity gap (documented, NOT a fabrication of the grounding itself):
 * the shared {@link GroundedField} was authored for LLM PROSE extraction and
 * hard-codes `provenance.modelAssisted: true`. Gallica's mapping is a
 * DETERMINISTIC structured-DC parse, not a model call; the literal is a shared-
 * type artifact, and `engine`/`model` below name the deterministic mapping
 * honestly rather than inventing a model. The evidence/value are never
 * fabricated.
 */
function groundedFromDc(
  value: string,
  interpretation: string,
  metadata: ArkMetadata,
): GroundedField<string> {
  return {
    value,
    evidence: {
      // The verbatim DC value is a substring of the OAIRecord response body.
      excerpt: value,
    },
    interpretation,
    provenance: {
      modelAssisted: true,
      engine: 'gallica-oai-dc',
      model: 'oai-dublin-core',
      promptVersion: `gallica-normalization-v${metadata.normalizationVersion}`,
      at: metadata.retrievedAt,
    },
  };
}

/**
 * `GallicaAdapter` -- wraps the shipped Gallica fetcher + OAIRecord resolver
 * behind {@link RepositoryAdapter}.
 */
export class GallicaAdapter implements RepositoryAdapter {
  readonly repository = 'gallica' as const;

  private readonly fetch: FetchSourceFn;
  private readonly resolveArk: ArkResolver;
  private readonly now: () => string;

  constructor(deps: GallicaAdapterDeps) {
    if (deps === null || typeof deps !== 'object') {
      throw new Error('GallicaAdapter: deps is required.');
    }
    if (typeof deps.fetch !== 'function') {
      throw new Error('GallicaAdapter: deps.fetch is required (the injected shipped fetcher).');
    }
    if (typeof deps.resolveArk !== 'function') {
      throw new Error('GallicaAdapter: deps.resolveArk is required (the injected ark resolver).');
    }
    this.fetch = deps.fetch;
    this.resolveArk = deps.resolveArk;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  /**
   * Acquire a Gallica copy by driving the injected shipped fetcher EXACTLY as
   * `runAcquire` does today.
   *
   * Gate boundary (behavior-preserving): `runAcquire` enforces two SOURCE-level
   * gates -- `isFetchableWork` (not a source-group) and `status ===
   * 'approved-for-acquisition'` -- BEFORE it ever selects a `RepositoryRecord`.
   * Those gates read the `Source`, which the {@link RepositoryAdapter} contract
   * does NOT hand to `acquire` (it receives only the already-selected
   * `RepositoryRecord`). So they stay in the CALLER (`runAcquire` today; the
   * T012 cutover keeps them there, ahead of `registry.select -> adapter.acquire`).
   * This adapter enforces the RECORD-level gates it can verify from the record
   * alone, identically to `runAcquire`:
   *   1. `rights.status === 'public-domain'` (fail loud on `/public-domain/`).
   *   2. an `ark` copy identifier is present (else "nothing to fetch").
   * On success it invokes the fetcher EXACTLY ONCE with the same
   * `fetch-source` `ParsedArgs` shape `runAcquire` builds
   * (`verify`/`reconcileRemote`/`force` hardcoded `false`).
   */
  async acquire(
    record: RepositoryRecord,
    ctx: GallicaAcquisitionContext,
  ): Promise<AcquisitionResult> {
    if (record === null || typeof record !== 'object') {
      throw new Error('GallicaAdapter.acquire: record is required.');
    }
    const context = ctx ?? {};

    if (record.rights?.status !== 'public-domain') {
      throw new Error(
        `GallicaAdapter.acquire: the RepositoryRecord for "${record.sourceId}" at ` +
          `"${record.sourceArchive}" is not public-domain -- only public-domain copies ` +
          `may be acquired (FR-017, INV-B).`,
      );
    }

    const ark = arkOf(record);
    if (ark === undefined) {
      throw new Error(
        `GallicaAdapter.acquire: the RepositoryRecord for "${record.sourceId}" at ` +
          `"${record.sourceArchive}" carries no ark identifier -- nothing to fetch.`,
      );
    }

    const args: ParsedArgs = {
      command: 'fetch-source',
      positional: [ark],
      flags: {
        dryRun: context.dryRun ?? false,
        force: false,
        verify: false,
        ocr: false,
        objectStore: context.objectStore ?? false,
        reconcileRemote: false,
        checkpoint: context.checkpoint ?? false,
      },
      options: {
        sourceId: record.sourceId,
        checkpointEvery: context.checkpointEvery,
      },
    };

    await this.fetch(args);

    // The record has no standalone id; its identity key is the (sourceId,
    // sourceArchive) composite (see `@/model/repository-record`), mirrored
    // here as `RepositoryAdapterRegistry`'s own record label.
    const repositoryRecordId = `${record.sourceId} @ ${record.sourceArchive}`;

    // metadataSnapshot passthrough: the injected `FetchSourceFn` returns
    // `void` and yields NO fresh repository response at this layer. The
    // honest snapshot available is the OAIRecord XML the rights gate already
    // captured on the record (`rights.rawResponse`, a required field, present
    // because the public-domain gate above passed). `retrievedAt` prefers the
    // record's own retrieval timestamp, falling back to the injected clock.
    const metadataSnapshot: MetadataSnapshot = {
      raw: record.rights.rawResponse,
      retrievedAt: record.retrievedAt ?? this.now(),
    };

    // TODO(reconcile-derived): per-asset `AcquiredAsset` detail (objectStoreKey,
    // checksum, byteLength, provenancePath) is NOT observable at this layer --
    // the injected shipped fetcher returns `void` and writes page-image
    // masters + provenance to the archive/object store as a side effect. That
    // per-asset accounting is DERIVED downstream by `bib reconcile`
    // (`runReconcile`, `@/sourcegroup/reconcile`) from the on-disk provenance,
    // exactly as the T010 characterization suite pins. So `assets` is empty and
    // `reconciliationRequired` is `true` here; nothing is fabricated. `complete`
    // is `false` for the same reason -- completeness is a reconcile verdict
    // (`collected` vs `archived`), not knowable from the void fetcher's return.
    const assets: AcquiredAsset[] = [];

    return {
      repositoryRecordId,
      assets,
      metadataSnapshot,
      complete: false,
      reconciliationRequired: true,
    };
  }

  /**
   * Resolve a Gallica ARK locator to a concrete item via the injected rich
   * OAIRecord resolver. No identifier is ever invented: a dead/unknown ark
   * (resolver returns `null`) fails loud (INV-A).
   *
   * `metadata` ({@link GroundedExtraction}) is populated from the resolver's
   * structured Dublin Core fields via {@link groundedFromDc} -- the values and
   * evidence excerpts are genuinely grounded in the OAIRecord response (see
   * that helper's documented type-fidelity note on `modelAssisted`). The
   * schema's REQUIRED `date` cannot be honestly produced when Gallica reports
   * no `dc:date`, so that case fails loud rather than fabricating one.
   *
   * `assetLocators` is intentionally empty: the OAIRecord carries no page
   * enumeration, and page-image locators are the shipped fetcher's concern
   * (driven by `acquire`), not this metadata resolution -- inventing them here
   * would fabricate assets.
   */
  async resolve(
    locator: RepositoryLocator,
    _ctx: ResolutionContext,
  ): Promise<ResolvedRepositoryItem> {
    if (locator === null || typeof locator !== 'object') {
      throw new Error('GallicaAdapter.resolve: locator is required.');
    }
    const ark = typeof locator.value === 'string' ? locator.value.trim() : '';
    if (ark.length === 0) {
      throw new Error('GallicaAdapter.resolve: locator.value (an ark) is required.');
    }

    const metadata = await this.resolveArk(ark);
    if (metadata === null) {
      throw new Error(
        `GallicaAdapter.resolve: Gallica has no OAIRecord for ark "${ark}" ` +
          '-- refusing to invent an identifier (INV-A).',
      );
    }

    if (metadata.date === undefined) {
      throw new Error(
        `GallicaAdapter.resolve: Gallica OAIRecord for ark "${ark}" carries no dc:date ` +
          '-- cannot produce the required grounded `date` field without fabricating it.',
      );
    }

    // The deterministic display title: the first `dc:title` the OAIRecord
    // reports (`ArkMetadata.titles`, mechanically mapped by
    // `gallicaArkMetadataResolver` -- never an LLM extraction). Distinct from
    // the optional, LLM-grounded `metadata.creator`/`metadata.description`
    // fields below. Fails loud rather than fabricating a title when Gallica
    // reports no `dc:title` at all, mirroring the `dc:date` gate above.
    const firstTitle = metadata.titles[0]?.text.trim();
    if (firstTitle === undefined || firstTitle.length === 0) {
      throw new Error(
        `GallicaAdapter.resolve: Gallica OAIRecord for ark "${ark}" carries no dc:title ` +
          '-- cannot produce the required deterministic `title` field without fabricating it.',
      );
    }

    const groundedMetadata: GroundedExtraction<MuseumItemFields> = {
      date: groundedFromDc(
        metadata.date,
        'Gallica Dublin Core dc:date (publication date reported by the archive; ' +
          'deterministic structured mapping, not model prose extraction)',
        metadata,
      ),
    };
    if (metadata.creator !== undefined) {
      groundedMetadata.creator = groundedFromDc(
        metadata.creator,
        'Gallica Dublin Core dc:creator (author/editor reported by the archive)',
        metadata,
      );
    }

    return {
      repository: this.repository,
      identifiers: [{ type: 'ark', value: ark }],
      // The documented canonical Gallica landing/detail URL for the ark (single
      // source of truth shared with the fetcher's provenance `catalog_url`).
      sourceUrl: issueLandingUrl(ark),
      title: firstTitle,
      // See the doc comment: no honest page enumeration exists at this layer.
      assetLocators: [],
      metadata: groundedMetadata,
    };
  }

  /**
   * Collect rights EVIDENCE from a resolved Gallica item. PROPOSES only; it
   * never authors a rights judgment (INV-B).
   *
   * The grounded `date` (creation/publication date -> the public-domain term
   * evidence) is surfaced directly from the item's grounded metadata. The
   * other {@link RightsEvidence} fields (`rightsRaw`, `publicationStatus`,
   * `repositoryPolicy`, `jurisdiction`) are NOT carried on a
   * {@link ResolvedRepositoryItem}, so they are honestly omitted here rather
   * than invented -- Gallica's normalized rights STATUS
   * (`public-domain` | `other`) is determined separately by the OAIRecord
   * rights gate (`@/rights/gate`) on the record's `Rights`, not from the
   * resolved item.
   */
  async collectRightsEvidence(item: ResolvedRepositoryItem): Promise<RightsEvidence> {
    if (item === null || typeof item !== 'object') {
      throw new Error('GallicaAdapter.collectRightsEvidence: item is required.');
    }
    return {
      date: item.metadata.date,
    };
  }
}
