/**
 * CLI wiring for `bib rights-assess <sourceId>` (T018, specs/011-museum-
 * acquisition-path). All logic that touches the SSOT lives in
 * `@/rights/assess` (`reviewRightsEvidence` / `recordRightsAssessment`); this
 * module only parses argv, constructs the REAL adapter(s) the selected
 * record actually needs, and formats the result.
 *
 * Two modes, split purely on whether `--status` is present:
 *  - review (no `--status`): prints the adapter's proposed rights evidence.
 *    Writes nothing (FR-008).
 *  - write (`--status <...> --basis "<...>"`): persists the operator's
 *    RightsAssessment. Never touches the adapter/registry.
 *
 * Adapter construction is LAZY and scoped to what the selected record's copy
 * identifiers actually dispatch to (`ark` -> GallicaAdapter, `accession` ->
 * NewItalyMuseumAdapter) -- so reviewing a plain Gallica copy never pays
 * NewItalyMuseumAdapter's async engine preflight, and vice versa. An
 * unresolvable/ambiguous set of identifiers is left to
 * `RepositoryAdapterRegistry.selectForRecord`'s own fail-loud diagnostics
 * (INV-D) by registering exactly the adapters the identifiers call for.
 */

import { parseArgs as nodeParseArgs } from 'node:util';
import path from 'node:path';

import { authoredToRepositoryRecord } from '@/bibliography/authored-record';
import { loadSourceFile } from '@/bibliography/load';
import { describeError } from '@/bibliography/load-primitives';
import { GallicaHttpClient } from '@/gallica/gallica-client';
import { HttpClient } from '@/gallica/http-client';
import { runFetchSource } from '@/cli/fetch';
import { gallicaArkMetadataResolver } from '@/sourcegroup/gallica-ark-resolver';
import { GallicaAdapter } from '@/repository/gallica/adapter';
import { NewItalyMuseumAdapter } from '@/repository/new-italy-museum/adapter';
import { createMusarchExtractor } from '@/repository/new-italy-museum/extractor';
import { RepositoryAdapterRegistry } from '@/repository/registry';
import type { RepositoryAdapter, RepositoryName } from '@/repository/adapter';
import type { RepositoryRecord } from '@/model/repository-record';
import type { RightsAssessment } from '@/model/rights';
import { selectRepositoryRecord } from '@/sourcegroup/record-select';
import { recordRightsAssessment, reviewRightsEvidence } from '@/rights/assess';
import { resolveRepoRoot, sourcesDirOf } from '@/cli/bib-sourcegroup-paths';

/** Typed result of parsing `bib rights-assess`'s argv (see {@link parseRightsAssessArgs}). */
export interface RightsAssessCliArgs {
  sourceId: string | undefined;
  archive: string | undefined;
  status: string | undefined;
  basis: string | undefined;
  jurisdiction: string | undefined;
  rightsRaw: string | undefined;
}

/**
 * Parse `bib rights-assess <sourceId> [--archive <sourceArchive>] [--status
 * <public-domain|restricted|uncertain>] [--basis "<text>"] [--jurisdiction
 * <AU>] [--rights-raw "<text>"]`'s argv into typed flags. No narrowing
 * happens here -- `--status` is validated by `@/rights/assess`'s
 * `recordRightsAssessment`, so parsing and validation never disagree.
 */
export function parseRightsAssessArgs(rest: string[]): RightsAssessCliArgs {
  const { values, positionals } = nodeParseArgs({
    args: rest,
    options: {
      archive: { type: 'string' },
      status: { type: 'string' },
      basis: { type: 'string' },
      jurisdiction: { type: 'string' },
      'rights-raw': { type: 'string' },
    },
    allowPositionals: true,
    strict: true,
  });
  return {
    sourceId: positionals[0],
    archive: values.archive,
    status: values.status,
    basis: values.basis,
    jurisdiction: values.jurisdiction,
    rightsRaw: values['rights-raw'],
  };
}

/** The repository names the selected record's copy identifiers actually dispatch to (mirrors registry.ts's dispatch table). */
function neededRepositoryNames(record: RepositoryRecord): RepositoryName[] {
  const identifiers = record.identifiers ?? [];
  const names = new Set<RepositoryName>();
  if (identifiers.some((id) => id.type === 'ark')) {
    names.add('gallica');
  }
  if (identifiers.some((id) => id.type === 'accession')) {
    names.add('new-italy-museum');
  }
  return [...names];
}

/** Build the real GallicaAdapter (no async engine preflight; cheap). */
function buildGallicaAdapter(): GallicaAdapter {
  return new GallicaAdapter({
    fetch: runFetchSource,
    resolveArk: gallicaArkMetadataResolver(new GallicaHttpClient(new HttpClient())),
  });
}

/** Build the real NewItalyMuseumAdapter (pays the async engine preflight). */
async function buildNewItalyMuseumAdapter(): Promise<NewItalyMuseumAdapter> {
  const extractor = await createMusarchExtractor();
  return new NewItalyMuseumAdapter({ client: new HttpClient(), extractor });
}

/** Construct a registry carrying only the adapter(s) the selected record's identifiers need. */
async function registryForRecord(record: RepositoryRecord): Promise<RepositoryAdapterRegistry> {
  const names = neededRepositoryNames(record);
  const adapters: RepositoryAdapter[] = [];
  if (names.includes('gallica')) {
    adapters.push(buildGallicaAdapter());
  }
  if (names.includes('new-italy-museum')) {
    adapters.push(await buildNewItalyMuseumAdapter());
  }
  return new RepositoryAdapterRegistry(adapters);
}

/** Resolve the copy `--archive` (or infer-one) selects for `sourceId`. */
function selectRecord(sourcesDir: string, sourceId: string, archive: string | undefined): RepositoryRecord {
  const filePath = path.join(sourcesDir, `${sourceId}.yml`);
  const { records } = loadSourceFile(filePath);
  const converted = records.map((authored) => authoredToRepositoryRecord(sourceId, authored));
  return selectRepositoryRecord(converted, archive);
}

/** Print the review-mode evidence for the operator (FR-008); writes nothing. */
function printEvidence(
  sourceId: string,
  sourceArchive: string,
  evidence: Awaited<ReturnType<typeof reviewRightsEvidence>>['evidence'],
): void {
  console.log(`bib rights-assess (review): ${sourceId} @ ${sourceArchive} -- writes nothing`);
  if (evidence.date !== undefined) {
    console.log(`  date: ${evidence.date.value}`);
    console.log(`    interpretation: ${evidence.date.interpretation}`);
    console.log(`    excerpt: ${evidence.date.evidence.excerpt}`);
  } else {
    console.log('  date: (none proposed by the adapter)');
  }
  if (evidence.creator !== undefined) {
    console.log(`  creator: ${evidence.creator.value}`);
    console.log(`    interpretation: ${evidence.creator.interpretation}`);
    console.log(`    excerpt: ${evidence.creator.evidence.excerpt}`);
  }
  if (evidence.rightsRaw !== undefined) {
    console.log(`  rightsRaw: ${evidence.rightsRaw}`);
  }
  if (evidence.publicationStatus !== undefined) {
    console.log(`  publicationStatus: ${evidence.publicationStatus}`);
  }
  if (evidence.repositoryPolicy !== undefined) {
    console.log(`  repositoryPolicy: ${evidence.repositoryPolicy}`);
  }
  if (evidence.jurisdiction !== undefined) {
    console.log(`  jurisdiction: ${evidence.jurisdiction}`);
  }
  console.log(
    '  run again with --status <public-domain|restricted|uncertain> --basis "<text>" to record a judgment.',
  );
}

/** Print the write-mode result: the persisted RightsAssessment. */
function printAssessment(
  sourceId: string,
  sourceArchive: string,
  assessment: RightsAssessment,
  filePath: string,
): void {
  console.log(
    `bib rights-assess: ${sourceId} @ ${sourceArchive} -> rightsStatus "${assessment.rightsStatus}" ` +
      `(assessedBy: ${assessment.assessedBy}, assessedAt: ${assessment.assessedAt})`,
  );
  console.log(`  basis: ${assessment.rightsBasis}`);
  if (assessment.rightsJurisdiction !== undefined) {
    console.log(`  jurisdiction: ${assessment.rightsJurisdiction}`);
  }
  if (assessment.rightsRaw !== undefined) {
    console.log(`  rightsRaw: ${assessment.rightsRaw}`);
  }
  console.log(`  written: ${filePath}`);
}

/**
 * `bib rights-assess <sourceId> [--archive] [--status] [--basis]
 * [--jurisdiction] [--rights-raw]`.
 */
export async function runRightsAssessCli(rest: string[]): Promise<number> {
  let parsed: RightsAssessCliArgs;
  try {
    parsed = parseRightsAssessArgs(rest);
  } catch (error) {
    console.error(`bib rights-assess: ${describeError(error)}`);
    return 2;
  }
  const { sourceId, archive, status, basis, jurisdiction, rightsRaw } = parsed;

  if (sourceId === undefined) {
    console.error('bib rights-assess: missing required argument <sourceId>');
    return 2;
  }

  const repoRoot = resolveRepoRoot();
  const sourcesDir = sourcesDirOf(repoRoot);

  // WRITE MODE: --status present. The adapter/registry is never consulted --
  // the operator's flags are the sole source of the recorded judgment.
  if (status !== undefined) {
    try {
      const result = await recordRightsAssessment({
        sourcesDir,
        sourceId,
        archive,
        status,
        basis: basis ?? '',
        jurisdiction,
        rightsRaw,
      });
      printAssessment(result.sourceId, result.sourceArchive, result.assessment, result.filePath);
      return 0;
    } catch (error) {
      console.error(`bib rights-assess: ${describeError(error)}`);
      return 1;
    }
  }

  // REVIEW MODE: no --status. Resolve + surface the adapter's proposed
  // evidence; write nothing.
  try {
    const selected = selectRecord(sourcesDir, sourceId, archive);
    const registry = await registryForRecord(selected);
    const result = await reviewRightsEvidence({
      sourcesDir,
      sourceId,
      archive,
      baseDir: repoRoot,
      registry,
    });
    printEvidence(result.sourceId, result.sourceArchive, result.evidence);
    return 0;
  } catch (error) {
    console.error(`bib rights-assess: ${describeError(error)}`);
    return 1;
  }
}
