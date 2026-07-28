/**
 * T015 (spec 018-corpus-config-seam): the SC-001 structured coverage-snapshot
 * regression gate.
 *
 * SC-001 requires that the extraction be behavior-preserving for Port Breton,
 * proven by a STRUCTURED snapshot comparison rather than rendered prose --
 * "Source/group counts, statuses, unresolved leads, extent reporting,
 * repository holdings, ordering, and generated identifiers/links"
 * (contracts/corpus-seam.md § Coverage snapshot comparison).
 *
 * The fixture (`tests/fixtures/coverage/pre-feature-coverage-snapshot.json`)
 * is the `bib coverage --json` projection captured at the PRE-FEATURE BASE
 * COMMIT e93bc5f -- the branch point of `feature/corpus-config-seam`, i.e.
 * `git merge-base main HEAD` -- through the pre-feature, constant-driven code
 * path (`loadAllSources(sourcesDir)` with the hardcoded `SOURCE_FILE_PATTERN`,
 * and `buildCoverageReport` with no injected `validCaseIds`). It is the
 * same-shaped artifact as T001's `tests/fixtures/archive/legacy-source-layouts
 * .json` and serves the same purpose: it is the only thing proving this
 * refactor did not move a number.
 *
 * THIS TEST DRIVES THE POST-FEATURE PATH: it composes the corpus at the real
 * composition root under `--corpus port-breton` (`composeCorpus`), enumerates
 * Sources through the injected `SourceFilenamePolicy` (FR-018), and resolves
 * search-log `{ kind: 'case' }` scopes through the injected
 * `scope.validCaseIds` (FR-004/T011). Byte-equality with the fixture is
 * therefore a claim about the SEAM, not about the projection alone.
 *
 * A `CoverageReport`'s key order is fixed by construction (see
 * `buildCoverageReport`), so the comparison can be made on the serialized
 * bytes -- the same determinism guarantee `bib coverage --json` relies on.
 *
 * WHAT THIS GATE DOES **NOT** COVER: the archive-layout axis. That is T001's
 * `tests/unit/archive/location-legacy-characterization.test.ts`, over the 9
 * legacy Port Breton Sources.
 *
 * REGENERATING THE FIXTURE: this fixture pins committed canonical data
 * (`bibliography/sources/`, `bibliography/search-log.yml`,
 * `bibliography/scopes.yml`). A DELIBERATE change to that data -- acquiring a
 * new Source, logging a new search -- legitimately moves these numbers, and
 * the fixture must then be regenerated in the SAME commit as the data change,
 * with the diff reviewed as evidence of what moved:
 *
 *     npx tsx src/index.ts coverage --corpus port-breton --json \
 *       > tests/fixtures/coverage/pre-feature-coverage-snapshot.json
 *
 * Regenerating it to make an unexplained failure go away defeats the gate.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { buildCoverageReport } from '@/bibliography/coverage/coverage-model';
import type { CoverageReport } from '@/bibliography/coverage/coverage-model';
import { loadAllSources } from '@/bibliography/load';
import { loadScopesRegistry, threadIdSet } from '@/bibliography/scopes-registry';
import { loadSearchLog } from '@/bibliography/search-log';
import { composeCorpus, resolveCorporaRoot } from '@/cli/composition-root';

/** The repo root: this file is `tests/unit/bibliography/`, three levels down. */
const REPO_ROOT = path.join(__dirname, '..', '..', '..');

const FIXTURE_PATH = path.join(
  REPO_ROOT,
  'tests',
  'fixtures',
  'coverage',
  'pre-feature-coverage-snapshot.json',
);

/**
 * The pre-feature (e93bc5f) `bib coverage --json` bytes, verbatim, minus the
 * single trailing newline `console.log` appends. That newline is the CLI's
 * line terminator, not part of the rendered report (`renderCoverage` returns
 * the `JSON.stringify` output with no terminator), so stripping exactly one
 * is normalization of the capture mechanism -- NOT a loosened comparison.
 * Every byte of the report itself is still compared exactly.
 */
const FIXTURE_TEXT = readFileSync(FIXTURE_PATH, 'utf-8').replace(/\n$/, '');
const FIXTURE: CoverageReport = JSON.parse(FIXTURE_TEXT) as CoverageReport;

/**
 * Build the coverage report exactly as `bib coverage --corpus port-breton`
 * builds it (`@/cli/bib-coverage`'s `runCoverageCli`): the same repo-root
 * relative paths, the same shipped loaders, the same pure builder -- and the
 * same narrow policies threaded from the composition root.
 */
function buildReportUnderPortBreton(): CoverageReport {
  const sourcesDir = path.join(REPO_ROOT, 'bibliography', 'sources');
  const corpus = composeCorpus({
    corporaRoot: resolveCorporaRoot(REPO_ROOT),
    cliCorpus: 'port-breton',
  });

  return buildCoverageReport({
    sources: loadAllSources(sourcesDir, corpus.sourceFilenames),
    searchLog: loadSearchLog(path.join(REPO_ROOT, 'bibliography', 'search-log.yml')),
    threadIds: threadIdSet(
      loadScopesRegistry(path.join(REPO_ROOT, 'bibliography', 'scopes.yml')),
    ),
    validCaseIds: corpus.scope.validCaseIds,
  });
}

describe('SC-001 structured coverage snapshot (T015, spec 018-corpus-config-seam)', () => {
  const report = buildReportUnderPortBreton();

  it('is byte-identical to the pre-feature (e93bc5f) snapshot', () => {
    expect(
      JSON.stringify(report, null, 2),
      'the structured coverage snapshot drifted from the pre-feature baseline — ' +
        'see this file’s header before regenerating the fixture',
    ).toBe(FIXTURE_TEXT);
  });

  it('preserves per-work-bundle counts, extents, gaps and member ordering', () => {
    expect(report.perWorkBundle).toEqual(FIXTURE.perWorkBundle);
    expect(report.perWorkBundle.map((row) => row.workBundle)).toEqual(
      FIXTURE.perWorkBundle.map((row) => row.workBundle),
    );
  });

  it('preserves the corpus-wide evidence-class distribution and its ordering', () => {
    expect(report.evidenceClassDistribution).toEqual(FIXTURE.evidenceClassDistribution);
  });

  it('preserves the unresolved-lead register, its owners and its resolutions', () => {
    expect(report.register).toEqual(FIXTURE.register);
  });

  it('preserves repository holdings, scope handles and measured closure', () => {
    expect(report.searchHistory.matrix).toEqual(FIXTURE.searchHistory.matrix);
    expect(report.searchHistory.byScope).toEqual(FIXTURE.searchHistory.byScope);
    expect(report.searchHistory.byRepository).toEqual(FIXTURE.searchHistory.byRepository);
  });
});
