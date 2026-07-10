/**
 * The corpus loader (corpus-loader contract). Reads the local archive clone +
 * bibliography SSOT and returns the normalized {@link CorpusView} the Astro
 * site renders. Pure and fail-loud: any missing or inconsistent corpus datum
 * throws (naming source / issue / page) rather than substituting a placeholder
 * (G-1..G-4); it reads only the local clone + public handles (G-5); and it is
 * deterministic given the same clone + config (G-6).
 *
 * See specs/005-corpus-browser/contracts/corpus-loader.md and
 * specs/005-corpus-browser/data-model.md.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LoadConfig } from '@/browser/config';
import type {
  CorpusView,
  IssueView,
  LoadResult,
  PageView,
  SkippedIssue,
  SourceView,
} from '@/browser/model';
import { loadSourceFile } from '@/bibliography/load';
import type { LoadedSource } from '@/bibliography/load';
import type { CopyIdentifier } from '@/model/repository-record';
import { makeProvider } from '@/browser/providers/provider';
import type { ImageSourceProvider } from '@/browser/providers/provider';
import { enumerateIssueDirs, resolveNewspapersDir } from '@/browser/load/issues';
import type { IssueDir } from '@/browser/load/issues';
import { buildIssuePages, detectNotCollected } from '@/browser/load/pages';

/** The holding-archive label whose record carries the source-level Gallica ark. */
const GALLICA_ARCHIVE_LABEL = 'Gallica / BnF';

/**
 * Loads and normalizes the corpus described by `config`.
 *
 * Renders every COMPLETE issue and REPORTS (never silently drops) the ones it
 * skips (TASK-9). Each scanned issue directory is classified into exactly one
 * of three buckets:
 *
 *  - complete -> loaded fully into the {@link CorpusView};
 *  - not-collected / incomplete (a WHOLE required layer entirely absent) ->
 *    SKIPPED, recorded as a {@link SkippedIssue}, and reported via
 *    `console.warn` (no silent caps);
 *  - collected-but-corrupt (a PRESENT layer internally inconsistent) -> still
 *    THROWS, naming source / issue / page.
 *
 * @throws Error on any collected-but-corrupt issue or unresolvable source --
 *   never returns partial or placeholder page data.
 */
export function loadCorpus(config: LoadConfig): LoadResult {
  if (config.sources.length === 0) {
    throw new Error('loadCorpus: config.sources is empty -- at least one source id is required.');
  }

  const repoRoot = resolveRepoRoot();
  const provider = makeProvider(config.provider);

  const skipped: SkippedIssue[] = [];

  // Source order follows config order (deterministic input -> deterministic
  // output: corpus-loader G-6).
  const sources = config.sources.map((sourceId) => {
    const loaded = loadSource(config.archivePath, repoRoot, sourceId, provider);
    skipped.push(...loaded.skipped);
    return loaded.view;
  });

  return { corpus: { sources }, skipped };
}

/** Resolves the repo root (containing `bibliography/sources/`) from this module's location. */
function resolveRepoRoot(): string {
  const here = fileURLToPath(import.meta.url);
  // src/browser/load/corpus.ts -> up three -> repo root.
  return path.resolve(path.dirname(here), '..', '..', '..');
}

/** A loaded source's normalized view plus the issues skipped while loading it. */
interface LoadedSourceResult {
  view: SourceView;
  skipped: SkippedIssue[];
}

function loadSource(
  archivePath: string,
  repoRoot: string,
  sourceId: string,
  provider: ImageSourceProvider
): LoadedSourceResult {
  const ssotPath = path.join(repoRoot, 'bibliography', 'sources', `${sourceId}.yml`);
  const loaded = loadSourceFile(ssotPath);
  const { source } = loaded;

  if (source.kind !== 'periodical') {
    throw new Error(
      `loadCorpus(${sourceId}): source kind "${source.kind}" is not supported in v1 ` +
        '(only "periodical").'
    );
  }

  const title = canonicalTitle(loaded);
  const ark = sourceArk(loaded);

  const newspapersDir = resolveNewspapersDir(archivePath, loaded);
  const issueDirs = enumerateIssueDirs(newspapersDir, sourceId);

  const issues: IssueView[] = [];
  const skipped: SkippedIssue[] = [];

  for (const issueDir of issueDirs) {
    // Pre-check the whole-layer-absent conditions BEFORE the per-page load
    // (which throws on any present-but-partial layer). A not-collected issue
    // is skipped and reported; only a collected-but-corrupt one throws.
    const reason = detectNotCollected(issueDir.dir);
    if (reason !== null) {
      // eslint-disable-next-line no-console -- deliberate build-visible skip report (no silent caps).
      console.warn(`loadCorpus(${sourceId}): SKIP issue ${issueDir.issueId} -- ${reason}`);
      skipped.push({ issueId: issueDir.issueId, sourceId, reason });
      continue;
    }
    // sequence numbers are contiguous over the LOADED (complete) issues.
    issues.push(buildIssue(sourceId, issueDir, issues.length, provider));
  }

  const rights = deriveRights(sourceId, issues);

  return {
    view: {
      sourceId,
      title,
      kind: 'periodical',
      ark,
      rights,
      issues,
    },
    skipped,
  };
}

function buildIssue(
  sourceId: string,
  issueDir: IssueDir,
  index: number,
  provider: ImageSourceProvider
): IssueView {
  const pages = buildIssuePages(sourceId, issueDir, provider);
  return {
    issueId: issueDir.issueId,
    date: issueDir.date,
    sequence: index + 1,
    pages,
    pageCount: pages.length,
  };
}

/** The canonical title (SSOT `titles[role=canonical]`, else the first title). */
function canonicalTitle(loaded: LoadedSource): string {
  const { source } = loaded;
  const canonical = source.titles.find((t) => t.role === 'canonical') ?? source.titles[0];
  if (canonical === undefined || canonical.text.trim().length === 0) {
    throw new Error(`loadCorpus(${source.sourceId}): source has no usable title.`);
  }
  return canonical.text;
}

/** The source-level archival identifier (the Gallica record's `ark` copy identifier). */
function sourceArk(loaded: LoadedSource): string {
  const { source, records } = loaded;
  const gallicaRecord = records.find((r) => r.sourceArchive === GALLICA_ARCHIVE_LABEL);
  if (gallicaRecord === undefined) {
    throw new Error(
      `loadCorpus(${source.sourceId}): no "${GALLICA_ARCHIVE_LABEL}" repository record -- ` +
        'cannot resolve the source ark.'
    );
  }

  const arkIdentifier = (gallicaRecord.identifiers ?? []).find(
    (id: CopyIdentifier) => id.type === 'ark'
  );
  const ark = arkIdentifier?.value.trim();
  if (!ark) {
    throw new Error(
      `loadCorpus(${source.sourceId}): "${GALLICA_ARCHIVE_LABEL}" record has no ark identifier ` +
        '(required for the source-iiif provider).'
    );
  }
  return ark;
}

/**
 * Derives the source-level rights from its pages' provenance (the sidecar
 * `rights_status`), requiring every page to agree -- there is no default
 * (G-4). Throws if the source has no pages or the rights are inconsistent.
 */
function deriveRights(sourceId: string, issues: IssueView[]): string {
  const pages: PageView[] = issues.flatMap((issue) => issue.pages);
  if (pages.length === 0) {
    throw new Error(
      `loadCorpus(${sourceId}): source resolved to zero pages -- cannot determine rights.`
    );
  }

  const rights = pages[0].provenance.rights;
  for (const page of pages) {
    if (page.provenance.rights !== rights) {
      throw new Error(
        `loadCorpus(${sourceId}): inconsistent rights across pages -- ` +
          `${JSON.stringify(rights)} vs ${JSON.stringify(page.provenance.rights)} ` +
          `(page ${page.pageId}).`
      );
    }
  }
  return rights;
}
