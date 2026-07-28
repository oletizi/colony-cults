import type { BrowserProfile } from '@/corpus/browser-profile';
import type { CorpusManifest } from '@/corpus/manifest';
import { finding, type CorpusValidationFinding } from '@/corpus/validate-types';

/**
 * Corpus config seam — the REPOSITORY-WIDE validation rules: the ones that
 * can only be decided by looking at ALL committed manifests and profiles at
 * once (data-model.md § Validation rules → "Repository-wide"; FR-002a,
 * FR-008; INV-7, INV-11).
 *
 * Per-manifest structure is NOT re-checked here — `loadCorpusManifest` and
 * `loadBrowserProfile` already own it, and duplicating those rules would let
 * the two copies drift. The orchestrator (`@/corpus/validate`) loads through
 * those loaders and turns their throws into findings before calling in here,
 * so everything reaching these functions is already structurally valid.
 *
 * These functions are PURE: manifests and profiles in, findings out, no I/O.
 * That keeps every repository-wide invariant testable against constructed
 * inputs — including `duplicate-corpus-id`, which the filesystem enumeration
 * path cannot currently produce (see {@link validateUniqueCorpusIds}).
 */

/** A loaded browser profile plus the file it came from, for locating errors. */
export interface LoadedBrowserProfile {
  readonly profile: BrowserProfile;
  readonly filePath: string;
}

/**
 * Two manifests declaring the same corpus id.
 *
 * NOTE ON REACHABILITY: via `listCorpusManifests` this cannot currently fire.
 * Manifest ids are derived from filenames in a single directory (so they are
 * unique by construction) and `loadCorpusManifest` additionally enforces
 * `id == basename`. The check is kept because uniqueness of corpus ids is a
 * stated invariant (data-model.md) rather than an accident of the current
 * enumeration strategy: if manifests are ever gathered from more than one
 * directory, or the basename rule is relaxed, this becomes the rule that
 * catches it. It is exercised directly by unit test rather than by fixture.
 */
export function validateUniqueCorpusIds(
  manifests: readonly CorpusManifest[],
): CorpusValidationFinding[] {
  const byId = new Map<string, number>();
  for (const manifest of manifests) {
    byId.set(manifest.id, (byId.get(manifest.id) ?? 0) + 1);
  }

  const findings: CorpusValidationFinding[] = [];
  for (const [id, count] of byId) {
    if (count > 1) {
      findings.push(
        finding(
          'duplicate-corpus-id',
          id,
          `${count} committed manifests declare the corpus id ${JSON.stringify(id)}; ` +
            'corpus ids must be unique across the repository',
        ),
      );
    }
  }
  return findings;
}

/**
 * Source-ID namespace disjointness (FR-002a) — the real invariant.
 *
 * No configured prefix may EQUAL, or be a LEADING SUBSTRING of, another
 * configured prefix. There is deliberately NO trailing-delimiter rule: the
 * shipped Port Breton namespace is literally `PB-P` + a 3-digit pad
 * (`PB-P007`), so requiring a trailing delimiter would make the existing
 * namespace inexpressible and FR-010 (IDs unchanged) unsatisfiable. The
 * leading-substring rule is sufficient on its own — if neither prefix
 * prefixes the other, no id string can belong to both namespaces.
 */
export function validatePrefixDisjointness(
  manifests: readonly CorpusManifest[],
): CorpusValidationFinding[] {
  const findings: CorpusValidationFinding[] = [];

  for (let i = 0; i < manifests.length; i++) {
    for (let j = i + 1; j < manifests.length; j++) {
      const left = manifests[i];
      const right = manifests[j];
      const leftPrefix = left.sourceIds.prefix;
      const rightPrefix = right.sourceIds.prefix;
      const subject = `${left.id}/${right.id}`;

      if (leftPrefix === rightPrefix) {
        findings.push(
          finding(
            'prefix-not-disjoint',
            subject,
            `corpus ${JSON.stringify(left.id)} and corpus ${JSON.stringify(right.id)} both ` +
              `configure the source-ID prefix ${JSON.stringify(leftPrefix)}; ` +
              'namespaces must be provably disjoint (FR-002a)',
          ),
        );
        continue;
      }

      const contained = rightPrefix.startsWith(leftPrefix)
        ? { outer: right, outerPrefix: rightPrefix, inner: left, innerPrefix: leftPrefix }
        : leftPrefix.startsWith(rightPrefix)
          ? { outer: left, outerPrefix: leftPrefix, inner: right, innerPrefix: rightPrefix }
          : undefined;

      if (contained !== undefined) {
        findings.push(
          finding(
            'prefix-not-disjoint',
            subject,
            `source-ID prefix ${JSON.stringify(contained.innerPrefix)} (corpus ` +
              `${JSON.stringify(contained.inner.id)}) is a leading substring of prefix ` +
              `${JSON.stringify(contained.outerPrefix)} (corpus ` +
              `${JSON.stringify(contained.outer.id)}); namespaces must be provably ` +
              'disjoint (FR-002a)',
          ),
        );
      }
    }
  }

  return findings;
}

/**
 * Case ids are unique ACROSS manifests (FR-002). Within-manifest duplicates
 * are already rejected by `loadCorpusManifest`; a case id appearing in two
 * manifests would make "which Corpus owns this Source" ambiguous, which the
 * existing-data rules depend on being a function.
 */
export function validateUniqueCaseIds(
  manifests: readonly CorpusManifest[],
): CorpusValidationFinding[] {
  const owners = new Map<string, string[]>();
  for (const manifest of manifests) {
    for (const caseId of manifest.cases) {
      const existing = owners.get(caseId);
      if (existing === undefined) {
        owners.set(caseId, [manifest.id]);
      } else {
        existing.push(manifest.id);
      }
    }
  }

  const findings: CorpusValidationFinding[] = [];
  for (const [caseId, corpusIds] of owners) {
    if (corpusIds.length > 1) {
      findings.push(
        finding(
          'duplicate-case-id',
          caseId,
          `case id ${JSON.stringify(caseId)} is declared by ${corpusIds.length} corpora ` +
            `(${corpusIds.map((id) => JSON.stringify(id)).join(', ')}); ` +
            'case ids must be unique across the repository',
        ),
      );
    }
  }
  return findings;
}

/**
 * Browser-profile references (FR-005/FR-008, INV-11): every profile's
 * `corpus` must name a committed manifest, and no two profiles may declare
 * the same `id`. A profile's `id` is deliberately NOT tied to its filename
 * (see `@/corpus/browser-profile`), which is exactly why cross-profile id
 * uniqueness has to be checked here.
 */
export function validateBrowserProfiles(
  manifests: readonly CorpusManifest[],
  profiles: readonly LoadedBrowserProfile[],
): CorpusValidationFinding[] {
  const knownCorpora = new Set(manifests.map((manifest) => manifest.id));
  const findings: CorpusValidationFinding[] = [];

  for (const { profile, filePath } of profiles) {
    if (!knownCorpora.has(profile.corpus)) {
      const known = [...knownCorpora].sort();
      findings.push(
        finding(
          'profile-unknown-corpus',
          profile.id,
          `browser profile ${JSON.stringify(profile.id)} (${filePath}) references corpus ` +
            `${JSON.stringify(profile.corpus)}, which has no committed manifest; ` +
            `known corpora: ${known.length === 0 ? '(none)' : known.join(', ')}`,
        ),
      );
    }
  }

  const byProfileId = new Map<string, string[]>();
  for (const { profile, filePath } of profiles) {
    const existing = byProfileId.get(profile.id);
    if (existing === undefined) {
      byProfileId.set(profile.id, [filePath]);
    } else {
      existing.push(filePath);
    }
  }

  for (const [profileId, filePaths] of byProfileId) {
    if (filePaths.length > 1) {
      findings.push(
        finding(
          'duplicate-profile-id',
          profileId,
          `${filePaths.length} browser profiles declare the id ${JSON.stringify(profileId)} ` +
            `(${filePaths.join(', ')}); profile ids must be unique across profiles`,
        ),
      );
    }
  }

  return findings;
}

/** Run every repository-wide rule, in a stable order. */
export function validateRepositoryWide(
  manifests: readonly CorpusManifest[],
  profiles: readonly LoadedBrowserProfile[],
): CorpusValidationFinding[] {
  return [
    ...validateUniqueCorpusIds(manifests),
    ...validatePrefixDisjointness(manifests),
    ...validateUniqueCaseIds(manifests),
    ...validateBrowserProfiles(manifests, profiles),
  ];
}
