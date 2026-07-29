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
 * (b) points at a Source THIS corpus owns, (c) stays inside the archive root
 * AND is of the one resolvable shape `archive/cases/<case>/<type>/<slug>`,
 * and (d) does not collide with another Source's location.
 *
 * CLAUSE (d) MEANS ANOTHER SOURCE'S LOCATION, NOT ANOTHER OVERRIDE (AUDIT-05).
 * Most Sources carry no override and sit at the location the generic rule
 * derives, so a check that only compared overrides to other overrides could
 * not see the common case at all. {@link seedDerivedClaimants} therefore seeds
 * the claimant map with every non-overridden Source's derived location before
 * a single override is walked.
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

/** The one shape an override path may take. */
export const OVERRIDE_PATH_SHAPE = 'archive/cases/<case>/<type>/<slug>';

/** The archive-root-relative prefix every override path must carry. */
const OVERRIDE_PATH_PREFIX = ['archive', 'cases'] as const;
/** `archive` / `cases` / `<case>` / `<type>` / `<slug>`. */
const OVERRIDE_PATH_SEGMENTS = OVERRIDE_PATH_PREFIX.length + 3;

/** The three components an override path encodes. */
export interface OverrideLocation {
  readonly caseId: string;
  readonly type: string;
  readonly slug: string;
}

/**
 * Parse a validated-as-relative override path into its three components, or
 * `null` when it is not of {@link OVERRIDE_PATH_SHAPE}.
 *
 * SINGLE OWNER OF THE SHAPE (AUDIT-05). `@/archive/layout-resolve`'s
 * `layoutFromOverride` used to hold its own copy of this parse and THREW on a
 * malformed path — at RESOLVE time, long after the config gate had passed the
 * manifest. A validator that green-lights a manifest which cannot resolve is
 * the same silent-until-too-late failure as the override-collision gap below,
 * so the shape is now checked here, at validation time, and the resolver
 * consumes this function rather than re-deriving it.
 */
export function parseOverridePath(relativePath: string): OverrideLocation | null {
  const segments = normalizeOverridePath(relativePath).split('/');
  if (segments.length !== OVERRIDE_PATH_SEGMENTS) {
    return null;
  }
  if (!OVERRIDE_PATH_PREFIX.every((expected, index) => segments[index] === expected)) {
    return null;
  }
  if (segments.some((segment) => segment.length === 0)) {
    return null;
  }
  return { caseId: segments[2], type: segments[3], slug: segments[4] };
}

/**
 * Seed the location-claimant map with the GENERICALLY DERIVED location of
 * every Source that does NOT carry an override (AUDIT-05).
 *
 * THE BUG THIS CLOSES. `claimants` used to be populated exclusively from
 * override `relativePath`s, so the only collision it could ever see was
 * override-vs-override. But this file's own header states that an override
 * must prove it "(d) does not collide with another Source's location" — and
 * the overwhelming majority of Sources have no override at all, sitting
 * instead at the location the generic rule derives. An override aimed
 * squarely at one of those was reported as clean.
 *
 * Sources that DO carry an override are excluded: their location is the
 * override, not the derivation, so seeding the derivation as well would
 * manufacture a phantom claim on a directory nothing writes to.
 *
 * A Source with no `genericLocation` contributes nothing, and that is not a
 * silent skip: `undefined` there means either "declares no case" (already
 * reported as `source-missing-case`) or "is a source-group container", which
 * has no archive location by design.
 */
function seedDerivedClaimants(
  entries: readonly SourceIdentity[],
  overridden: ReadonlySet<string>,
  claimants: Map<string, string[]>,
): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    // A duplicated sourceId is its own finding (`duplicate-source-id`); it
    // must not also present as two Sources colliding on one location.
    if (seen.has(entry.sourceId) || overridden.has(entry.sourceId)) {
      continue;
    }
    seen.add(entry.sourceId);
    if (entry.genericLocation === undefined) {
      continue;
    }
    const subject = `${entry.sourceId} (generic layout)`;
    const existing = claimants.get(entry.genericLocation);
    if (existing === undefined) {
      claimants.set(entry.genericLocation, [subject]);
    } else {
      existing.push(subject);
    }
  }
}

/** Every Source ID any manifest declares an override for. */
function overriddenSourceIds(manifests: readonly CorpusManifest[]): Set<string> {
  const ids = new Set<string>();
  for (const manifest of manifests) {
    if (manifest.archiveLayoutOverrides === null) {
      continue;
    }
    for (const sourceId of Object.keys(manifest.archiveLayoutOverrides)) {
      ids.add(sourceId);
    }
  }
  return ids;
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
  /**
   * normalized location -> everything claiming it: `<corpus>/<sourceId>` for
   * an override, `<sourceId> (generic layout)` for a rule-derived location.
   */
  const claimants = new Map<string, string[]>();
  seedDerivedClaimants(entries, overriddenSourceIds(manifests), claimants);

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

      // The SHAPE, checked here rather than left to blow up inside
      // `@/archive/layout-resolve`'s `layoutFromOverride` at resolve time.
      if (parseOverridePath(relativePath) === null) {
        findings.push(
          finding(
            'override-path-malformed',
            subject,
            `archiveLayoutOverride relativePath ${JSON.stringify(relativePath)} for Source ` +
              `${JSON.stringify(sourceId)} is not of the required form ` +
              `${JSON.stringify(OVERRIDE_PATH_SHAPE)}; every consumer of a resolved layout ` +
              'builds <archiveRoot>/archive/cases/<case>/<type>/<slug>, so a path of any other ' +
              'shape cannot be resolved at all',
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
