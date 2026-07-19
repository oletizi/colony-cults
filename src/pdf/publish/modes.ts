/**
 * The mode runners + record/commit tail of the `pdf:publish` orchestrator
 * (spec 008-edition-publishing, T020/T024/T031; spec 015-english-source-pdf).
 * Extracted from `publish.ts` (Constitution VII, <=500 lines); `publish.ts`
 * stays the thin sequencer (rights gate -> resolve -> dispatch here) and this
 * module owns the four mode bodies + their shared record/commit tail.
 *
 * Ordering guarantees (contracts/cli.md): G-3/G-4 immutable idempotent uploads
 * (delegated to `upload`); G-5/G-6 integrity recorded + provenance committed
 * (`record` + injected `commit`); G-7 per-issue faults recorded with id+reason,
 * never abort siblings; G-9 warm is non-fatal.
 *
 * Reconcile (T031): {@link runReconcile} is the back-fill sibling of
 * {@link runConfirm} (G-8, FR-013, SC-006): GET-and-record each already-served
 * `legacy-flat` URL (no `store.put`/`store.head`), reading the page count +
 * disclosure from the same `<issueId>.input.json` confirm reads. The
 * record/commit tail is shared between both.
 */

import { sha256OfBytes } from '@/archive/checksum';
import { defaultHttpGet, type HttpGet } from '@/archive/public-cache';
import { describeError } from '@/bibliography/load-primitives';
import { loadSourceFile } from '@/bibliography/load';
import type { Publication } from '@/model/publication';
import { applyMachineAssistOverride, type Disclosure, mergeDisclosure } from '@/pdf/publish/disclosure';
import { validateIssueDisclosures, uploadValidatedIssues } from '@/pdf/publish/confirm-batch';
import { cdnUrl, legacyFlatKey, versionedKey } from '@/pdf/publish/key';
import {
  buildManifest,
  buildPublication,
  upsertPublication,
  writeManifestFile,
  type IssueUploadResult,
} from '@/pdf/publish/record';
import { warmUrls } from '@/pdf/publish/warm';
import {
  inputJsonPathFor,
  readIssueBuildInfo,
  sourceFilePath,
} from '@/pdf/publish/issue';
import type {
  PlannedIssue,
  PublishFailure,
  PublishOptions,
  PublishResult,
} from '@/pdf/publish/types';

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
  disclosure: Disclosure,
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

  // buildPublication fails loud when NEITHER disclosure is present (Constitution
  // IV) -- see `record.ts`'s `buildPublication`.
  const buildInput = {
    variant,
    snapshot: ctx.publicationSnapshot,
    snapshotShort: ctx.publicationSnapshotShort,
    cdnBase,
    keyScheme: ctx.keyScheme,
    rightsBasis,
    manifestPath,
    issueCount: manifest.issues.length,
    ...(disclosure.machineAssist !== undefined ? { machineAssist: disclosure.machineAssist } : {}),
    ...(disclosure.ocrTranscription !== undefined ? { ocrTranscription: disclosure.ocrTranscription } : {}),
  };
  const publication = buildPublication(buildInput, opts.clock);

  const loaded = loadSourceFile(sourceFilePath(opts.sourcesDir, sourceId));
  upsertPublication(opts.sourcesDir, loaded.source, loaded.records, publication);

  if (opts.commit !== undefined) {
    await opts.commit();
  }
}

/** Print + return the plan without touching B2 or the SSOT (dry-run, `--confirm` absent). */
export function runDryRun(
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
 * The confirmed, mutating pipeline (AUDIT-20260719-10: two strict phases --
 * see `@/pdf/publish/confirm-batch`): phase 1 reads + validates/merges EVERY
 * present issue's disclosure BEFORE any upload, so a cross-issue (or
 * option-seed) disclosure conflict aborts the WHOLE run with NOTHING
 * uploaded; phase 2 then uploads (G-3/G-4, record-and-continue G-7) only the
 * issues phase 1 cleared. Then record + commit (G-5/G-6) + non-fatal warm
 * (G-9). Missing built PDFs (from resolve) are pre-counted failures.
 */
export async function runConfirm(
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

  // Phase 1 (AUDIT-20260719-10): read + validate/merge every present issue's
  // disclosure -- built PURELY from per-issue outcomes (AUDIT-20260719-08),
  // then the kind-aware `opts.machineAssist` fallback (never contaminates an
  // English/ocrTranscription run). BOTH a cross-issue conflict and an
  // option-seed conflict throw HERE, before phase 2's first upload.
  const { validated, disclosure: perIssueDisclosure } = validateIssueDisclosures(present, failures);
  const disclosure = applyMachineAssistOverride(
    perIssueDisclosure,
    opts,
    '<publish option --machine-assist>',
  );

  // Phase 2: upload only the issues phase 1 cleared.
  const outcomes = await uploadValidatedIssues(opts, validated, snapshotShort, cdnBase);

  const uploads: IssueUploadResult[] = [];
  let published = 0;
  let skipped = 0;
  for (const outcome of outcomes) {
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
  }

  // Record + commit only when at least one issue succeeded (G-5/G-6, FR-008).
  if (uploads.length > 0) {
    await recordAndCommit(
      opts,
      uploads,
      disclosure,
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
export interface ReconcileTarget {
  issueId: string;
  inputJsonPath: string;
}

/** The per-issue reconcile outcome: a served-URL record + disclosure, or a failure. */
interface ReconcileIssueOutcome extends Disclosure {
  upload?: IssueUploadResult;
  failure?: PublishFailure;
}

/**
 * Reconcile ONE issue (G-8, no upload): derive its `legacyFlatKey` + `cdnUrl`,
 * GET the served bytes via the injected `httpGet` to compute the recorded
 * `sha256`, and read the page count + provenance disclosure from the build's
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

    const { pages, machineAssist, ocrTranscription } = readIssueBuildInfo(target.inputJsonPath);

    return {
      upload: { issueId: target.issueId, key, url, sha256, pages },
      machineAssist: machineAssist ?? undefined,
      ocrTranscription: ocrTranscription ?? undefined,
    };
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
export async function runReconcile(
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
  // Built PURELY from per-issue outcomes (AUDIT-20260719-08) -- see
  // `runConfirm`'s matching comment + `applyMachineAssistOverride`.
  let disclosure: Disclosure = {};

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
    // Throws (AUDIT-20260719-06) if this issue's disclosure conflicts with an
    // earlier one in this run -- see `runConfirm`'s matching comment.
    disclosure = mergeDisclosure(disclosure, outcome, target.issueId);
  }

  // Record + commit only when at least one issue was reconciled (G-5/G-6, FR-008).
  if (uploads.length > 0) {
    disclosure = applyMachineAssistOverride(disclosure, opts, '<publish option --machine-assist>');
    await recordAndCommit(opts, uploads, disclosure, LEGACY_FLAT_CONTEXT, cdnBase, rightsBasis);
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
export function runReconcileDryRun(
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
export function reconcileTargets(
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
