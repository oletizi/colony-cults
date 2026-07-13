/**
 * The public data shapes of the `pdf:publish` orchestrator (spec
 * 008-edition-publishing): the CLI-facing {@link PublishOptions} + injected
 * collaborators and the structured {@link PublishResult} report the verb reads.
 * Extracted from `publish.ts` (Constitution VII, <=500 lines); re-exported from
 * `@/pdf/publish/publish` so existing import paths keep working.
 */

import type { ObjectStore } from '@/archive/object-store';
import type { HttpGet } from '@/archive/public-cache';
import type { ArchivePinReader, CorpusSnapshotReader } from '@/pdf/load/edition';
import type { MachineAssistLabel } from '@/pdf/model';
import type { PublicationVariant } from '@/pdf/publish/key';
import type { Clock } from '@/pdf/publish/record';

/**
 * Options for `publish`. `sourceId` / `variant` / `confirm` are the CLI
 * surface; the rest are injected collaborators + directory anchors that keep
 * the flow testable (Constitution VI).
 */
export interface PublishOptions {
  /** Snapshot source id (e.g. `PB-P001`). */
  sourceId: string;
  /** Which edition variant to publish (recorded + encoded into the key, FR-012). */
  variant: PublicationVariant;
  /** Deliberate-action gate: `true` mutates B2 + SSOT; anything else is a dry-run. */
  confirm: boolean;
  /**
   * Back-fill mode (FR-013, G-8): record the source's already-served
   * `legacy-flat` URLs WITHOUT any upload. Requires `confirm` to write records
   * (a `reconcile` dry-run only plans). When set, `runReconcile` runs instead of
   * `runConfirm`; the rights gate still runs first.
   */
  reconcile?: boolean;

  /** Built-PDF output root (default `build/pdf`, resolved by `resolvePublishTargets`). */
  outDir?: string;
  /** Committed snapshot dir (default `site/data`, resolved by `resolvePublishTargets`). */
  snapshotDir?: string;
  /** Physical `bibliography/sources` dir (holds `<sourceId>.yml`; written by upsert). */
  sourcesDir: string;
  /** Physical `bibliography/publications` dir (manifest files are written here). */
  publicationsDir: string;

  /** Injected object store (real S3/B2 backend or an in-memory fake). */
  store: ObjectStore;
  /** Injected clock for the deterministic `Publication.publishedAt`. */
  clock: Clock;
  /** Injected HTTP GET for the warm step (default real `fetch`). */
  httpGet?: HttpGet;
  /** Warm each new URL post-publish (G-9); pass `false` for `--no-warm`. Default `true`. */
  warm?: boolean;
  /**
   * The FR-008 commit hook. The core does NOT run git itself; the verb (T021)
   * passes a real committer, tests pass a spy or omit it. Awaited after the
   * SSOT + manifest are written (confirm mode only, and only when something was
   * recorded).
   */
  commit?: () => void | Promise<void>;

  /** Canonical CDN base override; when absent, resolved from `env` (`CORPUS_CDN_BASE`). */
  cdnBase?: string;
  /** Environment for `resolveCdnBase` (defaults to `process.env`). */
  env?: NodeJS.ProcessEnv;

  /** Injected pin reader for `resolveSnapshot` (tests); defaults to the configured pin file. */
  pinReader?: ArchivePinReader;
  /** Injected corpus-snapshot reader for `resolvePublishTargets` (tests). */
  corpusSnapshotReader?: CorpusSnapshotReader;

  /**
   * Machine-assist label override recorded on the `Publication`. When absent it
   * is captured from the build's `<issueId>.input.json` (same file as the page
   * count). REQUIRED for the translation variants -- absent makes
   * `buildPublication` throw (Constitution IV).
   */
  machineAssist?: MachineAssistLabel;

  /** Line-oriented progress sink (default `console.log`). */
  log?: (message: string) => void;
}

/** One attributable per-issue failure (G-7): the id and a human-readable reason. */
export interface PublishFailure {
  issueId: string;
  reason: string;
}

/** One planned (dry-run) upload: the derived key + canonical URL, nothing written. */
export interface PlannedIssue {
  issueId: string;
  key: string;
  url: string;
}

/**
 * The structured publish report (also printed). `ok` is the non-zero-exit
 * signal the verb reads (`ok === false` => exit 1); this module NEVER calls
 * `process.exit` (that is the verb's job, per contracts/cli.md exit codes).
 */
export interface PublishResult {
  /** `true` iff there were zero per-issue failures (drives the verb's exit code). */
  ok: boolean;
  /**
   * Whether this was a dry-run (planned only), a confirmed uploading run, or a
   * confirmed `reconcile` back-fill (records legacy-flat URLs, no upload). A
   * `reconcile` dry-run reports `'dry-run'` (it too writes nothing).
   */
  mode: 'dry-run' | 'confirm' | 'reconcile';
  sourceId: string;
  variant: PublicationVariant;
  /** Issues whose bytes were newly PUT (confirm mode); always 0 in dry-run. */
  published: number;
  /** Attributable per-issue failures (missing built PDF, immutability mismatch, etc.). */
  failed: number;
  /** Issues already present with a matching sha256 (idempotent skip); 0 in dry-run. */
  skipped: number;
  /** Canonical CDN URLs of the published/planned artifacts (G-10). */
  urls: string[];
  /** Every per-issue failure, id + reason (G-7); never silently dropped. */
  failures: PublishFailure[];
  /** Dry-run only: the planned keys/URLs that WOULD be published. */
  planned?: PlannedIssue[];
  /** Warm URLs that failed (non-fatal, G-9); does not affect `ok`. */
  warmFailed?: number;
}
