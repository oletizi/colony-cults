/**
 * The `pdf:publish` orchestrator (spec 008-edition-publishing, T020 + T024):
 * compose the already-built leaf modules of `src/pdf/publish/` into the
 * governed publish pipeline the CLI verb (T021) drives. This module owns the
 * SEQUENCING and the record-and-continue batch semantics; it re-implements
 * none of the leaf behaviour (resolve / rights-gate / version / key / upload /
 * record / warm each own their own concern).
 *
 * Constitution VI (composition over ambient globals): every side-effecting
 * collaborator is INJECTED (`ObjectStore`, `Clock`, warm `httpGet`, the FR-008
 * `commit` hook, pin/corpus readers, CDN base), so the whole flow is testable
 * with a FakeObjectStore, temp dirs, and a fake clock, with NO network and NO
 * git. The core NEVER runs git: the verb passes a real committer; tests spy/omit.
 *
 * Ordering guarantees (contracts/cli.md): G-2 (T024) rights gate runs FIRST,
 * fail-closed; G-3/G-4 immutable idempotent uploads (delegated to `upload`);
 * G-5/G-6 integrity recorded + provenance committed (`record` + injected
 * `commit`); G-7 per-issue faults recorded with id+reason, never abort
 * siblings; G-9 warm is non-fatal; G-10 report prints count + canonical URLs.
 *
 * Reconcile (T031): {@link runReconcile} is the back-fill sibling of
 * {@link runConfirm} (contracts/cli.md G-8, FR-013, SC-006). It records the
 * already-served `legacy-flat` URLs of a source's issues WITHOUT any upload
 * (no `store.put`/`store.head`): it GETs each served URL via the injected
 * `httpGet` to compute the recorded `sha256`, reads the page count from the
 * build's `<issueId>.input.json` (same as confirm), and records with
 * `keyScheme: 'legacy-flat'` + the `legacy` manifest token. The rights gate
 * still runs FIRST (fail-closed) and the record/commit tail is shared, so the
 * only behavioural difference is "GET-and-record" vs "upload-and-record".
 */

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { sha256OfBytes, sha256OfFile } from '@/archive/checksum';
import type { ObjectStore } from '@/archive/object-store';
import { defaultHttpGet, type HttpGet } from '@/archive/public-cache';
import { describeError } from '@/bibliography/load-primitives';
import { loadSourceFile } from '@/bibliography/load';
import type { ArchivePinReader, CorpusSnapshotReader } from '@/pdf/load/edition';
import type { MachineAssistLabel } from '@/pdf/model';
import type { Publication } from '@/model/publication';
import {
  cdnUrl,
  legacyFlatKey,
  resolveCdnBase,
  versionedKey,
  type PublicationVariant,
} from '@/pdf/publish/key';
import {
  buildManifest,
  buildPublication,
  upsertPublication,
  writeManifestFile,
  type Clock,
  type IssueUploadResult,
} from '@/pdf/publish/record';
import { resolvePublishTargets } from '@/pdf/publish/resolve';
import { assertPublishable } from '@/pdf/publish/rights-gate';
import { uploadArtifact } from '@/pdf/publish/upload';
import { resolveSnapshot } from '@/pdf/publish/version';
import { warmUrls } from '@/pdf/publish/warm';

/**
 * Options for {@link publish}. `sourceId` / `variant` / `confirm` are the CLI
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
   * (a `reconcile` dry-run only plans). When set, {@link runReconcile} runs
   * instead of {@link runConfirm}; the rights gate still runs first.
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

/** True for a plain JSON object (used to narrow the parsed build input.json). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Non-empty-string guard with a locating throw. */
function requireNonEmptyString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${where} must be a non-empty string`);
  }
  return value;
}

/** The two facts read from a built issue's `<issueId>.input.json` (data-model §3). */
interface IssueBuildInfo {
  /** Page count from `input.json` `.pages.length`, NOT parsed from PDF bytes. */
  pages: number;
  /** Machine-assist label carried on every page's recto (colophon translation). */
  machineAssist: MachineAssistLabel;
}

/** Parse a `MachineAssistLabel` out of the build input.json's `recto.machineAssist`. */
function parseMachineAssist(value: unknown, where: string): MachineAssistLabel {
  if (!isRecord(value)) {
    throw new Error(`${where} must be an object`);
  }
  const engine = requireNonEmptyString(value.engine, `${where}.engine`);
  const retrieved = requireNonEmptyString(value.retrieved, `${where}.retrieved`);
  const rawModel = value.model;
  if (rawModel !== null && rawModel !== undefined && typeof rawModel !== 'string') {
    throw new Error(`${where}.model must be a string or null`);
  }
  const model = typeof rawModel === 'string' ? rawModel : null;
  return { engine, model, retrieved };
}

/**
 * Read the built issue's page count + machine-assist label from its
 * `<issueId>.input.json` (a serialized `TypstInput`, written next to the PDF by
 * `pdf:build`). Throws (missing file, malformed shape) -- the caller catches
 * per-issue and records it as an attributable failure (G-7).
 */
function readIssueBuildInfo(inputJsonPath: string): IssueBuildInfo {
  const parsed: unknown = JSON.parse(readFileSync(inputJsonPath, 'utf-8'));
  if (!isRecord(parsed)) {
    throw new Error(`${inputJsonPath}: build input.json is not a JSON object`);
  }
  const pages = parsed.pages;
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error(`${inputJsonPath}: "pages" must be a non-empty array (build input.json)`);
  }
  const first = pages[0];
  if (!isRecord(first) || !isRecord(first.recto)) {
    throw new Error(`${inputJsonPath}: pages[0].recto must be an object (build input.json)`);
  }
  const machineAssist = parseMachineAssist(
    first.recto.machineAssist,
    `${inputJsonPath}: pages[0].recto.machineAssist`,
  );
  return { pages: pages.length, machineAssist };
}

/** Derive a built issue's `input.json` path from its `<issueId>.pdf` path. */
function inputJsonPathFor(pdfPath: string, issueId: string): string {
  return path.join(path.dirname(pdfPath), `${issueId}.input.json`);
}

/** The per-issue confirm outcome: an upload record + provenance, or a failure. */
interface ConfirmIssueOutcome {
  upload?: IssueUploadResult;
  /** `true` when bytes were newly PUT; `false` on an idempotent skip. */
  uploaded?: boolean;
  machineAssist?: MachineAssistLabel;
  failure?: PublishFailure;
}

/**
 * Publish (or upload-skip) ONE present issue: hash + key + url + immutable
 * upload + page/label read. Every fault is caught and returned as a failure so
 * a sibling issue is never aborted (G-7).
 */
async function publishIssue(
  opts: PublishOptions,
  issue: { issueId: string; pdfPath: string },
  snapshotShort: string,
  cdnBase: string,
): Promise<ConfirmIssueOutcome> {
  const { sourceId, variant } = opts;
  try {
    const bytes = await readFile(issue.pdfPath);
    const sha256 = await sha256OfFile(issue.pdfPath);
    const key = versionedKey(variant, sourceId, issue.issueId, snapshotShort);
    const url = cdnUrl(cdnBase, key);

    const { uploaded } = await uploadArtifact(opts.store, key, bytes, sha256);
    const { pages, machineAssist } = readIssueBuildInfo(
      inputJsonPathFor(issue.pdfPath, issue.issueId),
    );

    return {
      upload: { issueId: issue.issueId, key, url, sha256, pages },
      uploaded,
      machineAssist,
    };
  } catch (error) {
    return { failure: { issueId: issue.issueId, reason: describeError(error) } };
  }
}

/**
 * The version-scheme context {@link recordAndCommit} needs to differ between
 * the versioned confirm path and the legacy-flat reconcile path (data-model §4).
 */
interface RecordContext {
  /** `versioned` (new uploads) or `legacy-flat` (reconciled flat set). */
  keyScheme: Publication['keyScheme'];
  /** Manifest content's `snapshot` field; `undefined` omits it (reconcile). */
  manifestSnapshot: string | undefined;
  /** Manifest filename version token: the `snapshotShort`, or `legacy` (reconcile). */
  manifestVersion: string;
  /** `Publication.snapshot`: the full ref, or `legacy` (reconcile). */
  publicationSnapshot: string;
  /** `Publication.snapshotShort` (also the upsert identity): short token, or `legacy`. */
  publicationSnapshotShort: string;
}

/**
 * Assemble + persist the `Publication` and its per-issue manifest from the
 * successful upload/served results (G-5), then await the injected commit hook
 * (G-6 / FR-008). No-op when nothing was recorded. `ctx` selects the version
 * scheme (versioned confirm vs legacy-flat reconcile).
 */
async function recordAndCommit(
  opts: PublishOptions,
  uploads: IssueUploadResult[],
  machineAssist: MachineAssistLabel | undefined,
  ctx: RecordContext,
  cdnBase: string,
  rightsBasis: string,
): Promise<void> {
  const { sourceId, variant } = opts;
  const manifest = buildManifest({
    sourceId,
    variant,
    cdnBase,
    issues: uploads,
    ...(ctx.manifestSnapshot !== undefined ? { snapshot: ctx.manifestSnapshot } : {}),
  });
  const manifestPath = writeManifestFile(opts.publicationsDir, manifest, ctx.manifestVersion);

  // buildPublication fails loud when a translation-carrying variant has no
  // machineAssist label (Constitution IV) -- both in-scope variants qualify.
  const buildInput = {
    variant,
    snapshot: ctx.publicationSnapshot,
    snapshotShort: ctx.publicationSnapshotShort,
    cdnBase,
    keyScheme: ctx.keyScheme,
    rightsBasis,
    manifestPath,
    issueCount: manifest.issues.length,
    ...(machineAssist !== undefined ? { machineAssist } : {}),
  };
  const publication = buildPublication(buildInput, opts.clock);

  const loaded = loadSourceFile(sourceFilePath(opts.sourcesDir, sourceId));
  upsertPublication(opts.sourcesDir, loaded.source, loaded.records, publication);

  if (opts.commit !== undefined) {
    await opts.commit();
  }
}

/** The `<sourceId>.yml` path under the physical sources dir. */
function sourceFilePath(sourcesDir: string, sourceId: string): string {
  return path.join(sourcesDir, `${sourceId}.yml`);
}

/** Print + return the plan without touching B2 or the SSOT (dry-run, `--confirm` absent). */
function runDryRun(
  opts: PublishOptions,
  present: { issueId: string; pdfPath: string }[],
  missing: { issueId: string; expectedPath: string }[],
  snapshotShort: string,
  cdnBase: string,
  log: (message: string) => void,
): PublishResult {
  const { sourceId, variant } = opts;
  const planned: PlannedIssue[] = present.map((issue) => {
    const key = versionedKey(variant, sourceId, issue.issueId, snapshotShort);
    return { issueId: issue.issueId, key, url: cdnUrl(cdnBase, key) };
  });

  log(`pdf:publish -- source ${sourceId}  variant ${variant}  (DRY RUN, nothing written)`);
  for (const plan of planned) {
    log(`  PLAN  ${plan.issueId} -> ${plan.key}`);
    log(`        ${plan.url}`);
  }
  const failures: PublishFailure[] = missing.map((m) => ({
    issueId: m.issueId,
    reason: `no built PDF at ${m.expectedPath}`,
  }));
  for (const failure of failures) {
    log(`  FAIL  ${failure.issueId}: ${failure.reason}`);
  }
  log(`planned ${planned.length}, missing ${failures.length}`);

  return {
    ok: failures.length === 0,
    mode: 'dry-run',
    sourceId,
    variant,
    published: 0,
    failed: failures.length,
    skipped: 0,
    urls: planned.map((p) => p.url),
    failures,
    planned,
  };
}

/**
 * The confirmed, mutating pipeline: per-issue immutable upload (G-3/G-4,
 * record-and-continue G-7), then record + commit (G-5/G-6) + non-fatal warm
 * (G-9). Missing built PDFs (from resolve) are pre-counted failures.
 */
async function runConfirm(
  opts: PublishOptions,
  present: { issueId: string; pdfPath: string }[],
  missing: { issueId: string; expectedPath: string }[],
  rightsBasis: string,
  snapshotFull: string,
  snapshotShort: string,
  cdnBase: string,
  log: (message: string) => void,
): Promise<PublishResult> {
  const { sourceId, variant } = opts;
  log(`pdf:publish -- source ${sourceId}  variant ${variant}  (confirmed)`);
  log(`  rights: cleared (basis: ${JSON.stringify(rightsBasis)})`);
  log(`  snapshot: ${snapshotShort} (pinned ${snapshotFull})`);

  // MISSING built PDFs are attributable failures, pre-counted (G-7).
  const failures: PublishFailure[] = missing.map((m) => ({
    issueId: m.issueId,
    reason: `no built PDF at ${m.expectedPath}`,
  }));

  const uploads: IssueUploadResult[] = [];
  let published = 0;
  let skipped = 0;
  let machineAssist: MachineAssistLabel | undefined = opts.machineAssist;

  for (const issue of present) {
    const outcome = await publishIssue(opts, issue, snapshotShort, cdnBase);
    if (outcome.failure !== undefined) {
      failures.push(outcome.failure);
      log(`  FAIL  ${outcome.failure.issueId}: ${outcome.failure.reason}`);
      continue;
    }
    if (outcome.upload === undefined) {
      continue;
    }
    uploads.push(outcome.upload);
    if (outcome.uploaded === true) {
      published += 1;
      log(`  OK    ${outcome.upload.issueId} -> ${outcome.upload.key}  (uploaded)`);
    } else {
      skipped += 1;
      log(`  SKIP  ${outcome.upload.issueId} -> ${outcome.upload.key}  (present, sha256 match)`);
    }
    if (machineAssist === undefined) {
      machineAssist = outcome.machineAssist;
    }
  }

  // Record + commit only when at least one issue succeeded (G-5/G-6, FR-008).
  if (uploads.length > 0) {
    await recordAndCommit(
      opts,
      uploads,
      machineAssist,
      {
        keyScheme: 'versioned',
        manifestSnapshot: snapshotFull,
        manifestVersion: snapshotShort,
        publicationSnapshot: snapshotFull,
        publicationSnapshotShort: snapshotShort,
      },
      cdnBase,
      rightsBasis,
    );
  }

  const urls = uploads.map((u) => u.url);
  let warmFailed = 0;
  if (opts.warm !== false && urls.length > 0) {
    const warmResult = await warmUrls(urls, { httpGet: opts.httpGet, log });
    warmFailed = warmResult.failed.length;
  }

  log(`published ${published}, failed ${failures.length}, skipped ${skipped}`);
  for (const url of urls) {
    log(`  ${url}`);
  }
  for (const failure of failures) {
    log(`FAIL ${failure.issueId}: ${failure.reason}`);
  }

  return {
    ok: failures.length === 0,
    mode: 'confirm',
    sourceId,
    variant,
    published,
    failed: failures.length,
    skipped,
    urls,
    failures,
    warmFailed,
  };
}

/** The legacy-flat record context (data-model §4): no snapshot, `legacy` token. */
const LEGACY_FLAT_CONTEXT: RecordContext = {
  keyScheme: 'legacy-flat',
  manifestSnapshot: undefined,
  manifestVersion: 'legacy',
  publicationSnapshot: 'legacy',
  publicationSnapshotShort: 'legacy',
};

/** One issue to reconcile: its id + the build `input.json` the page count is read from. */
interface ReconcileTarget {
  issueId: string;
  inputJsonPath: string;
}

/** The per-issue reconcile outcome: a served-URL record + label, or a failure. */
interface ReconcileIssueOutcome {
  upload?: IssueUploadResult;
  machineAssist?: MachineAssistLabel;
  failure?: PublishFailure;
}

/**
 * Reconcile ONE issue (G-8, no upload): derive its `legacyFlatKey` + `cdnUrl`,
 * GET the served bytes via the injected `httpGet` to compute the recorded
 * `sha256`, and read the page count + machine-assist label from the build's
 * `<issueId>.input.json` (same source as confirm). A non-OK GET or a missing
 * `input.json` is caught and returned as an attributable failure (G-7), never a
 * silent skip and never fabricated.
 */
async function reconcileIssue(
  opts: PublishOptions,
  target: ReconcileTarget,
  cdnBase: string,
  httpGet: HttpGet,
): Promise<ReconcileIssueOutcome> {
  const { sourceId } = opts;
  try {
    const key = legacyFlatKey(sourceId, target.issueId);
    const url = cdnUrl(cdnBase, key);

    const response = await httpGet(url);
    if (!response.ok) {
      throw new Error(
        `reconcile GET ${url} failed (${response.status} ${response.statusText})`,
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const sha256 = sha256OfBytes(bytes);

    const { pages, machineAssist } = readIssueBuildInfo(target.inputJsonPath);

    return { upload: { issueId: target.issueId, key, url, sha256, pages }, machineAssist };
  } catch (error) {
    return { failure: { issueId: target.issueId, reason: describeError(error) } };
  }
}

/**
 * The confirmed reconcile pipeline (G-8, FR-013, SC-006): for each enumerated
 * issue, GET-and-record its already-served legacy-flat URL (NO upload -- calls
 * no `store.put`/`store.head`), then record + commit at `keyScheme:
 * 'legacy-flat'` with the `legacy` manifest token. Per-issue faults are
 * record-and-continue (G-7).
 */
async function runReconcile(
  opts: PublishOptions,
  targets: ReconcileTarget[],
  rightsBasis: string,
  cdnBase: string,
  log: (message: string) => void,
): Promise<PublishResult> {
  const { sourceId, variant } = opts;
  const httpGet = opts.httpGet ?? defaultHttpGet;
  log(`pdf:publish -- source ${sourceId}  variant ${variant}  (reconcile, back-fill)`);
  log(`  rights: cleared (basis: ${JSON.stringify(rightsBasis)})`);

  const failures: PublishFailure[] = [];
  const uploads: IssueUploadResult[] = [];
  let recorded = 0;
  let machineAssist: MachineAssistLabel | undefined = opts.machineAssist;

  for (const target of targets) {
    const outcome = await reconcileIssue(opts, target, cdnBase, httpGet);
    if (outcome.failure !== undefined) {
      failures.push(outcome.failure);
      log(`  FAIL  ${outcome.failure.issueId}: ${outcome.failure.reason}`);
      continue;
    }
    if (outcome.upload === undefined) {
      continue;
    }
    uploads.push(outcome.upload);
    recorded += 1;
    log(`  REC   ${outcome.upload.issueId} -> ${outcome.upload.key}  (served, recorded)`);
    if (machineAssist === undefined) {
      machineAssist = outcome.machineAssist;
    }
  }

  // Record + commit only when at least one issue was reconciled (G-5/G-6, FR-008).
  if (uploads.length > 0) {
    await recordAndCommit(opts, uploads, machineAssist, LEGACY_FLAT_CONTEXT, cdnBase, rightsBasis);
  }

  const urls = uploads.map((u) => u.url);
  log(`reconciled ${recorded}, failed ${failures.length}`);
  for (const url of urls) {
    log(`  ${url}`);
  }
  for (const failure of failures) {
    log(`FAIL ${failure.issueId}: ${failure.reason}`);
  }

  return {
    ok: failures.length === 0,
    mode: 'reconcile',
    sourceId,
    variant,
    published: recorded,
    failed: failures.length,
    skipped: 0,
    urls,
    failures,
  };
}

/** Plan the legacy-flat keys/URLs a reconcile WOULD record; writes nothing (dry-run). */
function runReconcileDryRun(
  opts: PublishOptions,
  targets: ReconcileTarget[],
  cdnBase: string,
  log: (message: string) => void,
): PublishResult {
  const { sourceId, variant } = opts;
  const planned: PlannedIssue[] = targets.map((target) => {
    const key = legacyFlatKey(sourceId, target.issueId);
    return { issueId: target.issueId, key, url: cdnUrl(cdnBase, key) };
  });

  log(`pdf:publish -- source ${sourceId}  variant ${variant}  (RECONCILE DRY RUN, nothing written)`);
  for (const plan of planned) {
    log(`  PLAN  ${plan.issueId} -> ${plan.key}`);
    log(`        ${plan.url}`);
  }
  log(`planned ${planned.length}`);

  return {
    ok: true,
    mode: 'dry-run',
    sourceId,
    variant,
    published: 0,
    failed: 0,
    skipped: 0,
    urls: planned.map((p) => p.url),
    failures: [],
    planned,
  };
}

/** Every enumerated issue (present + missing built PDF), as reconcile targets. */
function reconcileTargets(
  present: { issueId: string; pdfPath: string }[],
  missing: { issueId: string; expectedPath: string }[],
): ReconcileTarget[] {
  return [
    ...present.map((issue) => ({
      issueId: issue.issueId,
      inputJsonPath: inputJsonPathFor(issue.pdfPath, issue.issueId),
    })),
    ...missing.map((issue) => ({
      issueId: issue.issueId,
      inputJsonPath: inputJsonPathFor(issue.expectedPath, issue.issueId),
    })),
  ];
}

/**
 * Run the `pdf:publish` pipeline for one source + variant.
 *
 * Fail-loud preconditions (throw before any upload/record): the rights gate
 * (T024, FIRST), an unresolvable pin, an unset CDN base, an unknown source.
 * Per-issue faults are record-and-continue (G-7). Returns the structured
 * report; NEVER calls `process.exit` -- `result.ok === false` is the verb's
 * non-zero-exit signal.
 */
export async function publish(opts: PublishOptions): Promise<PublishResult> {
  const log = opts.log ?? ((message: string) => console.log(message));

  // Step 1 (T024): rights gate FIRST -- a refusal throws before ANY work.
  const loaded = loadSourceFile(sourceFilePath(opts.sourcesDir, opts.sourceId));
  const rightsBasis = assertPublishable(loaded.source);

  // Step 2: reproducible version token + canonical CDN base (both fail loud).
  const snapshot = resolveSnapshot(opts.pinReader);
  const cdnBase = opts.cdnBase ?? resolveCdnBase(opts.env);

  // Step 3: enumerate present vs missing built PDFs (never builds).
  const targets = await resolvePublishTargets({
    sourceId: opts.sourceId,
    variant: opts.variant,
    outDir: opts.outDir,
    snapshotDir: opts.snapshotDir,
    env: opts.env,
    snapshotReader: opts.corpusSnapshotReader,
  });

  // Dry-run: plan + missing only; write NOTHING; do not commit.
  if (opts.confirm !== true) {
    if (opts.reconcile === true) {
      return runReconcileDryRun(
        opts,
        reconcileTargets(targets.issues, targets.missing),
        cdnBase,
        log,
      );
    }
    return runDryRun(opts, targets.issues, targets.missing, snapshot.short, cdnBase, log);
  }

  // Reconcile (G-8): back-fill the already-served legacy-flat URLs, no upload.
  if (opts.reconcile === true) {
    return runReconcile(
      opts,
      reconcileTargets(targets.issues, targets.missing),
      rightsBasis,
      cdnBase,
      log,
    );
  }

  // Confirm: upload + record + commit + warm.
  return runConfirm(
    opts,
    targets.issues,
    targets.missing,
    rightsBasis,
    snapshot.full,
    snapshot.short,
    cdnBase,
    log,
  );
}
