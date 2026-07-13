import path from 'node:path';

import { resolveRepoRoot } from '@/cli/bib-sourcegroup';
import type { CoverageReport } from '@/bibliography/coverage/coverage-model';
import { buildCoverageReport } from '@/bibliography/coverage/coverage-model';
import { loadAllSources } from '@/bibliography/load';
import { loadSearchLog } from '@/bibliography/search-log';

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

  const sources = loadAllSources(sourcesDir);
  const searchLog = loadSearchLog(searchLogPath);
  return buildCoverageReport({ sources, searchLog });
}
