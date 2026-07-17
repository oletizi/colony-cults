/**
 * The **archive-reconciliation sanity checker** (`bib validate`'s cross-repo
 * bookkeeping contract). When it is quiet, the SSOT (this repo) and the archive
 * companion records (the archive repo) agree; when it barks, the bookkeeping is
 * broken and names exactly how.
 *
 * WHY THIS EXISTS: the archive pipeline -- the translator, OCR, the corpus
 * browser, coverage -- discovers and reads masters through the archive companion
 * records (`archive/**\/*.yml`, each with an `object_store.key` + `sha256`), NOT
 * through the SSOT asset list. So the SSOT and the companions are two
 * representations of the same masters that MUST stay in lock-step. A B2-direct
 * acquisition (New Italy Museum, spec 011; Internet Archive, spec 013) that
 * mirrors bytes to the object store and records them in the SSOT but never writes
 * the companions leaves the work UNDISCOVERABLE -- and nothing screamed, until
 * this. Basic record-keeping, made mechanical.
 *
 * THE INVARIANTS (each a fail-loud `ValidationFinding`):
 *   1. `undiscoverable-master` -- an SSOT object-store master with NO companion.
 *   2. `orphaned-companion`    -- a B2-direct companion (`archive/internet-archive/`
 *                                 or `archive/museum/` key) with NO SSOT asset.
 *   3. `checksum-drift`        -- the same object key in BOTH sides with mismatched
 *                                 sha256 (the SSOT and the archive disagree about
 *                                 the bytes).
 *
 * Gallica masters are represented in the SSOT as a `manifest`/`issues` roll-up
 * (not per-page `assets[].objectStoreKey`) and their companions live under
 * `archive/cases/**` keys, so invariants 1-2 are deliberately scoped to the
 * B2-direct object-key layouts (`archive/internet-archive/`, `archive/museum/`)
 * to avoid false positives on the Gallica representation; invariant 3 applies to
 * whatever keys genuinely overlap.
 *
 * Fail-loud, no fabrication (Principle V): a companion file that declares an
 * `object_store:` block but is malformed throws from `@/bibliography/
 * provenance-read` rather than being silently skipped.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CanonicalModel } from '@/bibliography/model';
import { parseAssetProvenance } from '@/bibliography/provenance-read';
import type { ValidationFinding } from '@/bibliography/validate';
import type { RepositoryRecord } from '@/model/repository-record';

/** Object-key prefixes written by the B2-direct adapters (museum + Internet Archive). */
const B2_DIRECT_PREFIXES = ['archive/internet-archive/', 'archive/museum/'];

/** One committed archive companion, indexed by its object-store key. */
export interface CompanionRef {
  /** Lowercase-hex sha256 the companion records for the master bytes. */
  sha256: string;
  /** The companion file path (for locating a drift/orphan finding). */
  path: string;
}

/** Recursively yield every `*.yml` path under `dir` (the archive tree). */
function* walkYmlFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkYmlFiles(full);
    } else if (entry.isFile() && entry.name.endsWith('.yml')) {
      yield full;
    }
  }
}

/**
 * Fail-loud gate (Constitution III): EVERY `type: ocr-text` artifact MUST carry
 * a computed `ocr_quality` block. The OCR pipeline always writes it, but this
 * catches any that slip in without it (a hand-authored sidecar, a legacy
 * artifact, a future code path) -- so a lapse in recording OCR fidelity cannot
 * silently land. Returns one `ocr-quality-missing` finding per offender; empty
 * when the archive tree is absent.
 */
export function validateOcrTextQuality(archiveRoot: string): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const archiveDir = join(archiveRoot, 'archive');
  if (!existsSync(archiveDir)) {
    return findings;
  }
  for (const file of walkYmlFiles(archiveDir)) {
    const text = readFileSync(file, 'utf-8');
    if (!/(^|\n)type: "ocr-text"/.test(text)) {
      continue;
    }
    if (!/(^|\n)ocr_quality:/.test(text)) {
      findings.push({
        kind: 'ocr-quality-missing',
        detail:
          `OCR-text artifact is missing the mandatory ocr_quality block ` +
          `(Constitution III): ${file}`,
        path: file,
      });
    }
  }
  return findings;
}

/**
 * Index every committed companion in the archive repo by its `object_store.key`.
 * Files without an `object_store:` block (non-companion sidecars -- translation
 * text, etc.) are skipped; a companion WITH the block is parsed strictly, so a
 * malformed one throws rather than dropping its key. Empty when the archive tree
 * is absent (the caller decides whether that is tolerable).
 */
export function collectCompanions(archiveRoot: string): Map<string, CompanionRef> {
  const byKey = new Map<string, CompanionRef>();
  const archiveDir = join(archiveRoot, 'archive');
  if (!existsSync(archiveDir)) {
    return byKey;
  }
  for (const file of walkYmlFiles(archiveDir)) {
    const text = readFileSync(file, 'utf-8');
    if (!/(^|\n)object_store:/.test(text)) {
      continue; // not a companion asset record
    }
    const provenance = parseAssetProvenance(text, file);
    if (provenance.object_store !== null) {
      byKey.set(provenance.object_store.key, { sha256: provenance.sha256, path: file });
    }
  }
  return byKey;
}

/** Legacy accessor kept for callers that only need the key set. */
export function collectCompanionObjectKeys(archiveRoot: string): Set<string> {
  return new Set(collectCompanions(archiveRoot).keys());
}

/** `${sourceId} @ ${sourceArchive}` -- the record's locating label. */
function recordLabel(record: RepositoryRecord): string {
  return `${record.sourceId} @ ${record.sourceArchive}`;
}

/** The `{ objectStoreKey, checksum }` of every SSOT object-store master. */
function ssotMasters(model: CanonicalModel): { record: RepositoryRecord; key: string; checksum: string }[] {
  const out: { record: RepositoryRecord; key: string; checksum: string }[] = [];
  for (const record of model.repositoryRecords) {
    for (const asset of record.assets ?? []) {
      if (typeof asset.objectStoreKey === 'string' && asset.objectStoreKey.length > 0) {
        out.push({ record, key: asset.objectStoreKey, checksum: asset.checksum });
      }
    }
  }
  return out;
}

/**
 * THE SANITY CHECK. Reconciles the SSOT object-store masters against the
 * committed archive companions and returns a fail-loud finding for every break.
 */
export function validateArchiveReconciliation(
  model: CanonicalModel,
  companions: ReadonlyMap<string, CompanionRef>,
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const masters = ssotMasters(model);
  const ssotKeys = new Set(masters.map((m) => m.key));

  // 1. undiscoverable-master: an SSOT master with no companion (per record).
  const orphanedByRecord = new Map<RepositoryRecord, string[]>();
  for (const { record, key } of masters) {
    if (!companions.has(key)) {
      const list = orphanedByRecord.get(record) ?? [];
      list.push(key);
      orphanedByRecord.set(record, list);
    }
  }
  for (const [record, keys] of orphanedByRecord) {
    const total = (record.assets ?? []).length;
    findings.push({
      kind: 'undiscoverable-master',
      sourceId: record.sourceId,
      detail:
        `${recordLabel(record)}: ${keys.length} of ${total} object-store master(s) have NO ` +
        `committed archive companion record -- UNDISCOVERABLE by the archive pipeline (the ` +
        `translator, OCR, the browser, and coverage all read companions, not the SSOT asset list). ` +
        `An acquisition mirrored bytes to the object store and recorded them in the SSOT but never ` +
        `wrote the companions. First orphaned key: ${keys[0]}`,
      path: keys[0],
    });
  }

  // 2. orphaned-companion: a B2-direct companion with no SSOT master (a dangling
  //    companion, or a master uploaded + companioned but never recorded).
  for (const [key, ref] of companions) {
    if (!B2_DIRECT_PREFIXES.some((p) => key.startsWith(p))) {
      continue; // Gallica keys live outside the SSOT asset representation
    }
    if (!ssotKeys.has(key)) {
      findings.push({
        kind: 'orphaned-companion',
        detail:
          `Companion "${ref.path}" references object-store key "${key}" that NO SSOT ` +
          `RepositoryRecord asset accounts for -- a dangling companion (its master is in the ` +
          `archive/object store but not recorded in the SSOT).`,
        path: ref.path,
      });
    }
  }

  // 3. checksum-drift: the SSOT and a companion disagree about an object's bytes.
  for (const { record, key, checksum } of masters) {
    const ref = companions.get(key);
    if (ref !== undefined && ref.sha256 !== checksum) {
      findings.push({
        kind: 'checksum-drift',
        sourceId: record.sourceId,
        detail:
          `${recordLabel(record)}: object "${key}" -- the SSOT records sha256 ${checksum} but its ` +
          `companion (${ref.path}) records ${ref.sha256}. The SSOT and the archive disagree about ` +
          `the master bytes; one is stale or corrupt.`,
        path: key,
      });
    }
  }

  return findings;
}

/**
 * Back-compat alias for the first invariant only, used by the check's unit
 * tests. Prefer {@link validateArchiveReconciliation} in the pipeline.
 */
export function validateUndiscoverableMasters(
  model: CanonicalModel,
  companionObjectKeys: ReadonlySet<string>,
): ValidationFinding[] {
  const companions = new Map<string, CompanionRef>(
    [...companionObjectKeys].map((key) => [key, { sha256: '', path: '(key-only)' }]),
  );
  return validateArchiveReconciliation(model, companions).filter(
    (f) => f.kind === 'undiscoverable-master',
  );
}
