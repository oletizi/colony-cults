import type { BrowserProfile } from '@/corpus/browser-profile';
import type { CorpusManifest, CorpusSourceIdPolicy } from '@/corpus/manifest';
import type { SourceIdentity } from '@/corpus/source-index';
import { conformsToAnyIdPolicy, describePolicies } from '@/corpus/validate-existing-data';
import { finding, type CorpusValidationFinding } from '@/corpus/validate-types';

/**
 * Corpus config seam — the BROWSER-DEFAULTS validation rules (FR-005;
 * AUDIT-10, AUDIT-20).
 *
 * WHY THIS MODULE EXISTS AS ITS OWN FAMILY
 *
 * A browser profile was previously checked in only two ways: that its `corpus`
 * named SOME committed manifest, and that its `id` was unique across profiles
 * (`@/corpus/validate-repository`'s `validateBrowserProfiles`). Everything
 * about the DEFAULTS themselves stopped at the loader's type check
 * ("`defaultSources` is an array of non-empty strings"). So the one surface
 * whose entire job is handing a list of Source IDs to a browser build applied
 * NO cross-check between that list and the corpus it belongs to. The three
 * rules here are that missing cross-check:
 *
 *   1. {@link validateProfileCorpusFilenames}       — AUDIT-20
 *   2. {@link validateProfileDefaultSourceConformance} — AUDIT-10 (config-only)
 *   3. {@link validateProfileDefaultSourcesExist}   — AUDIT-10 (needs the SSOT)
 *
 * THE 1/2-vs-3 SPLIT IS THE FR-010 SPLIT, not an accident of layout. Rules 1
 * and 2 are decidable from the CONFIG ALONE (manifests + profiles), so they run
 * in `validateCorporaConfig` and therefore on EVERY corpus-dependent
 * invocation. Rule 3 needs `@/corpus/source-index`'s global identity index —
 * a read of every `*.yml` under the sources dir — so it belongs to the FULL
 * sweep only, for exactly the reasons `@/cli/startup-validation` documents: a
 * DATA defect must fail the commands that read that data, not all of them.
 * That is why rule 3 takes the index entries as a parameter rather than this
 * module reading anything.
 *
 * These functions are PURE: config (and, for rule 3, identity entries) in,
 * findings out, no I/O.
 */

/**
 * A loaded browser profile plus the file it came from.
 *
 * `fileId` is the `<stem>` of `<stem>.browser.yml` — i.e. the corpus whose
 * FILE this is, per the one convention `@/corpus/browser-profile` owns. It is
 * carried EXPLICITLY by the producer rather than re-derived by parsing
 * `filePath` here: the producer already has it in hand (it is the id it passed
 * to `loadBrowserProfile`), and re-deriving it would put a second, drifting
 * copy of the filename convention in a validator. Without it,
 * {@link validateProfileCorpusFilenames} has nothing to compare `corpus`
 * against — which is precisely how AUDIT-20 stayed invisible.
 */
export interface LoadedBrowserProfile {
  readonly profile: BrowserProfile;
  readonly fileId: string;
  readonly filePath: string;
}

/**
 * A profile's `corpus` must be the corpus whose FILE it is (AUDIT-20).
 *
 * `loadBrowserProfile(corporaRoot, id)` resolves
 * `<corporaRoot>/<id>.browser.yml`, so the FILENAME is what decides which
 * corpus receives these defaults — `deriveBrowserProfile` looks the profile up
 * by `corpus.manifest.id` and never consults the `corpus:` field at all. The
 * field is therefore a CLAIM about ownership that nothing was checking, and
 * the two can disagree with no symptom: copy `X.browser.yml` to
 * `Y.browser.yml` and corpus Y silently ships corpus X's default source list.
 *
 * `profile-unknown-corpus` is structurally unable to catch this, because the
 * claimed corpus is normally a real committed one — that is what makes the
 * copied file look valid.
 *
 * The rule is stated as agreement with the STEM rather than as "`corpus` names
 * a known manifest AND that manifest is this file's" so it stays decidable
 * without the manifest list: a mismatch is wrong whether or not the claimed
 * corpus exists, and reporting it does not depend on another rule's inputs.
 */
export function validateProfileCorpusFilenames(
  profiles: readonly LoadedBrowserProfile[],
): CorpusValidationFinding[] {
  const findings: CorpusValidationFinding[] = [];

  for (const { profile, fileId, filePath } of profiles) {
    if (profile.corpus !== fileId) {
      findings.push(
        finding(
          'profile-corpus-filename-mismatch',
          fileId,
          `browser profile ${JSON.stringify(filePath)} declares ` +
            `corpus ${JSON.stringify(profile.corpus)}, but the file is ` +
            `${JSON.stringify(`${fileId}.browser.yml`)}, so it IS corpus ` +
            `${JSON.stringify(fileId)}'s profile — the loader keys on the filename, not on ` +
            `this field. Corpus ${JSON.stringify(fileId)} would ship corpus ` +
            `${JSON.stringify(profile.corpus)}'s defaults`,
        ),
      );
    }
  }

  return findings;
}

/**
 * Index the manifests by corpus id, first declaration winning.
 *
 * A duplicate id is `duplicate-corpus-id`'s finding, not this family's, so it
 * is neither re-reported nor allowed to change which policies a profile is
 * judged against.
 */
function manifestsById(manifests: readonly CorpusManifest[]): Map<string, CorpusManifest> {
  const byId = new Map<string, CorpusManifest>();
  for (const manifest of manifests) {
    if (!byId.has(manifest.id)) {
      byId.set(manifest.id, manifest);
    }
  }
  return byId;
}

/**
 * Every `defaultSources` id conforms to at least ONE of its corpus's
 * `sourceIds` policies (FR-002b, AUDIT-10) — config-only.
 *
 * The loader accepted any non-empty string, so a profile could list ids the
 * corpus could never allocate: another corpus's namespace (a stale copied
 * list), a wrong pad width, or an outright typo. Every one of those produces a
 * browser build whose default set is silently wrong rather than empty-and-loud.
 *
 * A profile whose `corpus` names no committed manifest is SKIPPED here, not
 * silently passed: its ID policies are undeterminable, and
 * `profile-unknown-corpus` has already reported the reason. This mirrors
 * `@/corpus/validate-existing-data`'s `conformanceFindings`, which skips a
 * Source whose Case no manifest declares for the same reason.
 *
 * Conformance is judged against the corpus the profile CLAIMS (`profile.corpus`)
 * rather than against its filename stem. When the two disagree that is
 * {@link validateProfileCorpusFilenames}'s finding; judging the ids against the
 * claim keeps the two rules independent, so a mismatch does not also produce a
 * cascade of conformance findings whose real cause is the mismatch.
 */
export function validateProfileDefaultSourceConformance(
  manifests: readonly CorpusManifest[],
  profiles: readonly LoadedBrowserProfile[],
): CorpusValidationFinding[] {
  const byId = manifestsById(manifests);
  const findings: CorpusValidationFinding[] = [];

  for (const { profile, filePath } of profiles) {
    const owner = byId.get(profile.corpus);
    if (owner === undefined) {
      continue;
    }

    for (const sourceId of nonconformingSourceIds(profile.defaultSources, owner.sourceIds)) {
      findings.push(
        finding(
          'profile-default-source-nonconforming',
          `${profile.id}/${sourceId}`,
          `browser profile ${JSON.stringify(profile.id)} (${filePath}) lists default Source ` +
            `${JSON.stringify(sourceId)} for corpus ${JSON.stringify(owner.id)}; the id ` +
            `conforms to NONE of that corpus's ${owner.sourceIds.length} ID ` +
            `${owner.sourceIds.length === 1 ? 'policy' : 'policies'}, all of which were tried: ` +
            `${describePolicies(owner.sourceIds)}`,
        ),
      );
    }
  }

  return findings;
}

/**
 * The `defaultSources` ids that conform to none of `policies` (FR-002b), in
 * the order the profile lists them.
 *
 * The ONE implementation of "which of these ids could this corpus never own",
 * shared by this module's config-only rule and by `@/corpus/policies`'
 * `deriveBrowserProfile` (which applies the same check at derivation time, to
 * the `CORPUS_SOURCES` override as well as to the file). Both go through
 * `@/corpus/validate-existing-data`'s `conformsToAnyIdPolicy`, so there is a
 * single definition of conformance across Sources, browser defaults and the
 * env override.
 */
export function nonconformingSourceIds(
  sourceIds: readonly string[],
  policies: readonly CorpusSourceIdPolicy[],
): string[] {
  return sourceIds.filter((sourceId) => !conformsToAnyIdPolicy(sourceId, policies));
}

/**
 * Every `defaultSources` id names a real SSOT record (AUDIT-10) — FULL SWEEP
 * ONLY, because it reads the global identity index.
 *
 * Independent of {@link validateProfileDefaultSourceConformance} in both
 * directions, which is why both rules exist rather than one: a conforming id
 * for which no record was ever written passes conformance, and an id belonging
 * to a DIFFERENT corpus (`BE001` in alpha's profile) exists and so passes this
 * rule. Neither is suppressed when the other fires — suppression would be a
 * silent skip, and the two name different fixes.
 *
 * `entries` is the index over EVERY `*.yml` under the sources dir, not one
 * corpus's enumeration, so "exists" here means "exists anywhere in the SSOT".
 * Narrowing it to the profile's own corpus would duplicate the conformance
 * rule with worse prose.
 */
export function validateProfileDefaultSourcesExist(
  profiles: readonly LoadedBrowserProfile[],
  entries: readonly SourceIdentity[],
): CorpusValidationFinding[] {
  const known = new Set(entries.map((entry) => entry.sourceId));
  const findings: CorpusValidationFinding[] = [];

  for (const { profile, filePath } of profiles) {
    for (const sourceId of profile.defaultSources) {
      if (!known.has(sourceId)) {
        findings.push(
          finding(
            'profile-unknown-default-source',
            `${profile.id}/${sourceId}`,
            `browser profile ${JSON.stringify(profile.id)} (${filePath}) lists default Source ` +
              `${JSON.stringify(sourceId)}, but there is no such Source in the bibliography ` +
              `SSOT (${known.size} record(s) indexed); a browser build would resolve it to ` +
              'nothing',
          ),
        );
      }
    }
  }

  return findings;
}

/**
 * The browser-defaults rules decidable from the CONFIG ALONE — run by
 * `validateRepositoryWide`, and therefore at startup on every corpus-dependent
 * invocation. See this module's doc comment for why
 * {@link validateProfileDefaultSourcesExist} is deliberately NOT in here.
 */
export function validateBrowserDefaultsConfig(
  manifests: readonly CorpusManifest[],
  profiles: readonly LoadedBrowserProfile[],
): CorpusValidationFinding[] {
  return [
    ...validateProfileCorpusFilenames(profiles),
    ...validateProfileDefaultSourceConformance(manifests, profiles),
  ];
}
