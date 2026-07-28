import { parseArgs as nodeParseArgs } from 'node:util';

import { describeError } from '@/bibliography/load-primitives';
import { corporaRootFor, sourcesDirFor, type CliEnvironment } from '@/cli/composition-root';
import { installedCapabilities } from '@/cli/installed-capabilities';
import { listBrowserProfileIds } from '@/corpus/browser-profile';
import { listCorpusManifestIds } from '@/corpus/manifest';
import { validateCorpora } from '@/corpus/validate';
import type { CorpusValidationFinding, CorpusValidationResult } from '@/corpus/validate-types';

/**
 * `bib validate-config` — the FULL config sweep (T018; spec.md FR-008,
 * FR-015, User Story 4; contracts/corpus-seam.md § Config validator).
 *
 * AN FR-014 EXCEPTION COMMAND: it runs with NO corpus selected, and that is
 * the entire point — it validates the config that selection itself depends
 * on, so requiring a selection first would make an unusable config
 * undiagnosable. It is registered as an exception in `@/cli/corpus-exceptions`
 * (which T009 wired ahead of this task), so the dispatcher never composes a
 * corpus for it.
 *
 * SCOPE — full, per FR-015's strict policy: every committed manifest, every
 * committed browser profile, every archive-layout override, and the existing
 * bibliography SSOT, checked against the capabilities actually installed in
 * this process. That is strictly more than startup validation runs; see
 * `@/cli/startup-validation` for the split and its justification.
 *
 * REPORTS EVERY FINDING, NOT THE FIRST. `validateCorpora` accumulates
 * findings by design (SC-005) and this verb renders all of them, each with
 * its machine-readable rule, its subject and its specific message, so one run
 * gives the operator the whole picture rather than N fix-and-rerun cycles.
 * Findings are NOT an error condition to be swallowed — the exit code is
 * non-zero whenever any exists.
 *
 * EXIT CODES (matching `bib validate`): `0` clean, `1` findings exist, `2` a
 * thrown failure — a missing/unreadable corpora root or sources dir, which is
 * a composition error rather than a config finding and must never be
 * collapsed into "nothing to validate".
 */

/** Parsed `bib validate-config` flags. */
interface ValidateConfigArgs {
  /** Emit the machine-readable result instead of the human report. */
  readonly json: boolean;
}

/** Parse the verb's argv. Throws (fail loud) on an unknown flag or stray positional. */
export function parseValidateConfigArgs(rest: readonly string[]): ValidateConfigArgs {
  const { values, positionals } = nodeParseArgs({
    args: [...rest],
    options: { json: { type: 'boolean', default: false } },
    allowPositionals: true,
    strict: true,
  });
  if (positionals.length > 0) {
    throw new Error(
      `unexpected argument ${JSON.stringify(positionals[0])} — validate-config takes no ` +
        'positional arguments (it validates every committed manifest, not one)',
    );
  }
  return { json: Boolean(values.json) };
}

/** What was enumerated, so a vacuous pass over an empty root is never silent. */
interface Scope {
  readonly manifestIds: readonly string[];
  readonly profileIds: readonly string[];
}

/** Render one finding as a stable, greppable line. */
export function formatValidateConfigFinding(finding: CorpusValidationFinding): string {
  return `  [${finding.rule}] ${finding.subject}: ${finding.message}`;
}

/** The human report: what was checked, then every finding. */
function printHuman(
  result: CorpusValidationResult,
  scope: Scope,
  corporaRoot: string,
  sourcesDir: string,
): void {
  console.log(`bib validate-config: corporaRoot=${corporaRoot}`);
  console.log(`bib validate-config: sourcesDir=${sourcesDir}`);
  console.log(
    `bib validate-config: checked ${scope.manifestIds.length} manifest(s) ` +
      `[${scope.manifestIds.join(', ')}] + ${scope.profileIds.length} browser profile(s) ` +
      `[${scope.profileIds.join(', ')}]`,
  );
  if (result.ok) {
    console.log('bib validate-config: clean -- no findings');
    return;
  }
  console.log(`bib validate-config: ${result.findings.length} finding(s):`);
  for (const finding of result.findings) {
    console.log(formatValidateConfigFinding(finding));
  }
}

/**
 * Run the verb. `environment` carries the injected roots (FR-016) — the
 * dispatcher passes its own `CliEnvironment` straight through, so a test
 * points this at fixture directories exactly the way it points selection at
 * a fixture corpora root, with no separate code path.
 */
export function runValidateConfigCli(
  rest: readonly string[],
  environment: CliEnvironment = {},
): number {
  let args: ValidateConfigArgs;
  try {
    args = parseValidateConfigArgs(rest);
  } catch (error) {
    console.error(`bib validate-config: ${describeError(error)}`);
    return 2;
  }

  const corporaRoot = corporaRootFor(environment);
  const sourcesDir = sourcesDirFor(environment);

  let result: CorpusValidationResult;
  let scope: Scope;
  try {
    scope = {
      manifestIds: listCorpusManifestIds(corporaRoot),
      profileIds: listBrowserProfileIds(corporaRoot),
    };
    result = validateCorpora(corporaRoot, sourcesDir, installedCapabilities());
  } catch (error) {
    console.error(`bib validate-config: ${describeError(error)}`);
    return 2;
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          ok: result.ok,
          corporaRoot,
          sourcesDir,
          manifests: scope.manifestIds,
          browserProfiles: scope.profileIds,
          findings: result.findings,
        },
        null,
        2,
      ),
    );
  } else {
    printHuman(result, scope, corporaRoot, sourcesDir);
  }

  return result.ok ? 0 : 1;
}
