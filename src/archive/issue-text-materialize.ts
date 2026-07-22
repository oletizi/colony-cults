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
 * FR-004 (re-materialization is idempotent/conflict-detecting) vs FR-005 (a
 * pre-existing, foreign `issue.txt` is left untouched) are discriminated by
 * the PRESENCE OF OUR OWN PROVENANCE SIDECAR (`issue.txt.yml`), never by
 * whether `member.sourceId` happens to be registered in `@/archive/location`'s
 * layout registry -- registration is an unrelated, incidental fact (a
 * same-shaped ID can collide with an existing static entry from an earlier
 * spec) and using it as the discriminator would misclassify a genuine,
 * unregistered conflict as an inline no-op. Only OUR sidecar's presence means
 * "this module wrote this issue.txt before"; see {@link materializeIssueText}.
 *
 * Fail-loud (Principle V): a missing/ambiguous `ocr-text` asset, a checksum
 * mismatch between the fetched bytes and the asset's recorded `checksum`, or
 * a pre-existing, sidecar-owned `issue.txt` that no longer matches (either the
 * file was altered on disk, or the `ocr-text` asset changed upstream) all
 * throw a descriptive Error naming the member's `sourceId` -- never a silent
 * fallback, never a clobber.
 *
 * CRASH-SAFETY of the fresh-materialization write sequence (AUDIT-BARRAGE
 * finding, spec 017 govern pass): the fresh path writes the sidecar
 * (`issue.txt.yml`) BEFORE `issue.txt`, and writes `issue.txt` itself
 * ATOMICALLY (a temp file in the same directory, then `rename`d into place).
 * This closes a crash window that used to exist with the opposite order
 * (`issue.txt` first, sidecar second): if the process died between the two
 * writes, the next run would see a bare `issue.txt` with NO sidecar and
 * misclassify it as a foreign/inline file (the FR-005 no-op branch above) --
 * permanently serving the partial/stale generated text with no checksum
 * re-verification, ever. With sidecar-first + atomic-rename ordering, the only
 * reachable crash state is "sidecar present, `issue.txt` absent" (a crash
 * between the sidecar write and the rename, or before the rename lands),
 * which `existing !== undefined` correctly still classifies as unwritten
 * (`existing === undefined`) -- the NEXT call takes the fresh path again,
 * safely re-fetching and re-verifying rather than trusting a half-written
 * file. "`issue.txt` present with no sidecar" can now ONLY mean a genuinely
 * foreign, out-of-band file (FR-005) -- it can never be one of this module's
 * own half-finished writes.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify } from 'yaml';

import { deriveSourceLayout } from '@/archive/location';
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
    typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT'
  );
}

/** Narrowing guard: is `value` a plain object (safe to index by string key)? */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Parse `raw` (the contents of an `issue.txt.yml` sidecar) and extract its
 * recorded `sha256` field. Throws (fail loud, id-naming) when the sidecar is
 * not a mapping or its `sha256` field is missing/not a non-empty string --
 * a sidecar this module cannot interpret must never be silently treated as
 * "no sidecar" (that would misroute FR-004 traffic onto the FR-005 path).
 */
function parseSidecarSha256(raw: string, sidecarPath: string, sourceId: string): string {
  const parsed: unknown = parseYaml(raw);
  if (!isRecord(parsed) || typeof parsed.sha256 !== 'string' || parsed.sha256.length === 0) {
    throw new Error(
      `materializeIssueText: source "${sourceId}" sidecar "${sidecarPath}" is malformed ` +
        `(missing or invalid "sha256" field) -- cannot determine whether the existing ` +
        `issue.txt it accompanies is still current.`,
    );
  }
  return parsed.sha256;
}

/**
 * Write `text` to `issueTxtPath` ATOMICALLY: write to a temp file in the
 * SAME directory (so the final `rename` is same-filesystem and therefore
 * atomic on POSIX), then `rename` it into place. A crash mid-write can only
 * ever leave the temp file behind (never a truncated `issueTxtPath`) -- a
 * reader either sees the complete prior content (no `issueTxtPath` written
 * yet) or the complete new content, never a partial one.
 */
async function writeIssueTextAtomic(issueTxtPath: string, text: string): Promise<void> {
  const dir = path.dirname(issueTxtPath);
  const tmpPath = path.join(dir, `.${path.basename(issueTxtPath)}.${randomUUID()}.tmp`);
  await writeFile(tmpPath, text, 'utf-8');
  await rename(tmpPath, issueTxtPath);
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
 * Behavior (discriminated by the PRESENCE OF OUR `issue.txt.yml` SIDECAR --
 * see the module docstring for why this, and not layout registration, is the
 * correct FR-004/FR-005 discriminator):
 *  - No existing `issue.txt`: FRESH. Resolve the single `ocr-text` asset,
 *    fetch its bytes, verify sha256 against `asset.checksum` (throws on
 *    mismatch), decode as utf-8, write `issue.txt` + `issue.txt.yml`.
 *  - An existing `issue.txt` WITH our `issue.txt.yml` sidecar: this module
 *    materialized it before (FR-004). A FRUGAL check (Principle XII: no
 *    wasted object-store fetch on the idempotent path) compares (a) the
 *    on-disk `issue.txt`'s sha256 against the sidecar's recorded `sha256`
 *    (did the file get altered since we wrote it?) and (b) the asset's
 *    CURRENT `checksum` against that same recorded `sha256` (did the
 *    upstream `ocr-text` asset change since we wrote it?) -- both matching
 *    is a no-op; either mismatching throws (fail loud, never clobber),
 *    without ever fetching the asset's bytes.
 *  - An existing `issue.txt` with NO `issue.txt.yml` sidecar: a foreign/
 *    inline file some other, out-of-band flow already wrote here (FR-005,
 *    e.g. an acquired monograph's `issue.txt`) -- left completely untouched,
 *    the `ocr-text` asset is never even resolved, let alone fetched.
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
  const sidecarPath = path.join(memberDir, ISSUE_TXT_SIDECAR_FILENAME);

  const existing = await readIfExists(issueTxtPath);
  const existingSidecarRaw = await readIfExists(sidecarPath);

  if (existing !== undefined && existingSidecarRaw === undefined) {
    // A foreign/inline issue.txt with no sidecar of ours: some other,
    // out-of-band flow already wrote it here (FR-005). Leave it completely
    // untouched -- never resolve or fetch the detached ocr-text asset.
    return issueTxtPath;
  }

  const asset = resolveOcrTextAsset(member);

  if (existing !== undefined && existingSidecarRaw !== undefined) {
    // We materialized this issue.txt before (FR-004). Frugal re-check: no
    // object-store fetch, just local hashes vs the sidecar's recorded sha256.
    const recordedSha256 = parseSidecarSha256(existingSidecarRaw, sidecarPath, member.sourceId);
    const onDiskSha256 = createHash('sha256').update(Buffer.from(existing, 'utf-8')).digest('hex');

    if (onDiskSha256 !== recordedSha256) {
      throw new Error(
        `materializeIssueText: source "${member.sourceId}" existing "${issueTxtPath}" has ` +
          `been altered since it was materialized (its content no longer matches the ` +
          `provenance sidecar "${sidecarPath}") -- refusing to clobber a conflicting file.`,
      );
    }
    if (asset.checksum !== recordedSha256) {
      throw new Error(
        `materializeIssueText: source "${member.sourceId}" ocr-text asset has changed since ` +
          `"${issueTxtPath}" was materialized (asset checksum "${asset.checksum}" differs ` +
          `from the sidecar's recorded sha256 "${recordedSha256}") -- refusing to clobber a ` +
          `conflicting file.`,
      );
    }
    return issueTxtPath; // Identical on both sides: idempotent no-op (FR-004).
  }

  // existing === undefined: FRESH materialization.
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

  await mkdir(memberDir, { recursive: true });
  // Sidecar FIRST, `issue.txt` second (atomically) -- see the module doc's
  // "CRASH-SAFETY" note for why this order (and not the reverse) closes the
  // window where a crash mid-write could leave a bare, sidecar-less
  // `issue.txt` that a later run would misclassify as foreign (FR-005).
  await writeSidecar(sidecarPath, member.sourceId, asset, actualSha256);
  await writeIssueTextAtomic(issueTxtPath, text);

  return issueTxtPath;
}
