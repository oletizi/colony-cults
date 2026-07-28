import { join } from 'node:path';

import { describeError } from '@/bibliography/load-primitives';
import { listBrowserProfileIds, loadBrowserProfile } from '@/corpus/browser-profile';
import { listCorpusManifestIds, loadCorpusManifest, type CorpusManifest } from '@/corpus/manifest';
import { readSourceIdentityIndex } from '@/corpus/source-index';
import { validateExistingData } from '@/corpus/validate-existing-data';
import { validateArchiveOverrides } from '@/corpus/validate-overrides';
import { validateRepositoryWide, type LoadedBrowserProfile } from '@/corpus/validate-repository';
import {
  finding,
  formatFindings,
  type CorpusValidationFinding,
  type CorpusValidationResult,
  type InstalledCapabilities,
} from '@/corpus/validate-types';

/**
 * Corpus config seam — THE INTEGRITY GATE (T005). See
 * specs/018-corpus-config-seam/spec.md (FR-002, FR-002a, FR-007, FR-008,
 * FR-015, FR-016), data-model.md (§Validation rules) and
 * contracts/corpus-seam.md (§Config validator). Surfaced as
 * `bib validate-config` (full) and as startup validation for the selected
 * corpus.
 *
 * STRICT POLICY (FR-015): every committed manifest under the active corpora
 * root must be valid before ANY corpus can run. A malformed committed
 * manifest blocks all corpora; drafts live OUTSIDE the root until valid.
 * This module therefore enumerates the whole root, never just the selected
 * corpus.
 *
 * INJECTED INPUTS (FR-016) — `corporaRoot`, `sourcesDir` and
 * `installedCapabilities` are all parameters, never literals or defaults
 * here. Production resolves the first two at the CLI composition root
 * (`<repoRoot>/corpora`, `<repoRoot>/bibliography/sources`); tests inject
 * fixture directories. Hardcoding either would make SC-003 (a second corpus
 * addable as fixtures only, zero core `src/` edits) unsatisfiable.
 *
 * `installedCapabilities` is injected for a second, independent reason: the
 * corpus NAMES capabilities but never owns the registry (data-model.md
 * §Invariants). Nothing under `@/corpus` may import
 * `RepositoryAdapterRegistry` / `SourceQueryRegistry`; the composition root
 * reads them once and passes the resulting name lists down, keeping config
 * and capability registration orthogonal.
 *
 * MODULE LAYOUT — the rules live in focused siblings so no file approaches
 * the 300-500 line limit, and so each rule family is independently testable
 * as a pure function:
 *   - `@/corpus/validate-types`         — Result/Finding vocabulary
 *   - `@/corpus/source-index`           — the global Source identity index
 *   - `@/corpus/validate-repository`    — repository-wide rules
 *   - `@/corpus/validate-overrides`     — archive-layout override rules
 *   - `@/corpus/validate-existing-data` — existing-data rules
 * This file is the ORCHESTRATOR: it owns the I/O and the error boundaries,
 * and contains no rule logic of its own beyond the capability subset check.
 */

export type {
  CorpusValidationFinding,
  CorpusValidationResult,
  CorpusValidationRule,
  InstalledCapabilities,
} from '@/corpus/validate-types';
export { formatFindings } from '@/corpus/validate-types';

/** Everything read off disk in one validation pass. */
interface LoadedCorpora {
  readonly manifests: CorpusManifest[];
  readonly profiles: LoadedBrowserProfile[];
  readonly findings: CorpusValidationFinding[];
}

/**
 * Load every committed manifest and profile, each under its OWN error
 * boundary.
 *
 * The loaders throw on the first structural violation of a single artifact,
 * which is right for them but wrong for a whole-repository gate: one bad
 * manifest must not hide the state of the other nine. So each load is
 * caught and converted into a located finding, and validation continues.
 * Nothing is defaulted or repaired — an artifact that failed to load simply
 * does not participate in the cross-artifact rules, and its failure is
 * reported.
 */
function loadCorpora(corporaRoot: string): LoadedCorpora {
  const manifests: CorpusManifest[] = [];
  const profiles: LoadedBrowserProfile[] = [];
  const findings: CorpusValidationFinding[] = [];

  for (const id of listCorpusManifestIds(corporaRoot)) {
    try {
      manifests.push(loadCorpusManifest(corporaRoot, id));
    } catch (error) {
      findings.push(finding('manifest-unreadable', id, describeError(error)));
    }
  }

  for (const fileId of listBrowserProfileIds(corporaRoot)) {
    try {
      profiles.push({
        profile: loadBrowserProfile(corporaRoot, fileId),
        filePath: join(corporaRoot, `${fileId}.browser.yml`),
      });
    } catch (error) {
      findings.push(finding('browser-profile-unreadable', fileId, describeError(error)));
    }
  }

  return { manifests, profiles, findings };
}

/**
 * `requiredCapabilities` ⊆ `installedCapabilities` (FR-008, INV-9).
 *
 * Exported on its own so the composition root can run exactly this check at
 * selection time — the contract lists the capability subset under "at
 * selection", not under the repository-wide rules — without re-running the
 * whole repository gate on every command.
 *
 * SPEC AMBIGUITY, recorded rather than resolved silently: FR-008 scopes this
 * check to selection, while FR-015's strict policy says every committed
 * manifest must be valid before any corpus runs, and
 * `validateCorpora(..., installedCapabilities)` takes the installed set as a
 * parameter. Read strictly together, an uninstalled capability named by a
 * corpus you are NOT running would block every corpus. {@link validateCorpora}
 * takes the literal reading — it reports the condition for every manifest,
 * because `bib validate-config` is documented as full validation — but the
 * findings carry their own `capability-not-installed` rule so a caller that
 * wants the narrower selection-time scope can filter on it rather than
 * needing a second, divergent code path.
 */
export function validateCapabilitySubset(
  manifest: CorpusManifest,
  installedCapabilities: InstalledCapabilities,
): CorpusValidationFinding[] {
  const findings: CorpusValidationFinding[] = [];

  const check = (kind: 'repositories' | 'sourceQueries'): void => {
    const installed = new Set(installedCapabilities[kind]);
    for (const required of manifest.requiredCapabilities[kind]) {
      if (!installed.has(required)) {
        const available = [...installed].sort();
        findings.push(
          finding(
            'capability-not-installed',
            `${manifest.id}/${kind}/${required}`,
            `corpus ${JSON.stringify(manifest.id)} requires the ${kind} capability ` +
              `${JSON.stringify(required)}, which is not installed; installed ${kind}: ` +
              `${available.length === 0 ? '(none)' : available.join(', ')}`,
          ),
        );
      }
    }
  };

  check('repositories');
  check('sourceQueries');

  return findings;
}

/**
 * Validate the ENTIRE corpora root against the existing bibliography SSOT.
 *
 * Returns every failure it finds, each with its own specific message
 * (SC-005) — see `@/corpus/validate-types` for why this returns a result
 * rather than throwing on the first violation, and why that is not a
 * tolerant mode. Use {@link assertCorporaValid} where a caller must not
 * proceed.
 *
 * Throws (rather than reporting a finding) only when an injected root is
 * itself missing or unreadable: a wrong `corporaRoot` or `sourcesDir` is a
 * composition error, and collapsing it into "zero manifests" / "zero
 * Sources" would let every rule vacuously pass — the exact failure mode
 * FR-015 exists to prevent.
 */
export function validateCorpora(
  corporaRoot: string,
  sourcesDir: string,
  installedCapabilities: InstalledCapabilities,
): CorpusValidationResult {
  const { manifests, profiles, findings: loadFindings } = loadCorpora(corporaRoot);
  const index = readSourceIdentityIndex(sourcesDir);

  const findings: CorpusValidationFinding[] = [
    ...loadFindings,
    ...validateRepositoryWide(manifests, profiles),
    ...validateArchiveOverrides(manifests, index.entries),
    ...validateExistingData(manifests, index),
    ...manifests.flatMap((manifest) => validateCapabilitySubset(manifest, installedCapabilities)),
  ];

  return { ok: findings.length === 0, findings };
}

/**
 * Fail-loud front door (Principle V, FR-015): run {@link validateCorpora}
 * and throw if ANYTHING is wrong, listing every finding in one message so a
 * single run tells the operator the whole story.
 *
 * The message names both injected roots, so a failure against a fixture root
 * is immediately distinguishable from one against production (FR-016).
 */
export function assertCorporaValid(
  corporaRoot: string,
  sourcesDir: string,
  installedCapabilities: InstalledCapabilities,
): void {
  const result = validateCorpora(corporaRoot, sourcesDir, installedCapabilities);
  if (result.ok) {
    return;
  }

  throw new Error(
    `validateCorpora(corporaRoot=${corporaRoot}, sourcesDir=${sourcesDir}): ` +
      `${result.findings.length} config violation(s); every committed manifest must be ` +
      'valid before any corpus can run (FR-015)\n' +
      formatFindings(result.findings),
  );
}
