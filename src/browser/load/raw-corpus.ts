/**
 * The archive reader (corpus-loader contract, image-UNRESOLVED half). Reads the
 * local archive clone + bibliography SSOT and returns the serializable
 * {@link CorpusSnapshot} (raw text + metadata + image handles) -- it does NOT
 * resolve image URLs. `resolveImages` (`src/browser/load/resolve-images.ts`)
 * turns the snapshot into the rendered {@link CorpusView}; both the fresh
 * archive read and the committed-snapshot read converge there.
 *
 * Pure and fail-loud: any missing or inconsistent corpus datum throws (naming
 * source / issue / page) rather than substituting a placeholder (G-1..G-4); it
 * reads only the local clone + public handles (G-5); and it is deterministic
 * given the same clone + config (G-6).
 *
 * See specs/005-corpus-browser/contracts/corpus-loader.md and
 * specs/005-corpus-browser/data-model.md.
 */

import path from 'node:path';

import type {
  CorpusSnapshot,
  RawIssue,
  RawPage,
  RawSource,
  SkippedIssue,
  SourceKind,
} from '@/browser/model';
import { loadSourceFile } from '@/bibliography/load';
import type { LoadedSource } from '@/bibliography/load';
import type { CopyIdentifier } from '@/model/repository-record';
import { enumerateIssueDirs, resolveNewspapersDir } from '@/browser/load/issues';
import type { IssueDir } from '@/browser/load/issues';
import { resolveMonographUnit } from '@/browser/load/books';
import { buildRawIssuePages, detectNotCollected } from '@/browser/load/pages';

/** The holding-archive label whose record carries the source-level Gallica ark. */
const GALLICA_ARCHIVE_LABEL = 'Gallica / BnF';

/**
 * Reads the raw (image-unresolved) corpus for `sources` from the archive clone
 * at `archivePath`, using the committed bibliography SSOT under `repoRoot`.
 *
 * Renders every COMPLETE issue and REPORTS (never silently drops) the ones it
 * skips: a not-collected/incomplete issue is recorded as a {@link SkippedIssue}
 * and reported via `console.warn`; a collected-but-corrupt issue still THROWS.
 *
 * @throws Error on any collected-but-corrupt issue or unresolvable source --
 *   never returns partial or placeholder page data.
 */
export function readRawCorpus(
  archivePath: string,
  sources: string[],
  repoRoot: string
): CorpusSnapshot {
  if (sources.length === 0) {
    throw new Error('readRawCorpus: sources is empty -- at least one source id is required.');
  }

  const skipped: SkippedIssue[] = [];

  // Source order follows input order (deterministic in -> deterministic out).
  const rawSources = sources.map((sourceId) => {
    const loaded = loadSource(archivePath, repoRoot, sourceId);
    skipped.push(...loaded.skipped);
    return loaded.source;
  });

  return {
    sources: rawSources,
    skipped,
    generatedFrom: { sourceIds: [...sources], note: 'read from archive clone via readRawCorpus' },
  };
}

/** A loaded source's raw view plus the issues skipped while loading it. */
interface LoadedRawSource {
  source: RawSource;
  skipped: SkippedIssue[];
}

function loadSource(
  archivePath: string,
  repoRoot: string,
  sourceId: string
): LoadedRawSource {
  const ssotPath = path.join(repoRoot, 'bibliography', 'sources', `${sourceId}.yml`);
  const loaded = loadSourceFile(ssotPath);
  const { source } = loaded;

  const title = canonicalTitle(loaded);

  // Resolve the source -> unit-dirs step by SSOT kind. A periodical resolves
  // to its many issue directories (via the census-derived newspapers dir); a
  // monograph resolves to exactly ONE unit -- its book directory (scanned +
  // matched by folio-sidecar id). Everything downstream (per-page load,
  // rights) reuses unchanged. A `source-group` holds no assets of its own and
  // is not a loadable corpus kind.
  let kind: SourceKind;
  let ark: string;
  let issueDirs: IssueDir[];
  if (source.kind === 'periodical') {
    kind = 'periodical';
    ark = sourceArk(loaded);
    const newspapersDir = resolveNewspapersDir(archivePath, loaded);
    issueDirs = enumerateIssueDirs(newspapersDir, sourceId);
  } else if (source.kind === 'monograph') {
    kind = 'monograph';
    // The book's ark is the source ark (the minimal monograph SSOT carries no
    // ark identifier -- it is read from the matched folio sidecar instead).
    const bookUnit = resolveMonographUnit(archivePath, loaded);
    ark = bookUnit.ark;
    issueDirs = [bookUnit];
  } else {
    throw new Error(
      `loadCorpus(${sourceId}): source kind "${source.kind}" is not a loadable corpus kind ` +
        '(expected "periodical" or "monograph").'
    );
  }

  const issues: RawIssue[] = [];
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
    issues.push(buildRawIssue(sourceId, issueDir, issues.length));
  }

  const rights = deriveRights(sourceId, issues);

  return {
    source: {
      sourceId,
      title,
      kind,
      ark,
      rights,
      issues,
    },
    skipped,
  };
}

function buildRawIssue(sourceId: string, issueDir: IssueDir, index: number): RawIssue {
  const pages = buildRawIssuePages(sourceId, issueDir);
  return {
    issueId: issueDir.issueId,
    date: issueDir.date,
    sequence: index + 1,
    pages,
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
function deriveRights(sourceId: string, issues: RawIssue[]): string {
  const pages: RawPage[] = issues.flatMap((issue) => issue.pages);
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
