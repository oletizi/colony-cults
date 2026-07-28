import { existsSync } from 'node:fs';
import path from 'node:path';

import { resolveRepoRoot } from '@/cli/bib-sourcegroup';
import { resolveCorporaRoot } from '@/cli/composition-root';
import type { CoverageReport } from '@/bibliography/coverage/coverage-model';
import { buildCoverageReport } from '@/bibliography/coverage/coverage-model';
import { loadAllSources } from '@/bibliography/load';
import { loadScopesRegistry, threadIdSet } from '@/bibliography/scopes-registry';
import { loadSearchLog } from '@/bibliography/search-log';
import { listCorpusManifests, type CorpusManifest } from '@/corpus/manifest';
import { deriveScopeContext } from '@/corpus/policies';
import type { SelectedCorpus } from '@/corpus/select';
import { unionSourceFilenamePolicy } from '@/corpus/source-filename-bootstrap';

/**
 * Every case id declared by ANY committed corpus manifest under `<repoRoot>/
 * corpora` (FR-004, FR-010): the union fallback for a caller with no
 * `SelectedCorpus` of its own to bind to (see {@link loadCoverageReport}'s
 * `selectedCorpus` parameter, T014). With exactly one committed manifest
 * (`corpora/port-breton.yml`, `cases: [port-breton]`) this is
 * behavior-identical to the retired hardcoded check, and to the bound path,
 * since the union and the one selected corpus's own cases coincide.
 *
 * ABSENCE: an absent `corpora/` directory (e.g. a test fixture `repoRoot`
 * with no corpora committed at all) yields an empty set rather than
 * throwing -- this loader's search-log scope check is best-effort over
 * whatever manifests exist, mirroring `threadIds`' own documented
 * absent-registry-is-empty-set contract, not a fail-loud guarantee the way
 * the CLI composition root's `corporaRoot` is (that root is REQUIRED to
 * exist, per `@/cli/composition-root`).
 */
function deriveAllCaseIds(manifests: readonly CorpusManifest[]): ReadonlySet<string> {
  const caseIds = new Set<string>();
  for (const manifest of manifests) {
    for (const caseId of manifest.cases) {
      caseIds.add(caseId);
    }
  }
  return caseIds;
}

/**
 * Every committed manifest under `<repoRoot>/corpora`, loaded ONCE per report
 * so the two UNION policies derived from them -- the case-id fallback above
 * and the source-filename policy below -- come from one read of one root.
 *
 * ABSENCE: an absent `corpora/` directory yields an empty list, preserving
 * this loader's documented best-effort case-id behavior. That empty list is
 * NOT tolerated by the source-filename policy, which fails loud instead --
 * correctly so: "no manifests" makes the case-id check merely unenforceable,
 * but it makes Source enumeration ANSWERLESS, and quietly enumerating nothing
 * is the failure FR-018 exists to remove.
 */
function listManifests(repoRoot: string): CorpusManifest[] {
  const corporaRoot = resolveCorporaRoot(repoRoot);
  if (!existsSync(corporaRoot)) {
    return [];
  }
  return listCorpusManifests(corporaRoot);
}

/**
 * Build-time entry point for the coverage web view (specs/008-coverage-web-view
 * T002/T003): loads the committed bibliography SSOT + search log from disk and
 * returns the derived {@link CoverageReport} projection, exactly mirroring the
 * load path `bib coverage` (src/cli/bib-coverage.ts) uses -- same
 * `resolveRepoRoot()`, same `bibliography/sources` + `bibliography/search-log.yml`
 * paths, same shipped loaders (`loadAllSources`, `loadSearchLog`) and the same
 * pure projection builder (`buildCoverageReport`), unchanged. This module
 * performs the only I/O (two reads, zero writes, no network) and adds no
 * fallback, default, or partial report of its own: a malformed source throws
 * `loadAllSources`'s error unchanged (fail loud), and an absent search log is
 * `loadSearchLog`'s own documented "no searches logged yet" case (`[]`), not a
 * substitution made here.
 *
 * `selectedCorpus` (T014, FR-004): OPTIONAL, and bound to the SELECTED
 * corpus's own `validCaseIds` (`@/corpus/policies`' `deriveScopeContext`) when
 * supplied, in place of the union-across-every-manifest fallback
 * ({@link deriveAllCaseIds}) -- a union that is behavior-identical with one
 * committed corpus but WRONG once a second exists (T011 flagged this
 * explicitly for this task to close). The one present-day caller that CAN
 * reach a selection, `site/src/pages/coverage/index.astro`, does so via the
 * browser/site-build composition root (`@/browser/config`'s
 * `selectBrowserCorpus`) and passes it here. Every other caller -- this
 * module's own unit tests, and any future non-browser build step with no
 * `--corpus`/`COLONY_CORPUS` selection of its own -- has no selection to
 * reach, so the parameter stays optional and the union remains its
 * documented, intentional behavior, not a silently-stale default.
 *
 * The source-filename policy is DELIBERATELY NOT bound to `selectedCorpus`
 * even when one is supplied -- unlike the case-id check above, this is not
 * an oversight left for a later task. `bibliography/sources` holds every
 * corpus's Source files, and "which files in that directory count as
 * Sources" is a question about the SHARED directory's own naming
 * conventions, not about which corpus a browser session happens to have
 * selected (`@/corpus/source-filename-bootstrap`'s module doc comment makes
 * the identical argument for `@/archive/layout-bootstrap`). Binding it to one
 * selected corpus would make the coverage report silently DROP a second
 * corpus's Sources from `sources` the moment one exists -- while the page
 * itself is documented to render the whole committed bibliography, unscoped
 * to any one corpus. So this stays a union unconditionally, stated here
 * explicitly per that same reasoning.
 */
export function loadCoverageReport(
  repoRoot?: string,
  selectedCorpus?: SelectedCorpus,
): CoverageReport {
  const root = repoRoot ?? resolveRepoRoot();
  const sourcesDir = path.join(root, 'bibliography', 'sources');
  const searchLogPath = path.join(root, 'bibliography', 'search-log.yml');
  const scopesPath = path.join(root, 'bibliography', 'scopes.yml');

  const manifests = listManifests(root);
  const sources = loadAllSources(sourcesDir, unionSourceFilenamePolicy(manifests));
  const searchLog = loadSearchLog(searchLogPath);
  const threadIds = threadIdSet(loadScopesRegistry(scopesPath));
  const validCaseIds =
    selectedCorpus !== undefined
      ? deriveScopeContext(selectedCorpus).validCaseIds
      : deriveAllCaseIds(manifests);
  return buildCoverageReport({ sources, searchLog, threadIds, validCaseIds });
}
