/**
 * `NewItalyMuseumAdapter` -- the `RepositoryAdapter` (`@/repository/adapter`)
 * for the New Italy Museum (Musarch) acquisition path. It composes the three
 * shipped halves behind constructor DI (no inheritance, no globals):
 *
 *   - a rate-limit-safe fetch client ({@link MusarchHttpClient}, structurally
 *     satisfied by `@/gallica/http-client`'s `HttpClient`) -- used both to pull
 *     the item-page HTML and to download the master image bytes;
 *   - the DOM-direct mechanical field pull (`parseMusarchItem`,
 *     `@/repository/new-italy-museum/musarch-dom`) for the deterministic
 *     fields (accession, object id, master image URL);
 *   - the grounded prose extractor
 *     (`StructuredExtractor<MuseumItemFields>`,
 *     `@/repository/new-italy-museum/extractor`) for the rights-critical prose
 *     date/creator/credit;
 *   - the injected `ObjectStore` (`@/archive/object-store`) the master image
 *     bytes are PUT to (the real B2 impl is `@/archive/s3-object-store`; it is
 *     never reimplemented here, only its interface is depended on).
 *
 * Convergence (T019, FR-020/FR-021): `acquire` is idempotent and
 * remote-change fail-loud. Detection is GENERIC -- by canonical object-store
 * key + verified checksum -- never repository-specific: an already-present
 * master with the recorded checksum is treated as already acquired (no
 * re-download, no re-PUT), while a re-fetch whose bytes no longer match a
 * recorded master checksum FAILS LOUD rather than silently replacing or
 * auto-versioning the preserved master. See `acquire`'s doc comment.
 */

import type {
  AcquisitionContext,
  AcquisitionResult,
  AssetLocator,
  MetadataSnapshot,
  RepositoryAdapter,
  RepositoryLocator,
  ResolutionContext,
  ResolvedRepositoryItem,
  RightsEvidence,
} from '@/repository/adapter';
import type { AcquiredAsset } from '@/model/acquired-asset';
import type { CopyIdentifier, RepositoryRecord } from '@/model/repository-record';
import type {
  ExtractionSchema,
  GroundedExtraction,
  MuseumItemFields,
  StructuredExtractor,
} from '@/extraction/structured-extractor';
import type { ObjectStore } from '@/archive/object-store';
import { parseMusarchItem } from '@/repository/new-italy-museum/musarch-dom';
import { sha256OfBytes } from '@/archive/checksum';

/**
 * The minimal fetch surface this adapter depends on: fetch page HTML as text,
 * and download asset bytes. `@/gallica/http-client`'s `HttpClient` satisfies
 * this structurally (its `getText`/`getBytes` are the rate-limit-safe,
 * polite-User-Agent path ALL fetches go through), so tests inject a fake and
 * never touch the network.
 */
export interface MusarchHttpClient {
  /** Fetch a resource and return its body as text (the item-page HTML). */
  getText(url: string): Promise<string>;
  /** Fetch a resource and return its body as bytes (the master image). */
  getBytes(url: string): Promise<Uint8Array>;
}

/** Construction dependencies for {@link NewItalyMuseumAdapter} (all injected). */
export interface NewItalyMuseumAdapterDeps {
  /** Rate-limit-safe fetch client for page HTML + image bytes. REQUIRED. */
  client: MusarchHttpClient;
  /** Grounded prose extractor over `MuseumItemFields`. REQUIRED. */
  extractor: StructuredExtractor<MuseumItemFields>;
  /**
   * Injected object store the master bytes are PUT to (B2 in prod). Required
   * only for `acquire` (which throws a clear, fail-loud error if it is
   * absent when actually needed to PUT bytes) -- NOT for `resolve`, so a
   * resolve-only caller (e.g. `bib inventory --repository`) can construct
   * this adapter without B2 credentials.
   */
  objectStore?: ObjectStore;
  /** Clock for metadata-snapshot timestamps; defaults to wall clock. */
  now?: () => string;
}

/**
 * The extraction schema for a Musarch item page: pull the four prose fields,
 * with the creation `date` marked rights-critical (its value MUST appear
 * verbatim in its grounding excerpt, enforced by the extractor).
 */
const MUSEUM_ITEM_SCHEMA: ExtractionSchema<MuseumItemFields> = {
  fields: ['date', 'creator', 'description', 'statedCredit'],
  rightsCriticalFields: ['date'],
};

/** Recognized master-image media types, keyed by lowercased file extension. */
const MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

/** The stable object-store key prefix all New Italy Museum masters live under. */
const KEY_PREFIX = 'archive/museum/new-italy-museum';

/**
 * Derive the master image's file extension + MIME type from its URL, failing
 * loud (rather than defaulting) on an unrecognized extension -- a Musarch
 * master this adapter does not understand must not be silently mislabeled.
 */
function mediaFor(imageUrl: string): { extension: string; mediaType: string } {
  const pathname = new URL(imageUrl).pathname;
  const basename = pathname.split('/').pop() ?? '';
  const dot = basename.lastIndexOf('.');
  const extension = dot >= 0 ? basename.slice(dot + 1).toLowerCase() : '';
  const mediaType = MEDIA_TYPE_BY_EXTENSION[extension];
  if (mediaType === undefined) {
    throw new Error(
      `NewItalyMuseumAdapter: unrecognized master image extension "${extension}" for ` +
        `${imageUrl} -- refusing to guess a media type.`,
    );
  }
  return { extension, mediaType };
}

/**
 * The deterministic object-store key for a master, derived from the durable
 * accession (lowercased for path hygiene) and the content sha256 -- so the same
 * bytes for the same accession always map to the same key (the identity the
 * T019 idempotency seam will key its skip on).
 */
function objectKeyForMaster(accession: string, checksum: string, extension: string): string {
  return `${KEY_PREFIX}/${accession.toLowerCase()}/${checksum}.${extension}`;
}

/** The companion provenance path for a master (mirrors the object key, `.yml`). */
function provenancePathForMaster(accession: string, checksum: string): string {
  return `${KEY_PREFIX}/${accession.toLowerCase()}/${checksum}.yml`;
}

/** The record's accession identifier value (the `accession`-typed copy id), if any. */
function accessionOf(record: RepositoryRecord): string | undefined {
  const identifier: CopyIdentifier | undefined = (record.identifiers ?? []).find(
    (id) => id.type === 'accession',
  );
  return identifier?.value;
}

/**
 * The master {@link AcquiredAsset} this record already records (the `primary`
 * role this adapter writes on `acquire`), if any -- the convergence key for
 * the idempotent/remote-change path (FR-020/FR-021). Absent on a first-time
 * acquire (nothing recorded yet).
 */
function recordedMasterAsset(record: RepositoryRecord): AcquiredAsset | undefined {
  return (record.assets ?? []).find((asset) => asset.role === 'primary');
}

/**
 * `NewItalyMuseumAdapter` -- resolve + rights-evidence + acquire for Musarch
 * item pages, composed from injected parts.
 */
export class NewItalyMuseumAdapter implements RepositoryAdapter {
  readonly repository = 'new-italy-museum' as const;

  private readonly client: MusarchHttpClient;
  private readonly extractor: StructuredExtractor<MuseumItemFields>;
  private readonly objectStore: ObjectStore | undefined;
  private readonly now: () => string;

  constructor(deps: NewItalyMuseumAdapterDeps) {
    if (deps === null || typeof deps !== 'object') {
      throw new Error('NewItalyMuseumAdapter: deps is required.');
    }
    if (deps.client === null || typeof deps.client !== 'object') {
      throw new Error('NewItalyMuseumAdapter: deps.client is required (the fetch client).');
    }
    if (deps.extractor === null || typeof deps.extractor !== 'object') {
      throw new Error('NewItalyMuseumAdapter: deps.extractor is required (the prose extractor).');
    }
    if (deps.objectStore !== undefined && typeof deps.objectStore !== 'object') {
      throw new Error(
        'NewItalyMuseumAdapter: deps.objectStore, when given, must be an object (the object store).',
      );
    }
    this.client = deps.client;
    this.extractor = deps.extractor;
    this.objectStore = deps.objectStore;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  /**
   * Resolve a Musarch item-page locator (`locator.value` is the item URL) to a
   * concrete item. The mechanical fields (accession, object id, master image)
   * come from the DETERMINISTIC `parseMusarchItem`; the prose metadata comes
   * from the grounded extractor. `parseMusarchItem` fails loud when the
   * accession is absent -- no identifier is ever fabricated (INV-A).
   */
  async resolve(
    locator: RepositoryLocator,
    _ctx: ResolutionContext,
  ): Promise<ResolvedRepositoryItem> {
    if (locator === null || typeof locator !== 'object') {
      throw new Error('NewItalyMuseumAdapter.resolve: locator is required.');
    }
    const pageUrl = typeof locator.value === 'string' ? locator.value.trim() : '';
    if (pageUrl.length === 0) {
      throw new Error(
        'NewItalyMuseumAdapter.resolve: locator.value (the item-page URL) is required.',
      );
    }

    const html = await this.client.getText(pageUrl);

    // Mechanical (non-LLM) fields first: this throws (fail loud) if the durable
    // accession is missing, before any engine call.
    const dom = parseMusarchItem(html, pageUrl);

    // Grounded prose fields (the rights-critical date lives in the description).
    const metadata: GroundedExtraction<MuseumItemFields> = await this.extractor.extract(
      { bytes: html, url: pageUrl },
      MUSEUM_ITEM_SCHEMA,
    );

    const assetLocators: AssetLocator[] =
      dom.masterImageUrl === null ? [] : [{ url: dom.masterImageUrl, role: 'primary' }];

    return {
      repository: this.repository,
      identifiers: [{ type: 'accession', value: dom.accession }],
      sourceUrl: pageUrl,
      assetLocators,
      metadata,
    };
  }

  /**
   * Collect rights EVIDENCE from a resolved item. PROPOSES only; it never
   * authors a rights judgment (INV-B). The grounded creation `date` (the
   * public-domain term evidence) is surfaced directly; `creator` and a stated
   * credit line (as `rightsRaw`) are proposed only when the extractor grounded
   * them. No status is ever set here -- that is the operator's assessment.
   */
  async collectRightsEvidence(item: ResolvedRepositoryItem): Promise<RightsEvidence> {
    if (item === null || typeof item !== 'object') {
      throw new Error('NewItalyMuseumAdapter.collectRightsEvidence: item is required.');
    }
    const evidence: RightsEvidence = { date: item.metadata.date };
    // `MuseumItemFields.creator` is optional, so the grounded field wraps a
    // `string | undefined` value; narrow to a `GroundedField<string>` (what
    // `RightsEvidence.creator` requires) only when a real string is present.
    const creatorField = item.metadata.creator;
    if (creatorField !== undefined && typeof creatorField.value === 'string') {
      evidence.creator = {
        value: creatorField.value,
        evidence: creatorField.evidence,
        interpretation: creatorField.interpretation,
        provenance: creatorField.provenance,
      };
    }
    const creditField = item.metadata.statedCredit;
    if (creditField !== undefined && typeof creditField.value === 'string') {
      evidence.rightsRaw = creditField.value;
    }
    return evidence;
  }

  /**
   * Acquire the master image for a record.
   *
   * Fail-closed rights gate (INV-B): only a record whose
   * `rightsAssessment.rightsStatus === 'public-domain'` may be acquired; any
   * other value (or a missing assessment) THROWS before a single byte is
   * fetched. The bytes are then downloaded via the injected client, sha256'd
   * (reusing `@/archive/checksum`), and PUT to the injected `ObjectStore` under
   * a deterministic accession+checksum key.
   *
   * Master (never a thumbnail): the download URL is `parseMusarchItem`'s
   * `masterImageUrl` -- the `href` of the page's `<a class="image_anchor">`,
   * which by that parser's construction is the full-res JPG and NEVER a `tn_`
   * thumbnail or a template graphic (it fails loud otherwise). This adapter
   * downloads exactly that URL, so a thumbnail can never become the mirrored
   * asset.
   *
   * HTML-only item (no `image_anchor`): per the museum's ground truth
   * ("catalog it, mirror nothing", see `__fixtures__/STRUCTURE.md`), this
   * returns an EMPTY `assets` array -- it does NOT fabricate an asset. The
   * empty array is a distinct, documented signal (not a masked failure);
   * `reconciliationRequired` stays `true`.
   *
   * Idempotent / convergent (FR-020/FR-021, INV-E): the operation is staged
   * download -> verify checksum -> commit (PUT + record), so a mid-failure
   * leaves no half-written record. Convergence keys on the record's already-
   * recorded `primary` master ({@link recordedMasterAsset}):
   *   - if that master's object is present with its recorded checksum, this is
   *     ALREADY ACQUIRED -- return the existing asset without a second download
   *     or PUT (generic identity: canonical object key + verified checksum);
   *   - otherwise the master is re-downloaded and re-verified. If the record
   *     pins a master checksum and the freshly fetched bytes no longer match
   *     it, this FAILS LOUD (the remote changed) -- it never overwrites a
   *     preserved master, never auto-versions.
   * A first-time acquire (no recorded master) downloads, and PUTs only when the
   * object is not already present with the just-verified checksum.
   */
  async acquire(
    record: RepositoryRecord,
    _ctx: AcquisitionContext,
  ): Promise<AcquisitionResult> {
    if (record === null || typeof record !== 'object') {
      throw new Error('NewItalyMuseumAdapter.acquire: record is required.');
    }

    // Fail-closed rights gate (INV-B): assert BEFORE any fetch.
    if (record.rightsAssessment?.rightsStatus !== 'public-domain') {
      const actual = record.rightsAssessment?.rightsStatus ?? '(no rightsAssessment)';
      throw new Error(
        `NewItalyMuseumAdapter.acquire: the RepositoryRecord for "${record.sourceId}" at ` +
          `"${record.sourceArchive}" has rightsStatus "${actual}" -- only a public-domain ` +
          'assessment permits mirroring an asset (fail-closed, INV-B).',
      );
    }

    const pageUrl = typeof record.sourceUrl === 'string' ? record.sourceUrl.trim() : '';
    if (pageUrl.length === 0) {
      throw new Error(
        `NewItalyMuseumAdapter.acquire: the RepositoryRecord for "${record.sourceId}" at ` +
          `"${record.sourceArchive}" carries no sourceUrl (the Musarch item page) -- nothing to fetch.`,
      );
    }

    const html = await this.client.getText(pageUrl);
    const dom = parseMusarchItem(html, pageUrl);

    // Identity guard: if the record already names an accession, it MUST match
    // the page's durable accession -- a mismatch means the URL moved to a
    // different item; fail loud rather than mirror the wrong copy's bytes.
    const recordedAccession = accessionOf(record);
    if (recordedAccession !== undefined && recordedAccession !== dom.accession) {
      throw new Error(
        `NewItalyMuseumAdapter.acquire: page ${pageUrl} resolved accession "${dom.accession}" but ` +
          `the record names "${recordedAccession}" -- refusing to mirror a mismatched copy.`,
      );
    }

    const metadataSnapshot: MetadataSnapshot = {
      raw: html,
      retrievedAt: this.now(),
    };
    const repositoryRecordId = `${record.sourceId} @ ${record.sourceArchive}`;

    // HTML-only item: catalog it, mirror nothing (documented empty-assets case).
    if (dom.masterImageUrl === null) {
      return {
        repositoryRecordId,
        assets: [],
        metadataSnapshot,
        complete: true,
        reconciliationRequired: true,
      };
    }

    if (this.objectStore === undefined) {
      throw new Error(
        `NewItalyMuseumAdapter.acquire: no ObjectStore was injected -- this adapter instance ` +
          `was constructed resolve-only (e.g. via "bib inventory") and cannot acquire assets ` +
          `for "${record.sourceId}" at "${record.sourceArchive}".`,
      );
    }

    const masterUrl = dom.masterImageUrl;
    const { extension, mediaType } = mediaFor(masterUrl);

    // Convergence (FR-020): if this record already records a master and that
    // object is present with the recorded checksum, it is already acquired --
    // return it without re-downloading or re-PUTting (idempotent).
    const recorded = recordedMasterAsset(record);
    if (recorded !== undefined) {
      const head = await this.objectStore.head(recorded.objectStoreKey);
      if (head.exists && head.sha256 === recorded.checksum) {
        return {
          repositoryRecordId,
          assets: [recorded],
          metadataSnapshot,
          complete: true,
          reconciliationRequired: true,
        };
      }
    }

    // Stage: download the master to a buffer and verify its checksum BEFORE any
    // write, so a mid-failure never leaves a half-written record.
    const bytes = await this.client.getBytes(masterUrl);
    const checksum = sha256OfBytes(bytes);

    // Remote-change fail-loud (FR-021): the record pins a master checksum but
    // the freshly fetched bytes differ -- the remote changed. Never silently
    // replace the preserved master, never auto-version; write nothing.
    if (recorded !== undefined && checksum !== recorded.checksum) {
      throw new Error(
        `NewItalyMuseumAdapter.acquire: the master at ${masterUrl} for "${record.sourceId}" at ` +
          `"${record.sourceArchive}" now checksums ${checksum} but the record pins a preserved ` +
          `master at ${recorded.checksum} -- the remote bytes changed; refusing to overwrite the ` +
          'master or auto-version (FR-021).',
      );
    }

    const objectStoreKey = objectKeyForMaster(dom.accession, checksum, extension);

    // Commit: PUT only when the object is not already present with this exact
    // verified checksum -- generic idempotency by canonical key + checksum, so a
    // re-run over an already-mirrored master issues no duplicate PUT.
    const existing = await this.objectStore.head(objectStoreKey);
    if (!(existing.exists && existing.sha256 === checksum)) {
      await this.objectStore.put(objectStoreKey, bytes, {
        sha256: checksum,
        contentType: mediaType,
      });
    }

    const asset: AcquiredAsset = {
      sourceUrl: masterUrl,
      mediaType,
      objectStoreKey,
      checksum,
      byteLength: bytes.length,
      provenancePath: provenancePathForMaster(dom.accession, checksum),
      role: 'primary',
      representationChoice: 'full-res-image-anchor',
    };

    return {
      repositoryRecordId,
      assets: [asset],
      metadataSnapshot,
      complete: true,
      reconciliationRequired: true,
    };
  }
}
