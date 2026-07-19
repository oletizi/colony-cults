/**
 * CLI wiring for `bib inventory` (T017-T020, specs/006-source-group-
 * acquisition + specs/011-museum-acquisition-path). Extracted from
 * `src/cli/bib-sourcegroup.ts` to keep both files under the project's
 * file-size guideline (same rationale that module's own header documents for
 * its own extraction from `src/cli/bibliography.ts`).
 *
 * Branches on `--repository`: absent (or explicitly `gallica`) drives the
 * ORIGINAL ark-oriented path (the real Gallica OAIRecord resolver,
 * `@/sourcegroup/inventory`'s `runInventory`) UNCHANGED -- no regression
 * (US2/SC-003). Any other registered repository name (`new-italy-museum`,
 * `internet-archive`) routes a RAW locator (never an ark) through the real
 * `RepositoryAdapterRegistry`/`RepositoryAdapter` seam to
 * `@/sourcegroup/museum-inventory`'s `runMuseumInventory` instead -- by the
 * adapter/registry contract, never a locator-shape sniff (INV-D). Despite its
 * name (kept for the museum path it was authored for), `runMuseumInventory`
 * is itself repository-agnostic (it takes a `RepositoryName` and dispatches
 * via `registry.selectByName`), so the Internet Archive path (T028) reuses it
 * unchanged, differing only in which resolve-only adapter this module builds.
 */

import { parseArgs as nodeParseArgs } from 'node:util';

import { describeError } from '@/bibliography/load-primitives';
import { GallicaHttpClient } from '@/gallica/gallica-client';
import { HttpClient } from '@/gallica/http-client';
import { gallicaArkMetadataResolver } from '@/sourcegroup/gallica-ark-resolver';
import { NewItalyMuseumAdapter } from '@/repository/new-italy-museum/adapter';
import { createMusarchExtractor } from '@/repository/new-italy-museum/extractor';
import { InternetArchiveAdapter } from '@/repository/internet-archive/adapter';
import { PapersPastAdapter } from '@/repository/papers-past/adapter';
import { RepositoryAdapterRegistry } from '@/repository/registry';
import type { RepositoryAdapter, RepositoryName } from '@/repository/adapter';
import { runInventory } from '@/sourcegroup/inventory';
import { runMuseumInventory } from '@/sourcegroup/museum-inventory';
import { resolveRepoRoot, sourcesDirOf } from '@/cli/bib-sourcegroup-paths';
import { PlaywrightBrowserSession } from '@/sourcequery/browser-session-playwright';

/** Narrow the `--kind` flag to the member-kind union (never `source-group`). */
function asMemberKind(value: string | undefined): 'monograph' | 'periodical' | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'monograph' || value === 'periodical') {
    return value;
  }
  throw new Error(`--kind must be "monograph" or "periodical" (got "${value}")`);
}

/**
 * Narrow the raw `--repository` flag to a known {@link RepositoryName}, or
 * `undefined` when the flag is absent. Fails loud on anything else -- an
 * unrecognized repository name is never silently accepted or sniffed from
 * the locator's shape (specs/011-museum-acquisition-path contracts/cli.md:
 * "The registry returns exactly one adapter or fails loud"). `internet-
 * archive` (specs/013-archiveorg-acquisition-path, T028) joins `new-italy-
 * museum` on the non-Gallica branch below.
 */
function asRepositoryName(value: string | undefined): RepositoryName | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'gallica' || value === 'new-italy-museum' || value === 'internet-archive' || value === 'papers-past') {
    return value;
  }
  throw new Error(
    `--repository must be "gallica", "new-italy-museum", "internet-archive", or "papers-past" (got "${value}")`,
  );
}

/** Typed result of parsing `bib inventory`'s argv (see {@link parseInventoryArgs}). */
export interface InventoryCliArgs {
  locator: string | undefined;
  group: string | undefined;
  /** Raw `--kind` value, validated per-branch below (museum vs Gallica accept different vocabularies). */
  kindRaw: string | undefined;
  archive: string | undefined;
  dryRun: boolean;
  repository: RepositoryName | undefined;
}

/**
 * Parse `bib inventory <locator> --group <id> [--repository <name>] [--kind]
 * [--archive] [--dry-run]`'s argv into typed flags. Exported so this parsing
 * (including the `--repository` narrowing) is directly unit-testable without
 * driving either the real Gallica OAIRecord client or the museum adapter's
 * engine-backed extractor.
 */
export function parseInventoryArgs(rest: string[]): InventoryCliArgs {
  const { values, positionals } = nodeParseArgs({
    args: rest,
    options: {
      group: { type: 'string' },
      kind: { type: 'string' },
      archive: { type: 'string' },
      repository: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: true,
  });
  return {
    locator: positionals[0],
    group: values.group,
    kindRaw: values.kind,
    archive: values.archive,
    dryRun: Boolean(values['dry-run']),
    repository: asRepositoryName(values.repository),
  };
}

/**
 * Build the RESOLVE-ONLY adapter for `bib inventory --repository <name>`,
 * keyed by the requested {@link RepositoryName}. Neither branch constructs an
 * `ObjectStore` / requires B2 credentials or a poppler toolchain -- `resolve`
 * never touches object storage or staging (see each adapter's own
 * constructor-DI doc comment): `bib inventory --repository` only catalogues;
 * `bib acquire` (a separate, later step) is what mirrors bytes.
 */
async function buildResolveOnlyAdapter(repository: RepositoryName): Promise<RepositoryAdapter> {
  if (repository === 'new-italy-museum') {
    const extractor = await createMusarchExtractor();
    return new NewItalyMuseumAdapter({ client: new HttpClient(), extractor });
  }
  if (repository === 'internet-archive') {
    return new InternetArchiveAdapter({ client: new HttpClient() });
  }
  if (repository === 'papers-past') {
    // Resolve-only: no objectStore. The browser session both reads the page
    // and (at acquire, not here) fetches image bytes inside the WAF-cleared
    // context (research.md R1); resolve never fetches bytes.
    return new PapersPastAdapter({
      browserSession: new PlaywrightBrowserSession(),
    });
  }
  throw new Error(
    `bib inventory: no resolve-only adapter is defined for repository "${repository}"`,
  );
}

/**
 * `--repository`-routed branch of `bib inventory` (T017,
 * specs/011-museum-acquisition-path; extended T028,
 * specs/013-archiveorg-acquisition-path): resolves a RAW repository locator
 * (a Musarch item-page URL, or an archive.org item id -- never an ark)
 * through the real {@link RepositoryAdapterRegistry}/{@link
 * buildResolveOnlyAdapter}, then delegates to `runMuseumInventory` (itself
 * repository-agnostic; see this module's header).
 */
async function runMuseumInventoryCli(args: {
  locator: string;
  group: string;
  archive: string | undefined;
  dryRun: boolean;
  repository: RepositoryName;
  repoRoot: string;
  sourcesDir: string;
}): Promise<number> {
  const { locator, group, archive, dryRun, repository, repoRoot, sourcesDir } = args;
  try {
    const adapter = await buildResolveOnlyAdapter(repository);
    const registry = new RepositoryAdapterRegistry([adapter]);

    if (dryRun) {
      const item = await registry
        .selectByName(repository)
        .resolve({ repository, value: locator }, {});
      console.log(
        `bib inventory (dry-run): would create an archival-item member of "${group}" from ${locator}; wrote nothing`,
      );
      console.log(`  repository: ${repository}`);
      for (const identifier of item.identifiers) {
        console.log(`  identifier (${identifier.type}): ${identifier.value}`);
      }
      console.log(`  sourceUrl: ${item.sourceUrl}`);
      return 0;
    }

    const result = await runMuseumInventory({
      locator,
      repository,
      groupId: group,
      archive,
      sourcesDir,
      baseDir: repoRoot,
      registry,
    });
    console.log(`bib inventory: created ${result.sourceId} (status: discovered, record: wanted)`);
    console.log(`  sourceArchive: ${result.record.sourceArchive}`);
    console.log(`  snapshot: ${result.snapshot.path}`);
    return 0;
  } catch (error) {
    console.error(`bib inventory: ${describeError(error)}`);
    return 1;
  }
}

/**
 * `bib inventory <locator> --group <id> [--repository <name>] [--kind]
 * [--archive] [--dry-run]`.
 *
 * Branches on `--repository`: absent (or explicitly `gallica`) keeps the
 * ORIGINAL ark-oriented behavior UNCHANGED (no regression, US2/SC-003); any
 * other registered repository name (`new-italy-museum`, `internet-archive`)
 * routes the RAW locator through {@link runMuseumInventoryCli} instead -- the
 * adapter/registry seam, never a locator-shape sniff (INV-D).
 */
export async function runInventoryCli(rest: string[]): Promise<number> {
  let parsed: InventoryCliArgs;
  try {
    parsed = parseInventoryArgs(rest);
  } catch (error) {
    console.error(`bib inventory: ${describeError(error)}`);
    return 2;
  }
  const { locator, group, kindRaw, archive, dryRun, repository } = parsed;

  if (locator === undefined) {
    console.error('bib inventory: missing required argument <locator>');
    return 2;
  }
  if (group === undefined) {
    console.error('bib inventory: missing required flag --group <group-id>');
    return 2;
  }

  const repoRoot = resolveRepoRoot();
  const sourcesDir = sourcesDirOf(repoRoot);

  if (repository !== undefined && repository !== 'gallica') {
    // The museum path always creates an `archival-item` member; `--kind
    // archival-item` (shown in the CLI contract) is accepted as a
    // confirmation, but any OTHER value is a mismatch worth failing loud on
    // rather than silently overriding.
    if (kindRaw !== undefined && kindRaw !== 'archival-item') {
      console.error(
        `bib inventory: --kind must be "archival-item" for --repository "${repository}" ` +
          `(got "${kindRaw}")`,
      );
      return 2;
    }
    return runMuseumInventoryCli({ locator, group, archive, dryRun, repository, repoRoot, sourcesDir });
  }

  let kind: 'monograph' | 'periodical' | undefined;
  try {
    kind = asMemberKind(kindRaw);
  } catch (error) {
    console.error(`bib inventory: ${describeError(error)}`);
    return 2;
  }

  // GALLICA (not the BnF general-catalogue SRU): the acquisition targets are
  // Gallica digital documents (`bpt6k` arks), which the catalogue SRU does
  // not index -- see @/sourcegroup/gallica-ark-resolver.
  const resolveArk = gallicaArkMetadataResolver(new GallicaHttpClient(new HttpClient()));

  try {
    if (dryRun) {
      const metadata = await resolveArk(locator);
      if (metadata === null) {
        throw new Error(`ark "${locator}" could not be resolved -- nothing would be created`);
      }
      const sourceArchive = archive ?? metadata.archive;
      console.log(
        `bib inventory (dry-run): would create a member of "${group}" from ${locator}; wrote nothing`,
      );
      console.log(`  kind: ${kind ?? 'monograph'}`);
      console.log(`  sourceArchive: ${sourceArchive ?? '(none -- pass --archive <name>)'}`);
      for (const title of metadata.titles) {
        console.log(`  title (${title.role}): ${title.text}`);
      }
      if (metadata.rightsRaw !== undefined) {
        console.log(`  rightsRaw: ${metadata.rightsRaw}`);
      }
      return 0;
    }

    const result = await runInventory({
      ark: locator,
      groupId: group,
      kind,
      archive,
      sourcesDir,
      baseDir: repoRoot,
      resolveArk,
    });
    console.log(`bib inventory: created ${result.sourceId} (status: discovered, record: wanted)`);
    console.log(`  sourceArchive: ${result.record.sourceArchive}`);
    console.log(`  snapshot: ${result.snapshot.path}`);
    if (!result.acquirable) {
      console.log('  note: rights are not public-domain -- not yet acquirable (US1 scenario 5)');
    }
    return 0;
  } catch (error) {
    console.error(`bib inventory: ${describeError(error)}`);
    return 1;
  }
}
