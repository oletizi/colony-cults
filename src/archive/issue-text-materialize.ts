/**
 * Materialize a source-group member's `issue.txt` (+ provenance sidecar) from
 * its detached `ocr-text` asset (spec 017, T005).
 *
 * A source-group member's OCR text is captured as a stand-alone
 * `AcquiredAsset` (role `ocr-text`) rather than being written inline during
 * acquisition -- {@link materializeIssueText} rehydrates it into the member's
 * flat archive directory as `issue.txt`, the same filename the OCR pipeline
 * (`@/ocr/run`) writes for a standalone monograph, so downstream readers
 * (translation, PDF build) do not need to know which path produced it.
 *
 * Fail-loud (Principle V): a missing/ambiguous `ocr-text` asset, a checksum
 * mismatch between the fetched bytes and the asset's recorded `checksum`, or
 * a pre-existing `issue.txt` whose content does not match the fetched text
 * all throw a descriptive Error naming the member's `sourceId` -- never a
 * silent fallback, never a clobber.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';

import { deriveSourceLayout, isSourceLayoutRegistered } from '@/archive/location';
import type { ObjectStore } from '@/archive/object-store';
import type { AcquiredAsset } from '@/model/acquired-asset';
import type { RepositoryRecord } from '@/model/repository-record';
import type { Source } from '@/model/source';

/** A `Source` carrying its `repositoryRecords`, the shape this module needs. */
type MemberWithRecords = Source & { repositoryRecords: RepositoryRecord[] };

/** Filename of the materialized issue text, matching `@/ocr/run`'s convention. */
const ISSUE_TXT_FILENAME = 'issue.txt';

/** Filename of the materialized text's provenance sidecar. */
const ISSUE_TXT_SIDECAR_FILENAME = 'issue.txt.yml';

/**
 * Resolve a member's flat archive directory purely from its OWN metadata
 * (`case`/`kind`/`partOf`/`titles`), via {@link deriveSourceLayout} --
 * deliberately NOT the shared `sourceLayout`/`monographDir` registry lookup
 * (`@/archive/location`), whose STATIC table is a hand-curated list of
 * pre-existing, unrelated production sources (e.g. `PB-P001`..`PB-P003`) from
 * earlier specs. A source-group member's placement is a pure, deterministic
 * function of its own fields (a member always derives `monograph`-kind flat
 * placement per `deriveSourceLayout`'s own contract) -- consulting the shared
 * registry would risk resolving to a same-shaped-ID but semantically
 * unrelated static entry instead of this member's actual directory.
 */
function memberArchiveDir(member: MemberWithRecords, archiveRoot: string): string {
  const layout = deriveSourceLayout(member);
  return path.join(archiveRoot, 'archive', 'cases', layout.case, layout.type, layout.slug);
}

/**
 * Resolve the single `ocr-text` asset across every repository record's
 * `assets[]`. Throws (fail loud, id-naming) when none or more than one is
 * present -- callers must not guess which representation is authoritative.
 */
function resolveOcrTextAsset(member: MemberWithRecords): AcquiredAsset {
  const ocrTextAssets = member.repositoryRecords
    .flatMap((record) => record.assets ?? [])
    .filter((asset) => asset.role === 'ocr-text');

  if (ocrTextAssets.length === 0) {
    throw new Error(
      `materializeIssueText: source "${member.sourceId}" has no "ocr-text" asset ` +
        `across its repositoryRecords -- cannot materialize issue.txt without a ` +
        `detached OCR text representation.`,
    );
  }
  if (ocrTextAssets.length > 1) {
    throw new Error(
      `materializeIssueText: source "${member.sourceId}" has ${ocrTextAssets.length} ` +
        `ambiguous "ocr-text" assets across its repositoryRecords -- exactly one is ` +
        `required to materialize issue.txt.`,
    );
  }
  return ocrTextAssets[0];
}

/** Read `filePath` as utf-8 text, returning `undefined` when it does not exist. */
async function readIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch (err) {
    if (isEnoent(err)) {
      return undefined;
    }
    throw err;
  }
}

/** True when `err` is a Node `ENOENT` (file-not-found) error. */
function isEnoent(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'ENOENT'
  );
}

/**
 * Write the `issue.txt.yml` provenance sidecar recording where the
 * materialized text came from: the object-store key it was fetched from, the
 * verified sha256, and the repository representation it was captured from
 * (e.g. `papers-past-text-tab`).
 */
async function writeSidecar(
  sidecarPath: string,
  sourceId: string,
  asset: AcquiredAsset,
  sha256: string,
): Promise<void> {
  const sidecar: Record<string, unknown> = {
    id: sourceId,
    object_store: { key: asset.objectStoreKey },
    sha256,
  };
  if (asset.sourceRepresentation !== undefined) {
    sidecar.source_representation = asset.sourceRepresentation;
  }
  sidecar.materialized_at = new Date().toISOString();
  await writeFile(sidecarPath, stringify(sidecar, { lineWidth: 0 }), 'utf-8');
}

/**
 * Materialize `member`'s `issue.txt` from its detached `ocr-text` asset into
 * its archive directory (resolved via {@link memberArchiveDir}).
 *
 * Behavior:
 *  - No existing `issue.txt`: resolve the single `ocr-text` asset, fetch its
 *    bytes, verify sha256 against `asset.checksum` (throws on mismatch),
 *    decode as utf-8, write `issue.txt` + `issue.txt.yml` provenance.
 *  - An existing `issue.txt`, and `member.sourceId` has NEVER been registered
 *    in `@/archive/location`'s layout registry (static or runtime overlay --
 *    i.e. no upstream step, e.g. `bib-sourcegroup-acquire`, has established
 *    this session manages this member's location): the file is an inline
 *    issue.txt some out-of-band flow already wrote here (FR-005) -- left
 *    completely untouched, the ocr-text asset is never even fetched.
 *  - An existing `issue.txt`, and `member.sourceId` IS registered: this
 *    session/pipeline owns this member's location, so the existing file is
 *    compared against the freshly fetched (checksum-verified) text --
 *    identical content is a no-op (FR-004's idempotent half); different
 *    content throws (fail loud, never clobber).
 *
 * Returns the absolute path to `issue.txt` (existing or freshly written).
 */
export async function materializeIssueText(
  member: MemberWithRecords,
  archiveRoot: string,
  objectStoreReader: ObjectStore,
): Promise<string> {
  const memberDir = memberArchiveDir(member, archiveRoot);
  const issueTxtPath = path.join(memberDir, ISSUE_TXT_FILENAME);

  const existing = await readIfExists(issueTxtPath);
  if (existing !== undefined && !isSourceLayoutRegistered(member.sourceId)) {
    // An issue.txt already sits here, but this member's archive layout has
    // never been registered (static OR runtime overlay) -- i.e. no upstream
    // step in this session (`bib-sourcegroup-acquire`) established this as a
    // location it manages. Treat the file as an inline issue.txt some other,
    // out-of-band flow already wrote here (FR-005): leave it completely
    // untouched, never even fetching the detached ocr-text asset.
    return issueTxtPath;
  }

  const asset = resolveOcrTextAsset(member);
  const bytes = await objectStoreReader.get(asset.objectStoreKey);
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== asset.checksum) {
    throw new Error(
      `materializeIssueText: source "${member.sourceId}" ocr-text asset checksum ` +
        `mismatch -- expected sha256 "${asset.checksum}" but fetched bytes from ` +
        `object-store key "${asset.objectStoreKey}" hashed to "${actualSha256}".`,
    );
  }

  const text = Buffer.from(bytes).toString('utf-8');

  if (existing !== undefined) {
    if (existing === text) {
      return issueTxtPath; // Idempotent re-write: identical content, no-op (FR-004).
    }
    throw new Error(
      `materializeIssueText: source "${member.sourceId}" already has a conflicting ` +
        `"${issueTxtPath}" whose content differs from its fetched ocr-text asset -- ` +
        `refusing to clobber an existing, different issue.txt.`,
    );
  }

  await mkdir(memberDir, { recursive: true });
  await writeFile(issueTxtPath, text, 'utf-8');

  const sidecarPath = path.join(memberDir, ISSUE_TXT_SIDECAR_FILENAME);
  await writeSidecar(sidecarPath, member.sourceId, asset, actualSha256);

  return issueTxtPath;
}
