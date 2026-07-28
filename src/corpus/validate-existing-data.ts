import { basename } from 'node:path';

import type { CorpusManifest, CorpusSourceIdPolicy } from '@/corpus/manifest';
import type { SourceIdentity, SourceIdentityIndex } from '@/corpus/source-index';
import { finding, type CorpusValidationFinding } from '@/corpus/validate-types';

/**
 * Corpus config seam — EXISTING-DATA validation (FR-002a, INV-12):
 * the rules that check committed config against the Sources that actually
 * exist, rather than against config alone.
 *
 * Config can be internally consistent and still be wrong about reality: a
 * corpus can declare a namespace its own Sources do not sit in, two SSOT
 * files can claim one id, or the next id a corpus would allocate can already
 * be taken. Those are the failures that corrupt the archive, so they are
 * checked against `@/corpus/source-index`'s global identity index.
 *
 * ON GRANDFATHERING — A SPEC GAP THAT FR-002b CLOSED
 *
 * FR-002a and INV-12 both qualify Source conformance with "unless explicitly
 * grandfathered", but NO grandfathering mechanism is defined anywhere in the
 * spec: there is no manifest field for it, and no rule describing how a
 * Source would be marked. This module therefore implements STRICT
 * conformance with no exemption path, and no bypass flag.
 *
 * The case that appeared to need one — Port Breton's hand-authored `PB-S001`
 * / `PB-S002` sitting beside 92 machine-allocated `PB-P###` records — is
 * resolved instead by FR-002b: a corpus declares a LIST of ID policies and a
 * Source conforms if it matches ANY of them. That is a modeling fix, not an
 * exemption, so the rule below stays absolute. If real committed data fails
 * it, the strict policy (FR-015) blocks the whole repository — the intended
 * forcing function, and an operator decision to make explicitly.
 *
 * These functions are PURE: manifests + identity index in, findings out.
 */

/**
 * Does `sourceId` sit in `policy`'s namespace — exactly `prefix` followed by
 * exactly `padWidth` digits?
 */
export function conformsToIdPolicy(sourceId: string, policy: CorpusSourceIdPolicy): boolean {
  if (!sourceId.startsWith(policy.prefix)) {
    return false;
  }
  const suffix = sourceId.slice(policy.prefix.length);
  return suffix.length === policy.padWidth && /^\d+$/.test(suffix);
}

/**
 * Does `sourceId` conform to ANY of a corpus's ID policies (FR-002b)?
 *
 * "Any", not "the one", is the whole substance of FR-002b: one corpus
 * legitimately carries more than one namespace, so `PB-S001` conforms via
 * Port Breton's second, non-allocatable policy even though nothing will ever
 * be allocated into it.
 */
export function conformsToAnyIdPolicy(
  sourceId: string,
  policies: readonly CorpusSourceIdPolicy[],
): boolean {
  return policies.some((policy) => conformsToIdPolicy(sourceId, policy));
}

/**
 * The ONE policy new IDs are allocated from (FR-002b).
 *
 * `loadCorpusManifest` rejects any manifest whose allocatable count is not
 * exactly one, so reaching this with a different count means a manifest was
 * constructed in code without going through the loader. That is a
 * programming error, and it throws rather than picking a policy: silently
 * choosing "the first allocatable one" would decide where the next Source ID
 * lands, which is precisely the ambiguity FR-002b exists to forbid.
 */
function allocatablePolicy(manifest: CorpusManifest): CorpusSourceIdPolicy {
  const allocatable = manifest.sourceIds.filter((policy) => policy.allocatable);
  if (allocatable.length !== 1) {
    throw new Error(
      `validateExistingData: corpus ${JSON.stringify(manifest.id)} declares ` +
        `${allocatable.length} allocatable source-ID policies; exactly one is required ` +
        '(FR-002b). A manifest in this state did not come through loadCorpusManifest, ' +
        'which enforces the invariant.',
    );
  }
  return allocatable[0];
}

/** Render a corpus's policies for an error message, naming each namespace. */
function describePolicies(policies: readonly CorpusSourceIdPolicy[]): string {
  return policies
    .map(
      (policy) =>
        `prefix ${JSON.stringify(policy.prefix)} + padWidth ${policy.padWidth}` +
        `${policy.allocatable ? ' (allocatable)' : ''} (e.g. ${formatId(1, policy)})`,
    )
    .join('; ');
}

/**
 * The numeric suffix of `sourceId` within `prefix`'s namespace, or `null`
 * when it is not in that namespace at all.
 *
 * Deliberately accepts ANY digit count, not just `padWidth` — this mirrors
 * `@/sourcegroup/id-alloc`'s `^PB-P(\d+)\.yml$` scan, so the next-id
 * computation here predicts the same id the allocator would actually pick.
 */
function namespaceSuffix(sourceId: string, prefix: string): number | null {
  if (!sourceId.startsWith(prefix)) {
    return null;
  }
  const suffix = sourceId.slice(prefix.length);
  if (suffix.length === 0 || !/^\d+$/.test(suffix)) {
    return null;
  }
  const parsed = Number.parseInt(suffix, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Format `n` as an id in `policy`'s namespace (`4` -> `AL004`). */
function formatId(n: number, policy: CorpusSourceIdPolicy): string {
  return `${policy.prefix}${String(n).padStart(policy.padWidth, '0')}`;
}

/** Every SSOT file that could not yield an identity is its own finding. */
function identityProblemFindings(index: SourceIdentityIndex): CorpusValidationFinding[] {
  return index.problems.map((problem) =>
    finding('source-identity-unreadable', basename(problem.filePath), problem.message),
  );
}

/** Source IDs are globally unique across all corpora (FR-002). */
function duplicateSourceIdFindings(
  entries: readonly SourceIdentity[],
): CorpusValidationFinding[] {
  const filesById = new Map<string, string[]>();
  for (const entry of entries) {
    const existing = filesById.get(entry.sourceId);
    if (existing === undefined) {
      filesById.set(entry.sourceId, [entry.filePath]);
    } else {
      existing.push(entry.filePath);
    }
  }

  const findings: CorpusValidationFinding[] = [];
  for (const [sourceId, filePaths] of filesById) {
    if (filePaths.length > 1) {
      findings.push(
        finding(
          'duplicate-source-id',
          sourceId,
          `${filePaths.length} SSOT records declare the Source ID ${JSON.stringify(sourceId)} ` +
            `(${filePaths.join(', ')}); Source IDs must be globally unique`,
        ),
      );
    }
  }
  return findings;
}

/**
 * Every Source belongs to exactly one Case, that Case belongs to exactly one
 * committed Corpus, and the Source's ID conforms to at least ONE of that
 * Corpus's ID policies (FR-002b).
 *
 * A Source whose Case no manifest declares is a finding rather than a skip:
 * its owning Corpus — and therefore its ID policy — is undeterminable, and
 * quietly not evaluating a rule is indistinguishable from the rule passing.
 */
function conformanceFindings(
  manifests: readonly CorpusManifest[],
  entries: readonly SourceIdentity[],
): CorpusValidationFinding[] {
  const corpusByCase = new Map<string, CorpusManifest>();
  for (const manifest of manifests) {
    for (const caseId of manifest.cases) {
      if (!corpusByCase.has(caseId)) {
        corpusByCase.set(caseId, manifest);
      }
    }
  }

  const findings: CorpusValidationFinding[] = [];

  for (const entry of entries) {
    if (entry.caseId === undefined) {
      findings.push(
        finding(
          'source-missing-case',
          entry.sourceId,
          `Source ${JSON.stringify(entry.sourceId)} (${entry.filePath}) declares no "case"; ` +
            'every Source is in exactly one Case (FR-002)',
        ),
      );
      continue;
    }

    const owner = corpusByCase.get(entry.caseId);
    if (owner === undefined) {
      const known = [...corpusByCase.keys()].sort();
      findings.push(
        finding(
          'source-case-not-in-any-corpus',
          entry.sourceId,
          `Source ${JSON.stringify(entry.sourceId)} is in case ${JSON.stringify(entry.caseId)}, ` +
            'which no committed manifest declares, so its ID policy cannot be determined; ' +
            `known cases: ${known.length === 0 ? '(none)' : known.join(', ')}`,
        ),
      );
      continue;
    }

    if (!conformsToAnyIdPolicy(entry.sourceId, owner.sourceIds)) {
      findings.push(
        finding(
          'source-id-nonconforming',
          entry.sourceId,
          `Source ${JSON.stringify(entry.sourceId)} is in case ${JSON.stringify(entry.caseId)}, ` +
            `owned by corpus ${JSON.stringify(owner.id)}; the id conforms to NONE of that ` +
            `corpus's ${owner.sourceIds.length} ID ` +
            `${owner.sourceIds.length === 1 ? 'policy' : 'policies'}, all of which were tried: ` +
            `${describePolicies(owner.sourceIds)}`,
        ),
      );
    }
  }

  return findings;
}

/**
 * The next id each corpus would allocate must be free (FR-002a/FR-002b).
 *
 * The next id is drawn from the corpus's ONE ALLOCATABLE policy — the other
 * policies are conformance-only namespaces for hand-authored records and
 * nothing is ever allocated into them. It is predicted the way the allocator
 * picks it (highest numeric suffix already used in the ALLOCATABLE namespace
 * by a Source THIS CORPUS owns, plus one) and then checked against every
 * existing id and every OTHER corpus's namespaces — every policy of each, not
 * one per corpus.
 *
 * KNOWN GAP, not silently handled: when the highest used suffix reaches
 * `10^padWidth - 1`, the next id overflows its own pad width
 * (`padWidth` 3, max 999 -> `AL1000`) and stops conforming to the corpus's
 * own policy. The spec defines no rule for namespace exhaustion, so no
 * finding is invented for it here; it is recorded so the next reader sees
 * the hole rather than assuming it was considered and dismissed.
 */
function nextIdFindings(
  manifests: readonly CorpusManifest[],
  entries: readonly SourceIdentity[],
): CorpusValidationFinding[] {
  const allIds = new Set(entries.map((entry) => entry.sourceId));
  const findings: CorpusValidationFinding[] = [];

  for (const manifest of manifests) {
    const policy = allocatablePolicy(manifest);
    const ownCases = new Set(manifest.cases);
    let max = 0;
    for (const entry of entries) {
      if (entry.caseId === undefined || !ownCases.has(entry.caseId)) {
        continue;
      }
      const suffix = namespaceSuffix(entry.sourceId, policy.prefix);
      if (suffix !== null && suffix > max) {
        max = suffix;
      }
    }

    const nextId = formatId(max + 1, policy);

    if (allIds.has(nextId)) {
      const holder = entries.find((entry) => entry.sourceId === nextId);
      findings.push(
        finding(
          'next-source-id-collision',
          manifest.id,
          `the next allocated Source ID for corpus ${JSON.stringify(manifest.id)} is ` +
            `${JSON.stringify(nextId)}, but that Source ID already exists ` +
            `(${holder?.filePath ?? 'unknown file'}` +
            `${holder?.caseId === undefined ? '' : `, case ${JSON.stringify(holder.caseId)}`})`,
        ),
      );
    }

    for (const other of manifests) {
      if (other.id === manifest.id) {
        continue;
      }
      for (const otherPolicy of other.sourceIds) {
        if (nextId.startsWith(otherPolicy.prefix)) {
          findings.push(
            finding(
              'next-source-id-collision',
              manifest.id,
              `the next allocated Source ID for corpus ${JSON.stringify(manifest.id)} is ` +
                `${JSON.stringify(nextId)}, which falls inside corpus ` +
                `${JSON.stringify(other.id)}'s namespace ` +
                `(prefix ${JSON.stringify(otherPolicy.prefix)})`,
            ),
          );
        }
      }
    }
  }

  return findings;
}

/** Run every existing-data rule, in a stable order. */
export function validateExistingData(
  manifests: readonly CorpusManifest[],
  index: SourceIdentityIndex,
): CorpusValidationFinding[] {
  return [
    ...identityProblemFindings(index),
    ...duplicateSourceIdFindings(index.entries),
    ...conformanceFindings(manifests, index.entries),
    ...nextIdFindings(manifests, index.entries),
  ];
}
