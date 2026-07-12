import path from 'node:path';
import { parseArgs as nodeParseArgs } from 'node:util';

import { resolveRepoRoot } from '@/cli/bib-sourcegroup';
import { buildCoverageReport } from '@/bibliography/coverage/coverage-model';
import { renderCoverage } from '@/bibliography/coverage/coverage-render';
import { loadAllSources } from '@/bibliography/load';
import { describeError } from '@/bibliography/load-primitives';
import { loadSearchLog } from '@/bibliography/search-log';

/** `bib coverage`'s own flags: no positionals -- it reports over the whole corpus. */
interface CoverageArgs {
  json: boolean;
}

/** Parse `bib coverage [--json]`'s argv slice. Throws (fail loud) on an unknown flag or a stray positional. */
function parseCoverageArgs(rest: string[]): CoverageArgs {
  const { values } = nodeParseArgs({
    args: rest,
    options: {
      json: { type: 'boolean', default: false },
    },
    allowPositionals: false,
    strict: true,
  });
  return { json: Boolean(values.json) };
}

/**
 * `bib coverage [--json]`: build the derived {@link CoverageReport} projection
 * (specs/007-corpus-coverage-audit/contracts/bib-coverage.md) and print it.
 *
 * Resolves `sourcesDir`/the search-log path the SAME way `bib show`/`bib
 * validate` resolve `sourcesDir` -- `bibliography/sources` and
 * `bibliography/search-log.yml` under `resolveRepoRoot()` -- then loads both
 * via the shipped loaders (`loadAllSources` fails loud on malformed SSOT;
 * `loadSearchLog` returns `[]` when `search-log.yml` is absent, not a
 * fallback but the loader's own documented "no searches logged yet" case).
 * The builder (`buildCoverageReport`) and renderer (`renderCoverage`) are both
 * pure, so this function performs the only I/O: two reads, zero writes.
 */
export async function runCoverageCli(rest: string[]): Promise<number> {
  let args: CoverageArgs;
  try {
    args = parseCoverageArgs(rest);
  } catch (error) {
    console.error(`bib coverage: ${describeError(error)}`);
    return 2;
  }

  const repoRoot = resolveRepoRoot();
  const sourcesDir = path.join(repoRoot, 'bibliography', 'sources');
  const searchLogPath = path.join(repoRoot, 'bibliography', 'search-log.yml');

  try {
    const sources = loadAllSources(sourcesDir);
    const searchLog = loadSearchLog(searchLogPath);
    const report = buildCoverageReport({ sources, searchLog });
    console.log(renderCoverage(report, { json: args.json }));
    return 0;
  } catch (error) {
    console.error(`bib coverage: ${describeError(error)}`);
    return 2;
  }
}
