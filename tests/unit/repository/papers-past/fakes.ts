/**
 * Shared no-network test doubles for the Papers Past repository adapter's
 * unit tests (T009-T012). Mirrors the spec-014 fake shape
 * (tests/unit/sourcequery/fakes.ts) for the browser session, and adds a
 * double for the injected object store the adapter depends on:
 * - {@link FakeBrowserSession} -- scripts the HTML returned per article URL
 *   (a test loads a fixture, e.g.
 *   tests/unit/repository/papers-past/fixtures/de-rays-article.html, and
 *   passes its contents in here) AND scripts the image bytes returned per
 *   `/imageserver/` URL from its WAF-cleared `fetchBytes` (research.md R1:
 *   image bytes are fetched inside the same browser context that read the
 *   page, not via a separate stateless client). A scripted non-image /
 *   challenge body drives the image-validity-guard test.
 * - {@link FakeObjectStore} -- in-memory `ObjectStore` recording every
 *   `head`/`put` call, with pre-seeding support so a test can assert
 *   idempotent skip (head returns exists+matching checksum) or dry-run
 *   writes nothing.
 */
import type { BrowserSession } from '@/sourcequery/browser-session';
import type { PageResult } from '@/sourcequery/types';
import type {
  ObjectHead,
  ObjectStore,
  PutOptions,
} from '@/archive/object-store';

/**
 * Script for a {@link FakeBrowserSession}: a per-URL HTML map plus an
 * optional fallback used for any URL not present in `html`. Each scripted
 * response is wrapped into a full `PageResult` (status 200, errored false);
 * `snapshotMarkdown` defaults to the HTML itself when not overridden.
 */
export interface FakeBrowserSessionScript {
  /** article URL -> HTML body to return for that URL. */
  html?: Map<string, string>;
  /** HTML returned for any URL not present in `html`, when provided. */
  defaultHtml?: string;
  /**
   * image URL -> raw bytes returned by `fetchBytes(url)` (the WAF-cleared
   * in-page byte fetch). Script a non-image/challenge body here to exercise
   * the adapter's image-validity guard.
   */
  bytes?: Map<string, Uint8Array>;
  /** Bytes returned by `fetchBytes` for any URL not present in `bytes`, when provided. */
  defaultBytes?: Uint8Array;
}

/**
 * No-network test double for {@link BrowserSession}, scoped to the Papers
 * Past adapter's article-page-fetch use case.
 *
 * Returns a scripted `PageResult` (HTML wrapped with `status: 200`,
 * `errored: false`) keyed by URL, falling back to `defaultHtml` when
 * provided. Records the order of `navigate()` calls so tests can assert on
 * which article URL(s) were fetched. Enforces the open-before-navigate
 * precondition, mirroring the spec-014 fake and the real persistent-Chrome
 * session it stands in for.
 *
 * ALSO scripts `fetchBytes(url)` -- the WAF-cleared in-page byte fetch the
 * adapter uses for image bytes (research.md R1) -- keyed by URL with an
 * optional `defaultBytes` fallback, recording every requested URL in
 * `fetchBytesCalls` (call order). This subsumes the retired
 * `FakeByteFetchClient`: image bytes now flow through the SAME browser
 * session that read the page, never a separate stateless client.
 */
export class FakeBrowserSession implements BrowserSession {
  /** URLs passed to `navigate()`, in call order. */
  readonly navigateCalls: string[] = [];
  /** URLs passed to `fetchBytes()`, in call order (duplicates included). */
  readonly fetchBytesCalls: string[] = [];

  private readonly html: Map<string, string>;
  private readonly defaultHtml: string | undefined;
  private readonly bytes: Map<string, Uint8Array>;
  private readonly defaultBytes: Uint8Array | undefined;
  private opened = false;
  private closed = false;

  constructor(script: FakeBrowserSessionScript = {}) {
    this.html = script.html ?? new Map();
    this.defaultHtml = script.defaultHtml;
    this.bytes = script.bytes ?? new Map();
    this.defaultBytes = script.defaultBytes;
  }

  /** Whether `open()` has been called and `close()` has not (yet). */
  get isOpen(): boolean {
    return this.opened && !this.closed;
  }

  async open(): Promise<void> {
    this.opened = true;
    this.closed = false;
  }

  async navigate(url: string): Promise<PageResult> {
    if (!this.isOpen) {
      throw new Error(
        `FakeBrowserSession: navigate('${url}') called before open() (or after close()) -- ` +
          'a real persistent-Chrome session requires open() before any navigation.',
      );
    }
    this.navigateCalls.push(url);
    const scripted = this.html.get(url);
    const body = scripted ?? this.defaultHtml;
    if (body === undefined) {
      throw new Error(
        `FakeBrowserSession: no scripted HTML for URL: ${url}`,
      );
    }
    return { status: 200, html: body, snapshotMarkdown: body, errored: false };
  }

  /**
   * WAF-cleared in-page byte fetch (research.md R1). Returns scripted bytes
   * keyed by URL, falling back to `defaultBytes` when provided; a URL with no
   * scripted bytes and no default throws (fail-loud). Records every requested
   * URL, in call order, in {@link fetchBytesCalls}.
   */
  async fetchBytes(url: string): Promise<Uint8Array> {
    this.fetchBytesCalls.push(url);
    const scripted = this.bytes.get(url);
    if (scripted !== undefined) {
      return scripted;
    }
    if (this.defaultBytes !== undefined) {
      return this.defaultBytes;
    }
    throw new Error(`FakeBrowserSession: fetchBytes not scripted for URL: ${url}`);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  /** Test helper: number of times `fetchBytes()` was called for `url`. */
  fetchBytesCountFor(url: string): number {
    return this.fetchBytesCalls.filter((called) => called === url).length;
  }
}

/** A recorded `head(key)` call, in the order it happened. */
export interface HeadCall {
  key: string;
}

/** A recorded `put(key, bytes, options)` call, in the order it happened. */
export interface PutCall {
  key: string;
  bytes: Uint8Array;
  options: PutOptions;
}

/** Pre-seeded object metadata for {@link FakeObjectStore}, keyed by object key. */
export interface SeedObject {
  sha256: string;
  size?: number;
  etag?: string;
}

/**
 * In-memory `ObjectStore` test double for the Papers Past adapter's
 * idempotency and dry-run tests.
 *
 * Unlike a plain in-memory store, this fake RECORDS every `head()` and
 * `put()` call (in order) so tests can assert:
 * - idempotent re-run: a second `acquire()` over an already-`put` key calls
 *   `head()` again but issues 0 additional `put()` calls;
 * - dry-run: `acquire()` issues 0 `put()` calls at all.
 *
 * A test can pre-seed an existing object via the constructor or
 * {@link seed} so `head()` returns `{ exists: true, sha256, ... }` for that
 * key without a prior `put()` -- modelling a key that was already archived
 * in a previous run.
 */
export class FakeObjectStore implements ObjectStore {
  /** Every `head()` call, in order. */
  readonly headCalls: HeadCall[] = [];
  /** Every `put()` call, in order (with the exact bytes/options passed). */
  readonly putCalls: PutCall[] = [];

  private readonly objects = new Map<string, SeedObject>();

  constructor(seed: Map<string, SeedObject> = new Map()) {
    for (const [key, value] of seed) {
      this.objects.set(key, value);
    }
  }

  /** Test helper: pre-seed (or overwrite) an existing object's metadata. */
  seed(key: string, value: SeedObject): void {
    this.objects.set(key, value);
  }

  async head(key: string): Promise<ObjectHead> {
    this.headCalls.push({ key });
    const existing = this.objects.get(key);
    if (existing === undefined) {
      return { exists: false };
    }
    return {
      exists: true,
      sha256: existing.sha256,
      size: existing.size,
      etag: existing.etag,
    };
  }

  async put(key: string, bytes: Uint8Array, options: PutOptions): Promise<void> {
    this.putCalls.push({ key, bytes, options });
    this.objects.set(key, { sha256: options.sha256, size: bytes.length });
  }

  async get(key: string): Promise<Uint8Array> {
    throw new Error(
      `FakeObjectStore.get: not scripted (key: ${key}) -- the Papers Past ` +
        'adapter tests only exercise head/put.',
    );
  }

  async attachSha256Metadata(key: string): Promise<void> {
    throw new Error(
      `FakeObjectStore.attachSha256Metadata: not scripted (key: ${key}) -- ` +
        'the Papers Past adapter tests only exercise head/put.',
    );
  }

  /** Test helper: number of `put()` calls recorded for `key`. */
  putCountFor(key: string): number {
    return this.putCalls.filter((call) => call.key === key).length;
  }
}
