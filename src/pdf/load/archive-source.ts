/**
 * Resolve a source's archive directory and enumerate its folios into an
 * ordered page-source list -- the basis the per-page reader (T004) and the
 * edition assembler (T007) consume (spec 014, Decisions 2 + 3).
 *
 * Folio -> position mapping is BY SORTED ORDER, never by the folio's own
 * number: the 1st folio on disk (ascending by its numeric suffix) is always
 * `position` 1, the 2nd is `position` 2, etc. This is what makes a page-range
 * extract (e.g. folios `f048`, `f049`, `f050`) map correctly to `p001`,
 * `p002`, `p003` downstream, instead of the folio-number bug this feature
 * removes.
 */

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { enumerateIssueDirs } from '@/browser/load/issues';
import { monographDir, sourceLayout } from '@/archive/location';
import type { ProvenanceFields } from '@/archive/provenance';
import { readProvenance } from '@/archive/provenance';

/** Folio sidecar filename shape: `fNNN.yml` (digits preserve their zero-padding). */
const FOLIO_SIDECAR_PATTERN = /^f(\d+)\.yml$/;

/**
 * One page's source data, assembled from its folio sidecar. `position` is the
 * 1-based index in the source's own sorted folio sequence (the extract-safe
 * key downstream code derives `pNNN` from -- NOT the folio number).
 */
export interface ArchivePageSource {
  /** Folio id as it appears in the sidecar filename, e.g. `f048`. */
  folioId: string;
  /** 1-based index in the sorted folio list (the extract-safe ordering key). */
  position: number;
  /** The B2 object-store key of the image master (`object_store.key`). */
  objectStoreKey: string;
  /** SHA-256 of the image master (the folio sidecar's top-level `sha256`). */
  imageSha256: string;
  /** The source dir this folio (and its `translation/pNNN.*`) lives under. */
  pageDir: string;
}

/** One periodical issue's resolved directory + ordered folios. */
export interface ArchiveIssueSource {
  /** Stable issue slug, e.g. `1879-08-15_bpt6k56068358` (from `enumerateIssueDirs`). */
  issueId: string;
  /** Absolute path to the issue's archive directory. */
  pageDir: string;
  /** This issue's folios, ordered by position. */
  folios: ArchivePageSource[];
}

/** A resolved monograph source: one archive directory, one folio sequence. */
export interface MonographSourceResolution {
  sourceId: string;
  kind: 'monograph';
  /** Absolute path to the source's single archive directory. */
  pageDir: string;
  /** This source's folios, ordered by position. */
  folios: ArchivePageSource[];
}

/** A resolved periodical source: one archive directory per issue. */
export interface PeriodicalSourceResolution {
  sourceId: string;
  kind: 'periodical';
  /** The source's issues, in `enumerateIssueDirs` order (date, then ark). */
  issues: ArchiveIssueSource[];
}

/** The result of resolving a source to its archive directory/directories. */
export type ArchiveSourceResolution = MonographSourceResolution | PeriodicalSourceResolution;

/** Inputs to {@link resolveArchiveSource}. */
export interface ResolveArchiveSourceOptions {
  /** The bibliography source id, e.g. `PB-P054`. */
  sourceId: string;
  /** The already-resolved private archive root (see `resolveArchiveRoot`). */
  archiveRoot: string;
}

/** Non-empty trim, or `''` when absent/blank -- a small local helper for the two required fields. */
function trimmedOrEmpty(value: string | undefined): string {
  return value === undefined ? '' : value.trim();
}

/**
 * Enumerate one directory's folio sidecars into an ordered, provenance-backed
 * `ArchivePageSource[]`.
 *
 * @throws Error if `pageDir` has no folio sidecars, or if any folio's
 *   provenance is unreadable, or missing `object_store.key` / `sha256` --
 *   every error names the offending folio (and `sourceId`) so a fail-loud
 *   condition is immediately actionable.
 */
async function enumerateFolios(pageDir: string, sourceId: string): Promise<ArchivePageSource[]> {
  const entries = readdirSync(pageDir);
  const matches: Array<{ folioNum: number; folioId: string; fileName: string }> = [];
  for (const name of entries) {
    const match = FOLIO_SIDECAR_PATTERN.exec(name);
    if (match === null) {
      continue;
    }
    matches.push({ folioNum: Number(match[1]), folioId: `f${match[1]}`, fileName: name });
  }

  if (matches.length === 0) {
    throw new Error(
      `resolveArchiveSource: no folio sidecars ("fNNN.yml") found for source "${sourceId}" ` +
        `under ${pageDir}`,
    );
  }

  matches.sort((a, b) => a.folioNum - b.folioNum);

  const folios: ArchivePageSource[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const { folioId, fileName } = matches[index];
    const yamlPath = path.join(pageDir, fileName);

    let provenance: ProvenanceFields;
    try {
      provenance = await readProvenance(yamlPath);
    } catch (err) {
      throw new Error(
        `resolveArchiveSource: failed to read provenance for folio "${folioId}" of source ` +
          `"${sourceId}" (${yamlPath}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const objectStoreKey = trimmedOrEmpty(provenance.object_store?.key);
    if (objectStoreKey.length === 0) {
      throw new Error(
        `resolveArchiveSource: folio "${folioId}" of source "${sourceId}" (${yamlPath}) is ` +
          `missing object_store.key`,
      );
    }

    const imageSha256 = trimmedOrEmpty(provenance.sha256);
    if (imageSha256.length === 0) {
      throw new Error(
        `resolveArchiveSource: folio "${folioId}" of source "${sourceId}" (${yamlPath}) is ` +
          `missing sha256`,
      );
    }

    folios.push({
      folioId,
      position: index + 1,
      objectStoreKey,
      imageSha256,
      pageDir,
    });
  }
  return folios;
}

/** Resolve a monograph source: one archive directory, fully enumerated. */
async function resolveMonograph(
  sourceId: string,
  archiveRoot: string,
): Promise<MonographSourceResolution> {
  const pageDir = monographDir(sourceId, archiveRoot);
  if (!existsSync(pageDir)) {
    throw new Error(
      `resolveArchiveSource: monograph source "${sourceId}" has no archive directory at ${pageDir}`,
    );
  }
  const folios = await enumerateFolios(pageDir, sourceId);
  return { sourceId, kind: 'monograph', pageDir, folios };
}

/**
 * Resolve a periodical source's directory to per-issue folio sequences.
 * Reuses `enumerateIssueDirs` (never reimplemented) for the issue scan; the
 * per-issue directory is the same `<case>/<type>/<slug>/<date>_<ark>/` shape
 * `issueDir` writes.
 */
async function resolvePeriodical(
  sourceId: string,
  archiveRoot: string,
): Promise<PeriodicalSourceResolution> {
  const layout = sourceLayout(sourceId);
  const periodicalDir = path.join(
    archiveRoot,
    'archive',
    'cases',
    layout.case,
    layout.type,
    layout.slug,
  );
  if (!existsSync(periodicalDir)) {
    throw new Error(
      `resolveArchiveSource: periodical source "${sourceId}" has no archive directory at ` +
        `${periodicalDir}`,
    );
  }

  const issueDirs = enumerateIssueDirs(periodicalDir, sourceId);
  const issues: ArchiveIssueSource[] = [];
  for (const issue of issueDirs) {
    const folios = await enumerateFolios(issue.dir, sourceId);
    issues.push({ issueId: issue.issueId, pageDir: issue.dir, folios });
  }
  return { sourceId, kind: 'periodical', issues };
}

/**
 * Resolve a source to its archive directory(ies) and ordered folio
 * page-sources. Monographs resolve fully (one directory, one folio
 * sequence); periodicals resolve per-issue (reusing `enumerateIssueDirs`).
 *
 * @throws Error if the source has no registered archive layout
 *   (`sourceLayout`'s own throw surfaces unchanged), if its archive
 *   directory does not exist, if it has no folio sidecars, or if any
 *   folio's provenance is missing `object_store.key`/`sha256`.
 */
export async function resolveArchiveSource(
  opts: ResolveArchiveSourceOptions,
): Promise<ArchiveSourceResolution> {
  const { sourceId, archiveRoot } = opts;
  const layout = sourceLayout(sourceId);
  return layout.kind === 'monograph'
    ? resolveMonograph(sourceId, archiveRoot)
    : resolvePeriodical(sourceId, archiveRoot);
}
