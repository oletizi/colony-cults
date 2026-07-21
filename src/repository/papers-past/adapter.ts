/**
 * `PapersPastAdapter` -- the `RepositoryAdapter` (`@/repository/adapter`) for the
 * Papers Past (National Library of New Zealand) newspaper-article acquisition
 * path (specs/015-papers-past-acquisition, contracts/adapter.md). It is a
 * MECHANICAL (non-LLM) adapter: it mirrors the Internet Archive adapter's honest
 * pattern for a deterministic parse (a `WeakMap`-threaded `RightsEvidence` and a
 * mechanically-built `GroundedField` that names the parse, not a model call) and
 * the New Italy Museum adapter's acquire shape (dry-run mirrors nothing;
 * idempotent head-then-put by canonical key + checksum; remote-change fail-loud).
 *
 * Composition + constructor DI only (no inheritance, no globals). It owns no
 * fetch/parse logic beyond orchestration -- it composes the shipped halves: the
 * spec-014 `BrowserSession` (clears the Incapsula WAF and, research.md R1
 * CONFIRMED, also fetches image bytes via its in-page `fetchBytes` inside that
 * same cleared context, since the `/imageserver/` CDN is WAF-gated too),
 * `persistCapture`, `parseArticle` (fails loud on a missing id/title/zero
 * locators), and the deterministic key helpers (`./keys`).
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
  GroundedExtraction,
  MuseumItemFields,
} from '@/extraction/structured-extractor';
import type { ObjectStore } from '@/archive/object-store';
import type { BrowserSession } from '@/sourcequery/browser-session';
import type { ParsedArticle } from '@/repository/papers-past/types';
import { parseArticle } from '@/repository/papers-past/parse';
import { persistCapture, repoRelativeCapturePath } from '@/sourcequery/persistence';
import { sha256OfBytes } from '@/archive/checksum';
import {
  objectKeyForOcr,
  objectKeyForSegment,
  provenancePathForOcr,
  provenancePathForSegment,
} from '@/repository/papers-past/keys';
import {
  assertAllRecordedSegmentsCovered,
  assertPapersPastArticleUrl,
  assertPapersPastImageUrl,
} from '@/repository/papers-past/guards';
import { mechanicalDateField } from '@/repository/papers-past/date';

/** Base URL for a Papers Past newspaper-article page (locator value may be a bare article id). */
const ARTICLE_BASE = 'https://paperspast.natlib.govt.nz/newspapers';

/** The capture `source` id (also the `repository-responses/<source>/` dir name). */
const CAPTURE_SOURCE = 'papers-past-article';

/** GIF media type -- the Papers Past `/imageserver/` facsimile is always a GIF. */
const GIF_MEDIA_TYPE = 'image/gif';

/** Media type for the source-OCR text asset (`#text-tab` panel), stored as faithful plain text. */
const OCR_MEDIA_TYPE = 'text/plain; charset=utf-8';

/** `AcquiredAsset.sourceRepresentation` for the source-OCR text asset. */
const OCR_SOURCE_REPRESENTATION = 'papers-past-text-tab';

/** Normalization scheme version for the record-level metadata snapshot reference. */
const SNAPSHOT_NORMALIZATION_VERSION = 1;

/** Construction dependencies for {@link PapersPastAdapter} (all injected). */
export interface PapersPastAdapterDeps {
  /**
   * Spec-014 browser session that clears the Incapsula WAF; fake in tests.
   * REQUIRED. Performs BOTH the article-page read (`navigate`) AND the image
   * byte fetch (`fetchBytes`, inside the same WAF-cleared context) -- research.md
   * R1 CONFIRMED the `/imageserver/` CDN is WAF-gated too, so a stateless byte
   * fetch is challenged, not served the GIF.
   */
  browserSession: BrowserSession;
  /**
   * Object store the page-master GIFs are PUT to (B2 in prod). Required only for
   * `acquire` (which throws, fail-loud, if it is absent when actually needed) --
   * NOT for `resolve`, so a resolve-only caller (`bib inventory`) can construct
   * this adapter without B2 credentials.
   */
  objectStore?: ObjectStore;
  /** Clock for capture + snapshot timestamps; defaults to wall clock. */
  now?: () => string;
  /**
   * Base dir the `bibliography/repository-responses/...` capture tree is rooted
   * at, forwarded to `persistCapture`. Default `undefined` = `process.cwd()`;
   * tests pass a temp dir so no real repo state is touched (hermetic).
   */
  captureBaseDir?: string;
}

/**
 * Is `bytes` a GIF (magic `GIF87a` / `GIF89a`)? The Papers Past `/imageserver/`
 * facsimile is a GIF; a challenge page / non-image body would NOT start with
 * these six bytes -- the image-validity guard that refuses to mirror a non-image
 * as a facsimile (contract invariant).
 */
function isGif(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 6 &&
    bytes[0] === 0x47 && // G
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x38 && // 8
    (bytes[4] === 0x37 || bytes[4] === 0x39) && // 7 | 9
    bytes[5] === 0x61 // a
  );
}

/** The record's `papers-past`-typed copy identifier value, if any. */
function papersPastIdOf(record: RepositoryRecord): string | undefined {
  const identifier: CopyIdentifier | undefined = (record.identifiers ?? []).find(
    (id) => id.type === 'papers-past',
  );
  return identifier?.value;
}

/**
 * `PapersPastAdapter` -- resolve + rights-evidence + acquire for Papers Past
 * newspaper-article pages, composed from injected parts.
 */
export class PapersPastAdapter implements RepositoryAdapter {
  readonly repository = 'papers-past' as const;

  private readonly browserSession: BrowserSession;
  private readonly objectStore: ObjectStore | undefined;
  private readonly now: () => string;
  private readonly captureBaseDir: string | undefined;

  /**
   * Threads the `RightsEvidence` computed during `resolve` through to
   * `collectRightsEvidence`, keyed by object identity of the exact
   * `ResolvedRepositoryItem` `resolve` returned (the Internet Archive pattern).
   * `collectRightsEvidence(item)` receives only a `ResolvedRepositoryItem`, whose
   * `metadata` carries no `rightsRaw`/jurisdiction; re-navigating the article page
   * to recover verbatim evidence already parsed once would pay a redundant
   * WAF-clearing round trip and risk a divergent (remote-changed) result. A
   * `WeakMap` avoids retaining evidence for items no longer referenced.
   */
  private readonly rightsEvidenceByItem = new WeakMap<ResolvedRepositoryItem, RightsEvidence>();

  constructor(deps: PapersPastAdapterDeps) {
    if (deps === null || typeof deps !== 'object') {
      throw new Error('PapersPastAdapter: deps is required.');
    }
    if (deps.browserSession === null || typeof deps.browserSession !== 'object') {
      throw new Error('PapersPastAdapter: deps.browserSession is required (the browser session).');
    }
    if (deps.objectStore !== undefined && typeof deps.objectStore !== 'object') {
      throw new Error(
        'PapersPastAdapter: deps.objectStore, when given, must be an object (the object store).',
      );
    }
    this.browserSession = deps.browserSession;
    this.objectStore = deps.objectStore;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.captureBaseDir = deps.captureBaseDir;
  }

  /**
   * Resolve a raw locator (article code or full URL) to the article-page URL,
   * ENFORCING the Papers Past origin (origin guard, AUDIT-05): the result MUST be
   * an `https://paperspast.natlib.govt.nz/newspapers/...` URL, else it throws
   * BEFORE any navigate/persist/parse -- a malformed/compromised `sourceUrl`
   * cannot mirror an off-origin page under a legitimate identifier.
   */
  private articleUrlFor(locatorValue: string): string {
    const raw = locatorValue.trim();
    const candidate = raw.startsWith('http') ? raw : `${ARTICLE_BASE}/${raw}`;
    return assertPapersPastArticleUrl(candidate);
  }

  /**
   * Navigate an ALREADY-OPEN session to the article page, PERSIST THE RAW PAGE
   * BEFORE PARSING (persist-before-analysis, spec-014 / T019 governed-read), then
   * mechanically parse it. Does NOT open/close the session -- the caller owns the
   * lifecycle (try/finally), so the SAME WAF-cleared context stays open across the
   * page read AND the subsequent `fetchBytes` image fetches (research.md R1).
   * `parseArticle` fails loud on a missing id/title/0 locators.
   */
  private async navigateAndParse(
    pageUrl: string,
  ): Promise<{ html: string; parsed: ParsedArticle; htmlPath: string }> {
    const query = pageUrl.split('/').filter((segment) => segment.length > 0).pop() ?? pageUrl;

    const page = await this.browserSession.navigate(pageUrl);
    // Persist BEFORE parsing (governed-read invariant): raw bytes on disk first.
    // The written htmlPath is threaded out for the record-level metadata snapshot.
    const capture = await persistCapture({
      source: CAPTURE_SOURCE,
      query,
      url: pageUrl,
      html: page.html,
      snapshotMarkdown: page.snapshotMarkdown,
      capturedAtUtc: this.now(),
      baseDir: this.captureBaseDir,
    });
    const parsed = parseArticle(page.html, pageUrl);
    return { html: page.html, parsed, htmlPath: capture.htmlPath };
  }

  /**
   * Resolve a Papers Past article locator (`locator.value` is the article code
   * or the full article-page URL) to a concrete item. The raw page is persisted
   * before parsing; the mechanical parse fails loud on a missing id/zero locators
   * (no fabrication, INV-A). The verbatim rights statement + NZ jurisdiction are
   * stashed in the `WeakMap` for `collectRightsEvidence`.
   */
  async resolve(
    locator: RepositoryLocator,
    _ctx: ResolutionContext,
  ): Promise<ResolvedRepositoryItem> {
    if (locator === null || typeof locator !== 'object') {
      throw new Error('PapersPastAdapter.resolve: locator is required.');
    }
    const value = typeof locator.value === 'string' ? locator.value.trim() : '';
    if (value.length === 0) {
      throw new Error(
        'PapersPastAdapter.resolve: locator.value (the article code or article-page URL) is required.',
      );
    }

    const pageUrl = this.articleUrlFor(value);
    await this.browserSession.open();
    let parsed: ParsedArticle;
    try {
      ({ parsed } = await this.navigateAndParse(pageUrl));
    } finally {
      await this.browserSession.close();
    }

    const date = mechanicalDateField(parsed, this.now);
    const metadata: GroundedExtraction<MuseumItemFields> = { date };
    const assetLocators: AssetLocator[] = parsed.imageLocators.map((locatorEntry) => ({
      url: locatorEntry.url,
      role: 'page-master',
      sequence: locatorEntry.sequence,
    }));

    const item: ResolvedRepositoryItem = {
      repository: this.repository,
      identifiers: [{ type: 'papers-past', value: parsed.articleId }],
      sourceUrl: pageUrl,
      title: parsed.title,
      assetLocators,
      metadata,
    };

    const evidence: RightsEvidence = {
      rightsRaw: parsed.rightsRaw,
      jurisdiction: 'NZ',
      date,
    };
    this.rightsEvidenceByItem.set(item, evidence);
    return item;
  }

  /**
   * Collect rights EVIDENCE for a resolved item. PROPOSES only; never authors a
   * rights judgment (INV-B) -- `RightsEvidence` has no `rightsStatus`. Returns
   * the evidence computed once during this item's `resolve` and threaded through
   * the identity cache; fails loud if `item` is not one this adapter's own
   * `resolve` returned (no re-navigation, no fabrication).
   */
  async collectRightsEvidence(item: ResolvedRepositoryItem): Promise<RightsEvidence> {
    if (item === null || typeof item !== 'object') {
      throw new Error('PapersPastAdapter.collectRightsEvidence: item is required.');
    }
    const evidence = this.rightsEvidenceByItem.get(item);
    if (evidence === undefined) {
      throw new Error(
        'PapersPastAdapter.collectRightsEvidence: no rights evidence is cached for this item -- ' +
          "it must be the exact ResolvedRepositoryItem this adapter's own resolve() returned. " +
          'Refusing to re-navigate the article page or to fabricate evidence.',
      );
    }
    return evidence;
  }

  /**
   * Acquire the page-master GIF segments for a record.
   *
   * STEP 1 -- fail-closed rights gate (INV-B): throw unless
   * `record.rightsAssessment?.rightsStatus === 'public-domain'`, BEFORE any
   * browser/fetchBytes/objectStore call (0 side effects on refuse).
   * STEP 2 -- dry-run: return empty assets with `complete:false`, NO fetch/put.
   * STEP 3 -- re-resolve (persist-before-parse) for fresh locators + identity
   * guard (the parsed article code MUST match the record's `papers-past` id).
   * STEP 4 -- VERIFY-ALL-THEN-COMMIT (Principle XII verify-before-upload).
   * PHASE A (no writes): per segment fetch bytes (via `fetchBytes`), image-validity
   * guard (GIF magic), sha256, remote-change fail-loud. PHASE B (only once EVERY
   * segment verified): idempotent head-then-put. A mid-sequence PHASE-A failure
   * leaves ZERO orphaned objects. When the page-masters are committed, the
   * source OCR (`parsed.ocrText`, when present) is welded in as one more
   * checksum-addressed, idempotent head-then-put against the SAME object
   * store -- run strictly AFTER the page-masters' all-or-nothing PHASE A, so a
   * page-master verify failure still aborts before any OCR write (Principle XV,
   * zero orphans).
   * STEP 5 -- return the page-masters + the source-OCR asset (when present) +
   * a raw metadata snapshot.
   */
  async acquire(record: RepositoryRecord, ctx: AcquisitionContext): Promise<AcquisitionResult> {
    if (record === null || typeof record !== 'object') {
      throw new Error('PapersPastAdapter.acquire: record is required.');
    }

    // STEP 1 -- fail-closed rights gate (INV-B): assert BEFORE any side effect.
    if (record.rightsAssessment?.rightsStatus !== 'public-domain') {
      const actual = record.rightsAssessment?.rightsStatus ?? '(no rightsAssessment)';
      throw new Error(
        `PapersPastAdapter.acquire: the RepositoryRecord for "${record.sourceId}" at ` +
          `"${record.sourceArchive}" has rightsStatus "${actual}" -- only a public-domain ` +
          'assessment permits mirroring an asset (fail-closed, INV-B).',
      );
    }

    const repositoryRecordId = `${record.sourceId} @ ${record.sourceArchive}`;

    // STEP 2 -- dry-run: NO acquisition side effect (no navigate, no byte fetch,
    // no PUT). Empty assets + `complete:false` signal read-only validation, not
    // performance; nothing retrieved, so the snapshot carries no raw body.
    if (ctx?.dryRun === true) {
      const drySnapshot: MetadataSnapshot = { raw: '', retrievedAt: this.now() };
      return {
        repositoryRecordId,
        assets: [],
        metadataSnapshot: drySnapshot,
        complete: false,
        reconciliationRequired: true,
      };
    }

    if (this.objectStore === undefined) {
      throw new Error(
        `PapersPastAdapter.acquire: no ObjectStore was injected -- this adapter instance was ` +
          `constructed resolve-only (e.g. via "bib inventory") and cannot acquire assets for ` +
          `"${record.sourceId}" at "${record.sourceArchive}".`,
      );
    }
    const objectStore = this.objectStore;

    // The record MUST carry a papers-past identifier to guard identity against.
    const recordedId = papersPastIdOf(record);
    if (recordedId === undefined) {
      throw new Error(
        `PapersPastAdapter.acquire: the RepositoryRecord for "${record.sourceId}" at ` +
          `"${record.sourceArchive}" carries no "papers-past" identifier -- cannot verify the ` +
          'resolved article code against the record (identity guard).',
      );
    }

    const locatorValue =
      typeof record.sourceUrl === 'string' && record.sourceUrl.trim().length > 0
        ? record.sourceUrl.trim()
        : recordedId;

    const recordedAssets = record.assets ?? [];
    const pageUrl = this.articleUrlFor(locatorValue);

    // STEP 3 -- open ONCE, keeping the WAF-cleared session open across the page
    // read AND every image `fetchBytes` (research.md R1: `/imageserver/` is
    // WAF-gated too); always closed (try/finally).
    await this.browserSession.open();
    try {
      const { html, parsed, htmlPath } = await this.navigateAndParse(pageUrl);

      // Identity guard: the freshly parsed article code MUST match the record's
      // recorded id, else the URL moved to a different article; fail loud.
      if (parsed.articleId !== recordedId) {
        throw new Error(
          `PapersPastAdapter.acquire: page for "${locatorValue}" resolved article code ` +
            `"${parsed.articleId}" but the record names "${recordedId}" -- refusing to mirror a ` +
            'mismatched copy (identity guard).',
        );
      }

      // STEP 4 -- VERIFY-ALL-THEN-COMMIT (Principle XII): a mid-sequence failure
      // must leave ZERO orphaned objects -- ALL segments verified (PHASE A, no
      // writes) before ANY is PUT (PHASE B).
      /** One PHASE-A-verified segment, carried into PHASE B for the idempotent commit. */
      interface VerifiedSegment {
        readonly locator: { url: string; sequence: number };
        readonly bytes: Uint8Array;
        readonly checksum: string;
        readonly key: string;
      }

      // PHASE A -- verify every segment (NO writes), in `area`/sequence order.
      const verified: VerifiedSegment[] = [];
      for (const locator of parsed.imageLocators) {
        // Origin guard (AUDIT-05): the resolved image locator MUST be on the
        // Papers Past origin BEFORE any byte fetch -- never mirror off-origin bytes.
        assertPapersPastImageUrl(locator.url);

        // Fetch bytes INSIDE the same WAF-cleared context (research.md R1).
        const bytes = await this.browserSession.fetchBytes(locator.url);

        // Image-validity guard: a real segment is a GIF; anything else fails loud.
        if (!isGif(bytes)) {
          throw new Error(
            `PapersPastAdapter.acquire: bytes fetched from ${locator.url} for "${recordedId}" are ` +
              'not a GIF (no GIF87a/GIF89a magic) -- refusing to mirror a non-image/challenge ' +
              'response as a facsimile (image-validity guard).',
          );
        }

        const checksum = sha256OfBytes(bytes);

        // Remote-change fail-loud: a recorded same-sequence master whose checksum
        // differs means the remote bytes changed -- never overwrite.
        const recordedForSeq = recordedAssets.find(
          (asset) => asset.role === 'page-master' && asset.sequence === locator.sequence,
        );
        if (recordedForSeq !== undefined && recordedForSeq.checksum !== checksum) {
          throw new Error(
            `PapersPastAdapter.acquire: segment ${locator.sequence} at ${locator.url} for ` +
              `"${recordedId}" now checksums ${checksum} but the record pins a preserved master at ` +
              `${recordedForSeq.checksum} -- the remote bytes changed; refusing to overwrite or ` +
              'auto-version (remote-change fail-loud).',
          );
        }

        verified.push({
          locator,
          bytes,
          checksum,
          key: objectKeyForSegment(parsed.articleId, checksum),
        });
      }

      // Dropped-segment guard (AUDIT-04): a sequence the record PINS that the
      // fresh parse no longer yields is silent partial loss -- fail loud (the
      // drop-direction complement of the per-segment remote-change checksum guard).
      assertAllRecordedSegmentsCovered(
        recordedAssets,
        new Set(verified.map((segment) => segment.locator.sequence)),
      );

      // PHASE B -- commit (only once ALL segments verified): idempotent
      // head-then-put; PUT only when not already present at this checksum.
      const pageMasters: AcquiredAsset[] = [];
      for (const segment of verified) {
        const head = await objectStore.head(segment.key);
        if (!(head.exists && head.sha256 === segment.checksum)) {
          await objectStore.put(segment.key, segment.bytes, {
            sha256: segment.checksum,
            contentType: GIF_MEDIA_TYPE,
          });
        }

        pageMasters.push({
          sourceUrl: segment.locator.url,
          mediaType: GIF_MEDIA_TYPE,
          objectStoreKey: segment.key,
          checksum: segment.checksum,
          byteLength: segment.bytes.length,
          provenancePath: provenancePathForSegment(parsed.articleId, segment.checksum),
          role: 'page-master',
          sequence: segment.locator.sequence,
        });
      }

      // OCR capture (Principle XV, welded not follow-up): run STRICTLY AFTER
      // the page-masters are committed (they are already atomic under PHASE
      // A/B above), using the SAME objectStore, so a page-master PHASE-A
      // verify failure still aborts before any OCR write -- zero orphans. The
      // OCR bytes are already in `parsed.ocrText` (no separate byte-fetch), so
      // its "verify" is just the checksum; absent OCR is non-fatal.
      const assets: AcquiredAsset[] = [...pageMasters];
      if (typeof parsed.ocrText === 'string' && parsed.ocrText.length > 0) {
        const ocrBytes = new TextEncoder().encode(parsed.ocrText);
        const ocrChecksum = sha256OfBytes(ocrBytes);
        const ocrKey = objectKeyForOcr(parsed.articleId, ocrChecksum);
        const ocrHead = await objectStore.head(ocrKey);
        if (!(ocrHead.exists && ocrHead.sha256 === ocrChecksum)) {
          await objectStore.put(ocrKey, ocrBytes, {
            sha256: ocrChecksum,
            contentType: OCR_MEDIA_TYPE,
          });
        }
        assets.push({
          sourceUrl: pageUrl,
          mediaType: OCR_MEDIA_TYPE,
          objectStoreKey: ocrKey,
          checksum: ocrChecksum,
          byteLength: ocrBytes.length,
          provenancePath: provenancePathForOcr(parsed.articleId, ocrChecksum),
          role: 'ocr-text',
          sequence: 0,
          sourceRepresentation: OCR_SOURCE_REPRESENTATION,
        });
      }

      // STEP 5 -- return the page-masters + the source-OCR asset (when
      // present) + a raw metadata snapshot AND a record-level
      // metadata-snapshot reference (GAP 2) pointing at the persisted raw
      // `.html` capture (repo-relative under `bibliography/repository-responses/`),
      // so the acquired record carries a durable snapshot ref like the Museum/IA path.
      const metadataSnapshot: MetadataSnapshot = { raw: html, retrievedAt: this.now() };
      return {
        repositoryRecordId,
        assets,
        metadataSnapshot,
        complete: true,
        reconciliationRequired: true,
        metadataSnapshotRef: {
          path: repoRelativeCapturePath(htmlPath),
          retrievedAt: this.now(),
          endpoint: pageUrl,
          normalizationVersion: SNAPSHOT_NORMALIZATION_VERSION,
        },
      };
    } finally {
      await this.browserSession.close();
    }
  }
}
