/**
 * The `pdf:publish` orchestrator (spec 008-edition-publishing, T020 + T024):
 * compose the already-built leaf modules of `src/pdf/publish/` into the
 * governed publish pipeline the CLI verb (T021) drives. This module owns the
 * SEQUENCING; the record-and-continue batch semantics + the four mode bodies
 * live in `@/pdf/publish/modes`, and it re-implements none of the leaf
 * behaviour (resolve / rights-gate / version / key / upload / record / warm
 * each own their own concern).
 *
 * Constitution VI (composition over ambient globals): every side-effecting
 * collaborator is INJECTED (`ObjectStore`, `Clock`, warm `httpGet`, the FR-008
 * `commit` hook, pin/corpus readers, CDN base), so the whole flow is testable
 * with a FakeObjectStore, temp dirs, and a fake clock, with NO network and NO
 * git. The core NEVER runs git: the verb passes a real committer; tests spy/omit.
 *
 * Constitution VII (module size <=500 lines): the public data shapes live in
 * `@/pdf/publish/types`, the per-issue read/parse/path helpers in
 * `@/pdf/publish/issue`, and the mode runners + record/commit tail in
 * `@/pdf/publish/modes`. The `PublishOptions` / `PublishResult` / `Clock` types
 * are re-exported from here so existing import paths keep working.
 *
 * Ordering guarantees (contracts/cli.md): G-2 (T024) rights gate runs FIRST,
 * fail-closed; G-3..G-10 are enforced inside the dispatched mode runners.
 */

import { loadSourceFile } from '@/bibliography/load';
import { resolveCdnBase } from '@/pdf/publish/key';
import { resolvePublishTargets } from '@/pdf/publish/resolve';
import { assertPublishable } from '@/pdf/publish/rights-gate';
import { resolveSnapshot } from '@/pdf/publish/version';
import { sourceFilePath } from '@/pdf/publish/issue';
import {
  reconcileTargets,
  runConfirm,
  runDryRun,
  runReconcile,
  runReconcileDryRun,
} from '@/pdf/publish/modes';
import type {
  PlannedIssue,
  PublishFailure,
  PublishOptions,
  PublishResult,
} from '@/pdf/publish/types';

// Re-export the public types so `@/pdf/publish/publish` stays their import path.
export type { PlannedIssue, PublishFailure, PublishOptions, PublishResult };
export type { Clock } from '@/pdf/publish/record';

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
