/**
 * The **no-orphaned-master contract** (`bib validate`'s `undiscoverable-master`
 * check).
 *
 * THE INVARIANT: every SSOT `RepositoryRecord` asset that was mirrored to the
 * object store (`objectStoreKey`) MUST be referenced by a COMMITTED archive
 * companion record (`archive/**\/*.yml` with a matching `object_store.key`).
 * The archive pipeline -- the translator, OCR, the corpus browser, coverage --
 * discovers and reads masters through the companion records, NOT through the
 * SSOT asset list. So a master present in B2 + the SSOT but absent from the
 * companion layer is **undiscoverable**: bytes exist, but nothing downstream
 * can find them.
 *
 * This is basic record-keeping made mechanical. It exists because an Internet
 * Archive acquisition (spec 013, PB-P055) mirrored 419 masters to B2 and
 * recorded them in the SSOT but never wrote the companions -- leaving the work
 * invisible to the translator. Nothing screamed. Now this does: `bib validate`
 * fails loud, naming the record and the orphaned keys, so an acquisition can
 * never again "succeed" while producing masters no one can find.
 *
 * Fail-loud, no fabrication (Principle V): a companion file that declares an
 * `object_store:` block but is malformed surfaces as a parse throw from
 * `@/bibliography/provenance-read`, not a silent skip.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CanonicalModel } from '@/bibliography/model';
import { parseAssetProvenance } from '@/bibliography/provenance-read';
import type { ValidationFinding } from '@/bibliography/validate';

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
 * Scan the archive repo (`<archiveRoot>/archive/**`) and collect the
 * `object_store.key` of every committed companion that declares one. Files
 * without an `object_store:` block (non-companion sidecars -- translation
 * text, etc.) are skipped; a companion WITH the block is parsed strictly, so a
 * malformed one throws rather than dropping its key. Returns an empty set when
 * the archive tree is absent (the caller decides whether that is tolerable).
 */
export function collectCompanionObjectKeys(archiveRoot: string): Set<string> {
  const keys = new Set<string>();
  const archiveDir = join(archiveRoot, 'archive');
  if (!existsSync(archiveDir)) {
    return keys;
  }
  for (const file of walkYmlFiles(archiveDir)) {
    const text = readFileSync(file, 'utf-8');
    if (!/(^|\n)object_store:/.test(text)) {
      continue; // not a companion asset record
    }
    const provenance = parseAssetProvenance(text, file);
    if (provenance.object_store !== null) {
      keys.add(provenance.object_store.key);
    }
  }
  return keys;
}

/** `${sourceId} @ ${sourceArchive}` -- the record's locating label. */
function recordLabel(sourceId: string, sourceArchive: string): string {
  return `${sourceId} @ ${sourceArchive}`;
}

/**
 * THE CHECK. For every `RepositoryRecord`, each asset with an `objectStoreKey`
 * MUST appear in `companionObjectKeys`. Any that do not are orphaned masters --
 * mirrored to the object store but never given a companion, hence
 * undiscoverable by the archive pipeline. One finding per offending record,
 * naming the count + the first orphaned key.
 */
export function validateUndiscoverableMasters(
  model: CanonicalModel,
  companionObjectKeys: ReadonlySet<string>,
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const record of model.repositoryRecords) {
    const masterKeys = (record.assets ?? [])
      .map((asset) => asset.objectStoreKey)
      .filter((key): key is string => typeof key === 'string' && key.length > 0);
    const orphaned = masterKeys.filter((key) => !companionObjectKeys.has(key));
    if (orphaned.length === 0) {
      continue;
    }
    findings.push({
      kind: 'undiscoverable-master',
      sourceId: record.sourceId,
      detail:
        `${recordLabel(record.sourceId, record.sourceArchive)}: ${orphaned.length} of ` +
        `${masterKeys.length} object-store master(s) have NO committed archive companion record -- ` +
        `these assets are UNDISCOVERABLE by the archive pipeline (the translator, OCR, the browser, ` +
        `and coverage all read companions, not the SSOT asset list). An acquisition mirrored the ` +
        `bytes to the object store and recorded them in the SSOT but never wrote the companions. ` +
        `First orphaned key: ${orphaned[0]}`,
      path: orphaned[0],
    });
  }
  return findings;
}
