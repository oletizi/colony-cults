import { isAbsolute, posix } from 'node:path';

import type { CorpusManifest } from '@/corpus/manifest';
import type { SourceIdentity } from '@/corpus/source-index';
import { finding, type CorpusValidationFinding } from '@/corpus/validate-types';

/**
 * Corpus config seam — validation of manifest `archiveLayoutOverrides`
 * (FR-007, INV-10).
 *
 * An override is the escape hatch for a legacy archive path the generic
 * layout rule cannot reproduce. Because it is an escape hatch, it is the
 * most dangerous field in the manifest: it names a filesystem location by
 * hand. Every one must therefore prove that it (a) points at a real Source,
 * (b) points at a Source THIS corpus owns, (c) stays inside the archive
 * root, and (d) does not collide with another Source's location.
 *
 * ON THE `reason` REQUIREMENT (FR-007's fourth clause): it is enforced, but
 * NOT here. `loadCorpusManifest` already rejects an override whose `reason`
 * is absent, non-string, or blank, so by the time an override reaches this
 * module it is guaranteed to carry a non-empty reason. Re-checking it here
 * would be unreachable code that reads like a second, drift-prone source of
 * truth. A manifest with a reason-less override surfaces from the validator
 * as a `manifest-unreadable` finding quoting the loader's message.
 *
 * These functions are PURE: manifests + the identity index in, findings out.
 */

/** `true` when `relativePath` is not archive-root-relative. */
function isNotRelative(relativePath: string): boolean {
  // The POSIX-absolute and platform-absolute checks are both wanted: a
  // committed manifest may have been authored anywhere, and a Windows-style
  // drive path would slip past a POSIX-only `isAbsolute`.
  return isAbsolute(relativePath) || relativePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(relativePath);
}

/**
 * Normalize an override path to the canonical form used for collision
 * detection (`a/./b` and `a/b` are one location).
 */
export function normalizeOverridePath(relativePath: string): string {
  const normalized = posix.normalize(relativePath.replace(/\\/g, '/'));
  return normalized.endsWith('/') && normalized.length > 1
    ? normalized.slice(0, -1)
    : normalized;
}

/** `true` when the normalized path traverses out of the archive root. */
function escapesArchiveRoot(relativePath: string): boolean {
  const normalized = normalizeOverridePath(relativePath);
  return normalized === '..' || normalized.startsWith('../');
}

/**
 * Validate every override across every manifest.
 *
 * `entries` is the global source identity index (`@/corpus/source-index`) —
 * overrides are checked against REAL Sources, never against a list of ids
 * re-derived from the manifest, because the point of the rule is to catch a
 * manifest that has drifted from the SSOT.
 */
export function validateArchiveOverrides(
  manifests: readonly CorpusManifest[],
  entries: readonly SourceIdentity[],
): CorpusValidationFinding[] {
  const caseBySourceId = new Map<string, string | undefined>();
  for (const entry of entries) {
    if (!caseBySourceId.has(entry.sourceId)) {
      caseBySourceId.set(entry.sourceId, entry.caseId);
    }
  }

  const findings: CorpusValidationFinding[] = [];
  /** normalized location -> the `<corpus>/<sourceId>` overrides claiming it. */
  const claimants = new Map<string, string[]>();

  for (const manifest of manifests) {
    if (manifest.archiveLayoutOverrides === null) {
      continue;
    }
    const ownCases = new Set(manifest.cases);

    for (const [sourceId, override] of Object.entries(manifest.archiveLayoutOverrides)) {
      const subject = `${manifest.id}/${sourceId}`;

      if (!caseBySourceId.has(sourceId)) {
        findings.push(
          finding(
            'override-unknown-source',
            subject,
            `corpus ${JSON.stringify(manifest.id)} declares an archiveLayoutOverride for ` +
              `${JSON.stringify(sourceId)}, but no such Source exists in the bibliography SSOT`,
          ),
        );
      } else {
        const caseId = caseBySourceId.get(sourceId);
        if (caseId === undefined) {
          findings.push(
            finding(
              'override-source-not-in-corpus',
              subject,
              `corpus ${JSON.stringify(manifest.id)} declares an archiveLayoutOverride for ` +
                `Source ${JSON.stringify(sourceId)}, which declares no case and so belongs ` +
                'to no Corpus',
            ),
          );
        } else if (!ownCases.has(caseId)) {
          findings.push(
            finding(
              'override-source-not-in-corpus',
              subject,
              `corpus ${JSON.stringify(manifest.id)} declares an archiveLayoutOverride for ` +
                `Source ${JSON.stringify(sourceId)}, which is in case ${JSON.stringify(caseId)} ` +
                `— not one of corpus ${JSON.stringify(manifest.id)}'s cases ` +
                `(${manifest.cases.map((c) => JSON.stringify(c)).join(', ')})`,
            ),
          );
        }
      }

      const { relativePath } = override;

      if (isNotRelative(relativePath)) {
        findings.push(
          finding(
            'override-path-not-relative',
            subject,
            `archiveLayoutOverride relativePath ${JSON.stringify(relativePath)} for Source ` +
              `${JSON.stringify(sourceId)} must be relative to the archive root, not absolute`,
          ),
        );
        continue;
      }

      if (escapesArchiveRoot(relativePath)) {
        findings.push(
          finding(
            'override-path-escapes-archive-root',
            subject,
            `archiveLayoutOverride relativePath ${JSON.stringify(relativePath)} for Source ` +
              `${JSON.stringify(sourceId)} escapes the archive root via ".." traversal`,
          ),
        );
        continue;
      }

      const location = normalizeOverridePath(relativePath);
      const existing = claimants.get(location);
      if (existing === undefined) {
        claimants.set(location, [subject]);
      } else {
        existing.push(subject);
      }
    }
  }

  for (const [location, subjects] of claimants) {
    if (subjects.length > 1) {
      findings.push(
        finding(
          'override-duplicate-location',
          location,
          `${subjects.length} Sources resolve to the same archive location ` +
            `${JSON.stringify(location)} (${subjects.join(', ')}); ` +
            'two Sources must never share one location',
        ),
      );
    }
  }

  return findings;
}
