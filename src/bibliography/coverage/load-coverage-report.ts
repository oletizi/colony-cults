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
import { unionSourceFilenamePolicy } from '@/corpus/source-filename-bootstrap';

/**
 * Every case id declared by ANY committed corpus manifest under `<repoRoot>/
 * corpora` (FR-004, FR-010): this build-time loader has no per-request
 * `--corpus`/`COLONY_CORPUS` selection of its own (unlike the CLI composition
 * root, `@/cli/composition-root`) -- the Astro coverage page it backs already
 * renders the WHOLE committed bibliography unscoped to one corpus (see its
 * own doc comment), so the search-log scope check here is scoped the same
 * way: valid against every case any manifest declares, not one hardcoded id.
 * With exactly one committed manifest (`corpora/port-breton.yml`, `cases:
 * [port-breton]`) this is behavior-identical to the retired hardcoded check.
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
 * so the two policies derived from them -- the case-id set above and the
 * source-filename policy `loadAllSources` now requires (T023, FR-018) -- come
 * from one read of one root.
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
 */
export function loadCoverageReport(repoRoot?: string): CoverageReport {
  const root = repoRoot ?? resolveRepoRoot();
  const sourcesDir = path.join(root, 'bibliography', 'sources');
  const searchLogPath = path.join(root, 'bibliography', 'search-log.yml');
  const scopesPath = path.join(root, 'bibliography', 'scopes.yml');

  const manifests = listManifests(root);
  const sources = loadAllSources(sourcesDir, unionSourceFilenamePolicy(manifests));
  const searchLog = loadSearchLog(searchLogPath);
  const threadIds = threadIdSet(loadScopesRegistry(scopesPath));
  const validCaseIds = deriveAllCaseIds(manifests);
  return buildCoverageReport({ sources, searchLog, threadIds, validCaseIds });
}
