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
 * `issue.txt.yml` is a schema-compatible `ProvenanceFields` companion (the
 * same shape every other companion YAML in the archive uses, readable via
 * `@/archive/provenance`'s `readProvenance`) -- NOT a bespoke ad-hoc shape.
 * Its values are derived from the `ocr-text` asset's OWN already-written
 * provenance sidecar (`asset.provenancePath`, written at acquisition time by
 * `@/archive/write-record-companions`), the same "read a sibling's companion
 * and override only what changed" idiom `@/ocr/run`'s `derivedProvenance`
 * uses -- never fabricated, never wall-clock `new Date()`.
 *
 * FR-004 (re-materialization is idempotent/conflict-detecting) vs FR-005 (a
 * pre-existing, foreign `issue.txt` is left untouched) are discriminated by a
 * FIELD MARKER on `issue.txt.yml`, not by bare sidecar presence: a sidecar
 * only counts as "ours" when it PARSES as a schema-compatible
 * `ProvenanceFields` record (see {@link readOwnSidecar}) AND carries
 * `type === 'ocr-text'` with a non-empty `sha256`. Any read/parse failure
 * (missing file, foreign/malformed YAML, or a structurally-valid sidecar that
 * simply is not marked as our ocr-text materialization) is treated as "not
 * ours" -- routing to FR-005 (untouched no-op) rather than throwing, since a
 * sidecar this module did not write must never be able to crash
 * materialization. (Bare presence was rejected as the discriminator because a
 * sibling feature -- asset-summaries -- also `readProvenance`s
 * `issue.txt.yml`, which requires it to be schema-compatible in the first
 * place; layout-registry membership was rejected too, since a same-shaped ID
 * can collide with an unrelated static entry from an earlier spec.)
 *
 * Fail-loud (Principle V): a missing/ambiguous `ocr-text` asset, a checksum
 * mismatch between the fetched bytes and the asset's recorded `checksum`, a
 * missing/malformed OWN provenance sidecar for the `ocr-text` asset itself
 * (the source of `issue.txt.yml`'s fields), or a pre-existing, sidecar-owned
 * `issue.txt` that no longer matches (either the file was altered on disk, or
 * the `ocr-text` asset changed upstream) all throw a descriptive Error naming
 * the member's `sourceId` -- never a silent fallback, never a clobber.
 *
 * VERBATIM BYTES (idempotency correctness): `issue.txt` is written with the
 * fetched asset bytes EXACTLY AS FETCHED (no utf-8 decode/re-encode
 * round-trip). A non-UTF-8 (e.g. Latin-1) `ocr-text` asset therefore keeps
 * its real bytes on disk -- `sha256(on-disk issue.txt)` always equals
 * `asset.checksum` always equals the sidecar's recorded `sha256`, so the
 * idempotent re-check (hashing the on-disk bytes directly, never
 * `Buffer.from(text, 'utf-8')`) can never spuriously diverge. Re-encoding
 * through a utf-8 string would silently substitute U+FFFD replacement
 * characters for invalid byte sequences, changing the on-disk bytes'
 * digest out from under the recorded checksum and permanently blocking
 * re-materialization with a false "has been altered" throw. A valid-UTF-8
 * asset (the common case) is byte-identical whether written verbatim or via
 * a decode/re-encode round-trip, so this changes nothing observable for it.
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
 * which `existing === undefined` correctly still classifies as unwritten --
 * the NEXT call takes the fresh path again, safely re-fetching and
 * re-verifying rather than trusting a half-written file. "`issue.txt`
 * present with no RECOGNIZED-AS-OURS sidecar" can now ONLY mean a genuinely
 * foreign, out-of-band file (FR-005) -- it can never be one of this module's
 * own half-finished writes.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { assertInsideArchive, deriveSourceLayout } from '@/archive/location';
import type { ObjectStore } from '@/archive/object-store';
import type { ProvenanceFields } from '@/archive/provenance';
import { readProvenance, writeProvenance } from '@/archive/provenance';
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

/** Read `filePath`'s raw bytes, returning `undefined` when it does not exist. */
async function readIfExists(filePath: string): Promise<Buffer | undefined> {
  try {
    return await readFile(filePath);
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

/**
 * Read `sidecarPath` and return it as a full {@link ProvenanceFields} value
 * ONLY when it both parses successfully as one AND carries this module's own
 * materialization marker -- `type === 'ocr-text'` with a non-empty `sha256`
 * (the FIELD-based FR-004/FR-005 discriminator; see the module doc). Any read
 * failure (missing file), parse failure (foreign/malformed YAML -- including
 * a legitimate OTHER companion shape that simply is not a valid
 * `ProvenanceFields`), or a structurally-valid-but-unmarked sidecar all
 * return `undefined`. This is deliberately non-throwing: a sidecar this
 * module did not write must never be able to crash materialization, so an
 * unrecognized sidecar routes to FR-005 (untouched no-op), never a throw.
 */
async function readOwnSidecar(sidecarPath: string): Promise<ProvenanceFields | undefined> {
  let fields: ProvenanceFields;
  try {
    fields = await readProvenance(sidecarPath);
  } catch {
    return undefined;
  }
  if (fields.type !== 'ocr-text' || fields.sha256.trim().length === 0) {
    return undefined;
  }
  return fields;
}

/**
 * Read the `ocr-text` asset's OWN already-written provenance sidecar (at
 * `asset.provenancePath`, relative to `archiveRoot`) -- written for real at
 * acquisition time by `@/archive/write-record-companions`'s
 * `writeRecordCompanions`. This is `issue.txt.yml`'s source of truth for
 * every field it does not itself recompute (id/title/case/language/
 * source_archive/catalog_url/original_url/rights_status/retrieved/format/
 * ocr_status/object_store/source_representation/rights_raw/notes) -- the same
 * "read a sibling's already-written companion, override only what changed"
 * idiom `@/ocr/run`'s `derivedProvenance` uses for the analogous page-to-
 * derived-text derivation. Throws (fail loud, id-naming) when this sidecar is
 * missing or does not parse as a full `ProvenanceFields` -- there is no
 * fallback source for these fields, and fabricating them would violate
 * Principle V.
 */
async function readOwnAssetProvenance(
  archiveRoot: string,
  asset: AcquiredAsset,
  sourceId: string,
): Promise<ProvenanceFields> {
  const basePath = path.join(archiveRoot, asset.provenancePath);
  try {
    return await readProvenance(basePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `materializeIssueText: source "${sourceId}" ocr-text asset's own provenance sidecar ` +
        `"${basePath}" could not be read (${message}) -- issue.txt.yml's ProvenanceFields are ` +
        `derived from it (see @/archive/write-record-companions, which writes it at ` +
        `acquisition time); there is no fallback source for these fields.`,
    );
  }
}

/**
 * Write `bytes` to `issueTxtPath` ATOMICALLY and VERBATIM (no utf-8 decode/
 * re-encode -- see the module doc's "VERBATIM BYTES" note): write to a temp
 * file in the SAME directory (so the final `rename` is same-filesystem and
 * therefore atomic on POSIX), then `rename` it into place. A crash mid-write
 * can only ever leave the temp file behind (never a truncated
 * `issueTxtPath`) -- a reader either sees the complete prior content (no
 * `issueTxtPath` written yet) or the complete new content, never a partial
 * one.
 */
async function writeIssueTextAtomic(issueTxtPath: string, bytes: Uint8Array): Promise<void> {
  const dir = path.dirname(issueTxtPath);
  const tmpPath = path.join(dir, `.${path.basename(issueTxtPath)}.${randomUUID()}.tmp`);
  await writeFile(tmpPath, bytes);
  await rename(tmpPath, issueTxtPath);
}

/**
 * Materialize `member`'s `issue.txt` from its detached `ocr-text` asset into
 * its archive directory (resolved via {@link memberArchiveDir}).
 *
 * Behavior (discriminated by a FIELD MARKER on `issue.txt.yml` -- see the
 * module docstring for why this, and not bare sidecar presence or layout
 * registration, is the correct FR-004/FR-005 discriminator):
 *  - No existing `issue.txt`: FRESH. Resolve the single `ocr-text` asset,
 *    fetch its bytes, verify sha256 against `asset.checksum` (throws on
 *    mismatch), write `issue.txt` VERBATIM (no re-encode) + a schema-
 *    compatible `issue.txt.yml` derived from the asset's own provenance.
 *  - An existing `issue.txt` WITH a recognized-as-ours `issue.txt.yml`
 *    sidecar: this module materialized it before (FR-004). A FRUGAL check
 *    (Principle XII: no wasted object-store fetch on the idempotent path)
 *    compares (a) the on-disk `issue.txt`'s sha256 (hashed as raw bytes,
 *    never decoded) against the sidecar's recorded `sha256` (did the file
 *    get altered since we wrote it?) and (b) the asset's CURRENT `checksum`
 *    against that same recorded `sha256` (did the upstream `ocr-text` asset
 *    change since we wrote it?) -- both matching is a no-op; either
 *    mismatching throws (fail loud, never clobber), without ever fetching
 *    the asset's bytes.
 *  - An existing `issue.txt` with NO recognized-as-ours `issue.txt.yml`
 *    sidecar (missing entirely, or present but not our ocr-text
 *    materialization marker): a foreign/inline file some other, out-of-band
 *    flow already wrote here (FR-005, e.g. an acquired monograph's
 *    `issue.txt`) -- left completely untouched, the `ocr-text` asset is
 *    never even resolved, let alone fetched.
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
  const ownSidecar = await readOwnSidecar(sidecarPath);

  if (existing !== undefined && ownSidecar === undefined) {
    // A foreign/inline issue.txt with no RECOGNIZED sidecar of ours: some
    // other, out-of-band flow already wrote it here (FR-005). Leave it
    // completely untouched -- never resolve or fetch the detached ocr-text
    // asset.
    return issueTxtPath;
  }

  const asset = resolveOcrTextAsset(member);

  if (existing !== undefined && ownSidecar !== undefined) {
    // We materialized this issue.txt before (FR-004). Frugal re-check: no
    // object-store fetch, just local hashes vs the sidecar's recorded sha256.
    const recordedSha256 = ownSidecar.sha256;
    const onDiskSha256 = createHash('sha256').update(existing).digest('hex');

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

  const base = await readOwnAssetProvenance(archiveRoot, asset, member.sourceId);
  const sidecarFields: ProvenanceFields = {
    ...base,
    type: 'ocr-text',
    local_path: path.relative(archiveRoot, issueTxtPath),
    sha256: actualSha256,
    size: bytes.byteLength,
  };

  // Non-overridable in-archive guard (FR-006 precedent, `@/archive/store`):
  // both write targets must resolve strictly inside `archiveRoot` before any
  // filesystem write happens.
  assertInsideArchive(memberDir, archiveRoot);
  assertInsideArchive(sidecarPath, archiveRoot);
  assertInsideArchive(issueTxtPath, archiveRoot);

  await mkdir(memberDir, { recursive: true });
  // Sidecar FIRST, `issue.txt` second (atomically) -- see the module doc's
  // "CRASH-SAFETY" note for why this order (and not the reverse) closes the
  // window where a crash mid-write could leave a bare, sidecar-less
  // `issue.txt` that a later run would misclassify as foreign (FR-005).
  await writeProvenance(sidecarPath, sidecarFields);
  await writeIssueTextAtomic(issueTxtPath, bytes);

  return issueTxtPath;
}
