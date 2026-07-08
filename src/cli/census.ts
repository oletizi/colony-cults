import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { ParsedArgs } from '@/cli/parse';
import type { GallicaClient } from '@/gallica/gallica-client';
import { GallicaHttpClient } from '@/gallica/gallica-client';
import { HttpClient } from '@/gallica/http-client';
import { buildCensus } from '@/census/build';
import { serializeCensus } from '@/census/serialize';

/**
 * Injectable side effects for the census command, so the handler can be driven
 * without real network or disk in tests. Defaults wire the real Gallica client
 * and filesystem.
 */
export interface CensusDeps {
  client: GallicaClient;
  /** Write file contents to an absolute path (creates parent dirs). */
  writeCensusFile: (absolutePath: string, contents: string) => Promise<void>;
  /** Line-oriented output sink (stdout in production). */
  log: (message: string) => void;
  /** ISO date stamped into the census; injected for reproducibility. */
  builtAt: string;
  /** Repository root the `data/census/` path is resolved against. */
  repoRoot: string;
}

/** Build the default (real network + disk) dependencies. */
export function defaultCensusDeps(): CensusDeps {
  const http = new HttpClient();
  return {
    client: new GallicaHttpClient(http),
    writeCensusFile: async (absolutePath, contents) => {
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, contents, 'utf-8');
    },
    log: (message) => {
      console.log(message);
    },
    builtAt: new Date().toISOString().slice(0, 10),
    repoRoot: process.cwd(),
  };
}

/** Require a named string option, failing loud when it is absent/blank. */
function requireOption(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`census: --${name} is required`);
  }
  return value;
}

/** Absolute path of the census file for a source: `data/census/<id>-<slug>.json`. */
export function censusPath(
  repoRoot: string,
  sourceId: string,
  slug: string,
): string {
  return resolve(repoRoot, 'data', 'census', `${sourceId}-${slug}.json`);
}

/**
 * `census <periodicalArk> --source-id <id> --slug <slug>`.
 *
 * Writes a deterministic per-source census JSON. With `--dry-run` it reports
 * the target path, issue count, and year span, and writes nothing.
 */
export async function runCensus(
  args: ParsedArgs,
  deps: CensusDeps = defaultCensusDeps(),
): Promise<void> {
  const periodicalArk = args.positional[0];
  if (periodicalArk === undefined) {
    throw new Error('census: missing required argument <periodicalArk>');
  }
  const sourceId = requireOption(args.options.sourceId, 'source-id');
  const slug = requireOption(args.options.slug, 'slug');
  const targetPath = censusPath(deps.repoRoot, sourceId, slug);

  if (args.flags.dryRun) {
    const enumeration = await deps.client.issues(periodicalArk);
    const span = yearSpan(enumeration.years);
    deps.log(
      `census (dry-run): would write ${targetPath} -- ` +
        `${enumeration.totalIssues} issues (${enumeration.issues.length} enumerated), ` +
        `span ${span}`,
    );
    return;
  }

  const census = await buildCensus(
    periodicalArk,
    deps.client,
    sourceId,
    deps.builtAt,
  );
  await deps.writeCensusFile(targetPath, serializeCensus(census));
  deps.log(
    `census: wrote ${targetPath} -- ${census.issues.length} issues ` +
      `(span ${yearSpan(census.issues.map((issue) => issue.date))})`,
  );
}

/** Render a "first-last" span from a list of years or dates (fail loud if empty). */
function yearSpan(values: string[]): string {
  if (values.length === 0) {
    throw new Error('census: no issues found for source');
  }
  const years = values.map((value) => value.slice(0, 4)).sort();
  const first = years[0];
  const last = years[years.length - 1];
  return first === last ? first : `${first}-${last}`;
}
