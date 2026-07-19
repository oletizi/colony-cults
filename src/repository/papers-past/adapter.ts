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
 * fetch/parse logic of its own beyond orchestration -- it composes the shipped
 * halves: the spec-014 `BrowserSession` (clears the Incapsula WAF), the polite
 * byte-fetch client, `persistCapture` (persist-before-parse), `parseArticle`
 * (`@/repository/papers-past/parse`, which fails loud on a missing id/title/zero
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
  GroundedField,
  MuseumItemFields,
} from '@/extraction/structured-extractor';
import type { ObjectStore } from '@/archive/object-store';
import type { BrowserSession } from '@/sourcequery/browser-session';
import type { ParsedArticle } from '@/repository/papers-past/types';
import { parseArticle } from '@/repository/papers-past/parse';
import { persistCapture } from '@/sourcequery/persistence';
import { sha256OfBytes } from '@/archive/checksum';
import {
  objectKeyForSegment,
  provenancePathForSegment,
} from '@/repository/papers-past/keys';

/** Base URL for a Papers Past newspaper-article page (locator value may be a bare article id). */
const ARTICLE_BASE = 'https://paperspast.natlib.govt.nz/newspapers';

/** The capture `source` id (also the `repository-responses/<source>/` dir name). */
const CAPTURE_SOURCE = 'papers-past-article';

/** GIF media type -- the Papers Past `/imageserver/` facsimile is always a GIF. */
const GIF_MEDIA_TYPE = 'image/gif';

/**
 * The byte-fetch surface this adapter depends on: download image bytes. The
 * polite `@/gallica/http-client` `HttpClient`'s `getBytes` satisfies this
 * structurally, so tests inject a fake and never touch the network.
 */
export interface PapersPastByteFetch {
  getBytes(url: string): Promise<Uint8Array>;
}

/** Construction dependencies for {@link PapersPastAdapter} (all injected). */
export interface PapersPastAdapterDeps {
  /** Spec-014 browser session that clears the WAF; fake in tests. REQUIRED. */
  browserSession: BrowserSession;
  /** Polite byte-fetch client for image bytes; fake in tests. REQUIRED. */
  byteFetch: PapersPastByteFetch;
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
 * Is `bytes` a GIF (magic number `GIF87a` / `GIF89a`)? The Papers Past
 * `/imageserver/` facsimile is a GIF; a challenge page / non-image body would
 * NOT start with these six bytes, so this is the image-validity guard that
 * refuses to mirror a non-image as a facsimile (contract invariant).
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
  private readonly byteFetch: PapersPastByteFetch;
  private readonly objectStore: ObjectStore | undefined;
  private readonly now: () => string;
  private readonly captureBaseDir: string | undefined;

  /**
   * Threads the `RightsEvidence` computed during `resolve` through to
   * `collectRightsEvidence`, keyed by object identity of the exact
   * `ResolvedRepositoryItem` `resolve` returned (the Internet Archive pattern).
   * `collectRightsEvidence(item)` receives only a `ResolvedRepositoryItem`,
   * whose `metadata` carries no `rightsRaw`/jurisdiction; re-navigating the
   * article page a second time to recover verbatim evidence this adapter
   * already parsed once would pay a redundant WAF-clearing round trip and risk
   * a divergent (remote-changed) result. A `WeakMap` avoids retaining evidence
   * for items no longer referenced.
   */
  private readonly rightsEvidenceByItem = new WeakMap<ResolvedRepositoryItem, RightsEvidence>();

  constructor(deps: PapersPastAdapterDeps) {
    if (deps === null || typeof deps !== 'object') {
      throw new Error('PapersPastAdapter: deps is required.');
    }
    if (deps.browserSession === null || typeof deps.browserSession !== 'object') {
      throw new Error('PapersPastAdapter: deps.browserSession is required (the browser session).');
    }
    if (deps.byteFetch === null || typeof deps.byteFetch !== 'object') {
      throw new Error('PapersPastAdapter: deps.byteFetch is required (the byte-fetch client).');
    }
    if (deps.objectStore !== undefined && typeof deps.objectStore !== 'object') {
      throw new Error(
        'PapersPastAdapter: deps.objectStore, when given, must be an object (the object store).',
      );
    }
    this.browserSession = deps.browserSession;
    this.byteFetch = deps.byteFetch;
    this.objectStore = deps.objectStore;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.captureBaseDir = deps.captureBaseDir;
  }

  /**
   * Build the mechanical grounded `date` field for an article, derived from the
   * article code (`oid`), where Papers Past encodes the publication date
   * (`HNS18840103.2.19.3` -> `1884-01-03`). This is a DETERMINISTIC parse, never
   * a model call: {@link GroundedField} hard-codes `provenance.modelAssisted:
   * true` (it was authored for LLM prose), so `engine`/`model` NAME the
   * mechanical parse honestly (the Internet Archive `rights.ts` convention)
   * rather than inventing a model. Fails loud (no fabrication) if the article
   * code carries no `YYYYMMDD` date.
   */
  private mechanicalDateField(parsed: ParsedArticle): GroundedField<string> {
    const match = /^[A-Za-z]+(\d{4})(\d{2})(\d{2})\./.exec(parsed.articleId);
    if (match === null) {
      throw new Error(
        `PapersPastAdapter: cannot derive a publication date from article code ` +
          `"${parsed.articleId}" (expected <PAPER><YYYYMMDD>.<edition>.<article>) -- ` +
          'refusing to fabricate a grounded date.',
      );
    }
    const [, year, month, day] = match;
    const yearNum = Number.parseInt(year, 10);
    const monthNum = Number.parseInt(month, 10);
    const dayNum = Number.parseInt(day, 10);
    // Coarse range gate (month 1-12, day 1-31) THEN a real-calendar gate: a UTC
    // date normalises overflow (1884-02-30, non-leap 1885-02-29), so a genuine
    // date round-trips its UTC Y/M/D back to the decoded digits (never Date.now).
    const inRange = monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31;
    const probe = new Date(Date.UTC(yearNum, monthNum - 1, dayNum));
    const realCalendarDate =
      probe.getUTCFullYear() === yearNum &&
      probe.getUTCMonth() === monthNum - 1 &&
      probe.getUTCDate() === dayNum;
    if (!inRange || !realCalendarDate) {
      throw new Error(
        `PapersPastAdapter: article code "${parsed.articleId}" encodes an implausible date ` +
          `${year}-${month}-${day} -- refusing to fabricate a grounded date.`,
      );
    }
    const value = `${year}-${month}-${day}`;
    return {
      value,
      evidence: {
        excerpt: parsed.articleId,
        selector: 'link[rel="canonical"] (article code / oid)',
      },
      interpretation:
        'publication date mechanically decoded from the Papers Past article code ' +
        '(YYYYMMDD segment); a fact for the operator to weigh, not a legal determination',
      provenance: {
        modelAssisted: true,
        engine: 'papers-past-mechanical-parse',
        model: 'papers-past-article-code-date',
        promptVersion: 'papers-past-mechanical-v1',
        at: this.now(),
      },
    };
  }

  /**
   * Open the session, navigate to the article page, PERSIST THE RAW PAGE BEFORE
   * PARSING (persist-before-analysis, spec-014 / T019 governed-read), then
   * mechanically parse it. Always closes the session (try/finally). `parseArticle`
   * fails loud on a missing id/title/zero image locators -- not re-checked here.
   */
  private async loadArticle(
    locatorValue: string,
  ): Promise<{ pageUrl: string; html: string; parsed: ParsedArticle }> {
    const raw = locatorValue.trim();
    const pageUrl = raw.startsWith('http') ? raw : `${ARTICLE_BASE}/${raw}`;
    const query = pageUrl.split('/').filter((segment) => segment.length > 0).pop() ?? pageUrl;

    await this.browserSession.open();
    try {
      const page = await this.browserSession.navigate(pageUrl);
      // Persist BEFORE parsing (governed-read invariant): the raw bytes are on
      // disk before any field is derived from them.
      await persistCapture({
        source: CAPTURE_SOURCE,
        query,
        url: pageUrl,
        html: page.html,
        snapshotMarkdown: page.snapshotMarkdown,
        capturedAtUtc: this.now(),
        baseDir: this.captureBaseDir,
      });
      const parsed = parseArticle(page.html, pageUrl);
      return { pageUrl, html: page.html, parsed };
    } finally {
      await this.browserSession.close();
    }
  }

  /**
   * Resolve a Papers Past article locator (`locator.value` is the article code
   * or the full article-page URL) to a concrete item. The raw page is persisted
   * before parsing; the mechanical parse fails loud on a missing id/zero
   * locators (no fabrication, INV-A). The verbatim rights statement + NZ
   * jurisdiction are stashed in the `WeakMap` for `collectRightsEvidence`.
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

    const { pageUrl, parsed } = await this.loadArticle(value);

    const date = this.mechanicalDateField(parsed);
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
   * browser/byteFetch/objectStore call (0 side effects on refuse).
   * STEP 2 -- dry-run: return empty assets with `complete:false`, NO fetch/put.
   * STEP 3 -- re-resolve (persist-before-parse) for fresh locators + identity
   * guard (the parsed article code MUST match the record's `papers-past` id).
   * STEP 4 -- VERIFY-ALL-THEN-COMMIT (Principle XII verify-before-upload).
   * PHASE A (no writes): per segment fetch bytes, image-validity guard (GIF
   * magic), sha256, remote-change fail-loud (recorded same-sequence checksum
   * differs). PHASE B (only once EVERY segment verified): idempotent
   * head-then-put. A mid-sequence PHASE-A failure leaves ZERO orphaned objects.
   * STEP 5 -- return the page-masters + a raw metadata snapshot, `complete:true`.
   * No OCR companion asset (out of scope).
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

    // STEP 2 -- dry-run: perform NO acquisition side effect (no navigate, no
    // byte fetch, no PUT). Empty assets + `complete:false` signal the acquisition
    // was validated read-only but not performed. Nothing was retrieved, so the
    // snapshot carries no raw body.
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

    // Acquire needs the object store; a resolve-only construction cannot mirror.
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

    // STEP 3 -- re-resolve (persist-before-parse) for fresh locators.
    const { html, parsed } = await this.loadArticle(locatorValue);

    // Identity guard: the freshly parsed article code MUST match the record's
    // recorded id, else the URL moved to a different article; fail loud rather
    // than mirror the wrong copy's bytes (remote change).
    if (parsed.articleId !== recordedId) {
      throw new Error(
        `PapersPastAdapter.acquire: page for "${locatorValue}" resolved article code ` +
          `"${parsed.articleId}" but the record names "${recordedId}" -- refusing to mirror a ` +
          'mismatched copy (identity guard).',
      );
    }

    const recordedAssets = record.assets ?? [];

    // STEP 4 -- VERIFY-ALL-THEN-COMMIT (Principle XII): a mid-sequence failure
    // must leave ZERO orphaned objects, so ALL segments are verified (PHASE A,
    // no writes) before ANY segment is PUT (PHASE B).
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
      const bytes = await this.byteFetch.getBytes(locator.url);

      // Image-validity guard: never mirror a challenge page / non-image as a
      // facsimile. A real segment is a GIF; anything else fails loud.
      if (!isGif(bytes)) {
        throw new Error(
          `PapersPastAdapter.acquire: bytes fetched from ${locator.url} for "${recordedId}" are ` +
            'not a GIF (no GIF87a/GIF89a magic) -- refusing to mirror a non-image/challenge ' +
            'response as a facsimile (image-validity guard).',
        );
      }

      const checksum = sha256OfBytes(bytes);

      // Remote-change fail-loud: a recorded same-sequence page-master whose
      // checksum differs means the remote bytes changed -- never overwrite.
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

    // PHASE B -- commit (only reached once ALL segments verified): idempotent
    // head-then-put; PUT only when not already present at this verified checksum.
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

    // STEP 5 -- return the page-masters + a raw metadata snapshot of the page.
    const metadataSnapshot: MetadataSnapshot = { raw: html, retrievedAt: this.now() };
    return {
      repositoryRecordId,
      assets: pageMasters,
      metadataSnapshot,
      complete: true,
      reconciliationRequired: true,
    };
  }
}
