/**
 * The two-phase confirm-mode batch pipeline for `runConfirm` (spec
 * 015-english-source-pdf; AUDIT-20260719-10, HIGH).
 *
 * Before this fix, `publishIssue` read one issue's build metadata (`input
 * .json`) and IMMEDIATELY uploaded its bytes (a durable B2 PUT), returning
 * its disclosure afterward; the cross-issue disclosure-conflict check
 * (`mergeDisclosure`) ran only back in `runConfirm`'s loop, AFTER that
 * issue's upload had already happened. If issue 2's disclosure conflicted
 * with issue 1's, the run aborted after issue 2's PDF was already durably in
 * the object store with NO publication record and NO manifest entry -- an
 * orphaned artifact, through the exact same channel the pre-existing
 * malformed-`input.json`-before-upload guard already protects against.
 *
 * The fix splits the batch into two phases that run in strict sequence:
 *
 *  1. {@link validateIssueDisclosures} -- read + parse EVERY present issue's
 *     `input.json` and fold every disclosure into ONE running, cross-issue
 *     disclosure via `mergeDisclosure`. A per-issue read/parse failure
 *     (missing/malformed `input.json`) is recorded as an attributable
 *     failure and excluded (G-7, unchanged); a cross-issue disclosure
 *     CONFLICT instead THROWS, propagating out to abort the WHOLE run with
 *     NOTHING uploaded yet -- phase 2 never runs.
 *  2. {@link uploadValidatedIssues} -- upload the bytes for every issue that
 *     survived phase 1. Runs ONLY once phase 1 has already confirmed the
 *     whole batch's disclosure is conflict-free, so an upload here is never
 *     followed by a disclosure-conflict abort.
 *
 * Extracted from `modes.ts` (Constitution VII, <=500 lines).
 */

import { readFile } from 'node:fs/promises';

import { sha256OfFile } from '@/archive/checksum';
import { describeError } from '@/bibliography/load-primitives';
import { type Disclosure, mergeDisclosure } from '@/pdf/publish/disclosure';
import { cdnUrl, versionedKey } from '@/pdf/publish/key';
import type { IssueUploadResult } from '@/pdf/publish/record';
import { uploadArtifact } from '@/pdf/publish/upload';
import { inputJsonPathFor, readIssueBuildInfo, type IssueBuildInfo } from '@/pdf/publish/issue';
import type { PublishFailure, PublishOptions } from '@/pdf/publish/types';

/** One present issue paired with its validated (phase-1) build metadata. */
export interface ValidatedIssue {
  issue: { issueId: string; pdfPath: string };
  info: IssueBuildInfo;
}

/** Phase 1's result: the issues cleared to upload + the merged running disclosure. */
export interface DisclosureValidationResult {
  validated: ValidatedIssue[];
  disclosure: Disclosure;
}

/**
 * Phase 1 (AUDIT-20260719-10): read every present issue's `input.json` and
 * fold its disclosure into the running one, BEFORE any upload runs.
 *
 * A read/parse failure for one issue is pushed onto `failures` (mutated in
 * place, matching the caller's existing pre-counted-`missing` accumulator)
 * and that issue is excluded from both the returned `validated` list and the
 * disclosure merge -- it never uploads, exactly as before this fix (G-7). A
 * genuine cross-issue disclosure CONFLICT (`mergeDisclosure` throwing)
 * propagates out of this function uncaught, aborting the whole batch with no
 * upload attempted for ANY issue.
 */
export function validateIssueDisclosures(
  present: { issueId: string; pdfPath: string }[],
  failures: PublishFailure[],
): DisclosureValidationResult {
  const validated: ValidatedIssue[] = [];
  for (const issue of present) {
    try {
      const info = readIssueBuildInfo(inputJsonPathFor(issue.pdfPath, issue.issueId));
      validated.push({ issue, info });
    } catch (error) {
      failures.push({ issueId: issue.issueId, reason: describeError(error) });
    }
  }

  let disclosure: Disclosure = {};
  for (const { issue, info } of validated) {
    disclosure = mergeDisclosure(
      disclosure,
      { machineAssist: info.machineAssist ?? undefined, ocrTranscription: info.ocrTranscription ?? undefined },
      issue.issueId,
    );
  }

  return { validated, disclosure };
}

/** One issue's phase-2 upload outcome (or failure). */
export interface UploadOutcome {
  issueId: string;
  upload?: IssueUploadResult;
  /** `true` when bytes were newly PUT; `false` on an idempotent skip. */
  uploaded?: boolean;
  failure?: PublishFailure;
}

/**
 * Phase 2 (AUDIT-20260719-10): upload the bytes for every issue that
 * survived phase-1 validation. Every fault (file read, hashing, the upload
 * itself) is caught and returned as a per-issue failure so a sibling issue's
 * upload is never aborted (G-7) -- by this point the batch's disclosure is
 * already known conflict-free, so this phase's only failure mode is a
 * genuine per-issue I/O fault, never a disclosure mismatch.
 */
export async function uploadValidatedIssues(
  opts: PublishOptions,
  validated: ValidatedIssue[],
  snapshotShort: string,
  cdnBase: string,
): Promise<UploadOutcome[]> {
  const { sourceId, variant } = opts;
  const outcomes: UploadOutcome[] = [];
  for (const { issue, info } of validated) {
    try {
      const bytes = await readFile(issue.pdfPath);
      const sha256 = await sha256OfFile(issue.pdfPath);
      const key = versionedKey(variant, sourceId, issue.issueId, snapshotShort);
      const url = cdnUrl(cdnBase, key);
      const { uploaded } = await uploadArtifact(opts.store, key, bytes, sha256);
      outcomes.push({
        issueId: issue.issueId,
        upload: { issueId: issue.issueId, key, url, sha256, pages: info.pages },
        uploaded,
      });
    } catch (error) {
      outcomes.push({
        issueId: issue.issueId,
        failure: { issueId: issue.issueId, reason: describeError(error) },
      });
    }
  }
  return outcomes;
}
