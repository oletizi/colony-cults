import { installedCapabilities } from '@/cli/installed-capabilities';
import type { SelectedCorpus } from '@/corpus/select';
import { validateCapabilitySubset, validateCorporaConfig } from '@/corpus/validate';
import {
  formatFindings,
  type CorpusValidationFinding,
  type InstalledCapabilities,
} from '@/corpus/validate-types';

/**
 * STARTUP VALIDATION for the selected corpus (T018; spec.md FR-008, FR-009,
 * FR-015; contracts/corpus-seam.md § Config validator; INV-9).
 *
 * Runs at the composition root, once, immediately after selection and BEFORE
 * any command work begins — so a corpus-dependent command whose config is
 * invalid fails loud with nothing half-done (FR-009, SC-002).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE SPLIT: what runs here vs. only in `bib validate-config`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * HERE, on every corpus-dependent invocation — the CONFIG-ONLY rules
 * (`validateCorporaConfig`) plus the capability subset for the SELECTED
 * corpus:
 *   - every committed manifest and profile under `corporaRoot` loads
 *     (FR-015's strict policy: a malformed committed manifest blocks all
 *     corpora, so this cannot be narrowed to the selected manifest);
 *   - unique corpus ids; prefix disjointness across ALL policies of ALL
 *     corpora (FR-002a/FR-002b); unique case ids; profiles reference a known
 *     corpus and have unique ids;
 *   - `requiredCapabilities ⊆ installedCapabilities` for the selected corpus
 *     (FR-008 scopes this check to "at selection"; INV-9).
 * These are exactly the rules whose inputs are the config itself. The cost is
 * bounded by the NUMBER OF CORPORA (two small YAML files per corpus), not by
 * corpus size, and every one of them is a precondition for the narrow
 * policies derived a line later being meaningful: an overlapping prefix or a
 * duplicated case id means the `SourceIdPolicy` about to be handed to the
 * allocator could mint a globally ambiguous ID. Deferring those to a separate
 * verb an operator must remember to run would be exactly the "reconcile
 * later" split the constitution rejects.
 *
 * ONLY IN THE FULL SWEEP (`bib validate-config` → `validateCorpora`) — every
 * rule that reads the bibliography SSOT:
 *   - existing-data rules (global Source-ID uniqueness, per-corpus ID-policy
 *     conformance, next-allocated-ID collision, unreadable records);
 *   - archive-layout override rules (they must resolve override keys against
 *     real Source records);
 *   - the capability subset for EVERY committed manifest, not just the
 *     selected one.
 *
 * WHY THOSE ARE EXCLUDED HERE — two independent reasons, either sufficient:
 *
 * 1. FR-010 (behavior-preserving). The existing-data sweep reads EVERY
 *    `*.yml` under the sources dir. Running it at startup would make a single
 *    malformed or nonconforming Source record fail commands that never load a
 *    Source — `bib show` on an unrelated id, `bib query-source`, a fetch.
 *    That is a change in observable behavior, and it is the same reason T009
 *    kept `ArchiveLayoutPolicy` out of the composition root. A DATA defect
 *    must fail the commands that read that data, not all of them.
 * 2. Cost. It is O(number of Sources) YAML parses on every invocation, paid
 *    by commands that need none of it.
 *
 * The consequence is stated plainly rather than hidden: startup validation
 * does NOT prove the SSOT conforms to the corpus's ID policies. `bib
 * validate-config` is where that is established, and it is the verb CI and an
 * operator run. Startup validation guarantees the CONFIG is coherent; the
 * full sweep guarantees the config and the DATA agree.
 *
 * RESOLVED AMBIGUITY (was recorded here as open; AUDIT-21). An EARLIER DRAFT of
 * contracts/corpus-seam.md described startup validation as "selected corpus +
 * global identity index", which read literally would have pulled
 * `readSourceIdentityIndex` (the whole-SSOT read) into every command and
 * contradicted FR-010 and T009's own stated reasoning. The FR-010-preserving
 * reading was taken here, and the contract has since been updated to document
 * the split explicitly — see its paragraph headed "Startup deliberately
 * EXCLUDES the global identity index", which states the same conclusion and the
 * same reasoning. The two no longer disagree; the identity index runs in the
 * full sweep only.
 */

/**
 * Config-only + selected-corpus findings, in the order they were produced.
 * Returned rather than thrown so a caller can report them all; see
 * {@link assertSelectedCorpusValid} for the fail-loud front door.
 *
 * `installed` is an injectable parameter with a production default read from
 * the real registries (`@/cli/installed-capabilities`) — not a fallback: it is
 * the composition root's own wiring, and the default is the live registry
 * rather than a stand-in for a missing one.
 */
export function validateSelectedCorpus(
  selected: SelectedCorpus,
  installed: InstalledCapabilities = installedCapabilities(),
): readonly CorpusValidationFinding[] {
  return [
    ...validateCorporaConfig(selected.corporaRoot).findings,
    ...validateCapabilitySubset(selected.manifest, installed),
  ];
}

/**
 * Fail loud (Principle V, FR-009) when the selected corpus's config is
 * invalid, listing EVERY finding in one message so a single failed run tells
 * the operator the whole story instead of one violation per attempt.
 *
 * The message names the corpora root and points at `bib validate-config`,
 * because the full sweep is what will also tell them whether the SSOT agrees
 * with the config — the part deliberately not checked here.
 */
export function assertSelectedCorpusValid(
  selected: SelectedCorpus,
  installed: InstalledCapabilities = installedCapabilities(),
): void {
  const findings = validateSelectedCorpus(selected, installed);
  if (findings.length === 0) {
    return;
  }

  throw new Error(
    `corpus ${JSON.stringify(selected.manifest.id)} failed startup validation ` +
      `(corporaRoot=${selected.corporaRoot}): ${findings.length} config violation(s); ` +
      'every committed manifest must be valid before any corpus can run (FR-015). ' +
      'Run `bib validate-config` for the full sweep, which also checks the ' +
      'bibliography SSOT against this config.\n' +
      formatFindings(findings),
  );
}
