/**
 * Resolve the TitlePageMeta *catalog* fields -- creator, catalogUrl, and the
 * source-level ark -- from the bibliography SSOT
 * (`bibliography/sources/<sourceId>.yml`, via `@/bibliography`), for the PDF
 * Edition builder's front matter (T011, spec 007).
 *
 * Fail-loud posture is deliberately ASYMMETRIC (data-model.md G-4): the SSOT
 * file being unreadable/malformed still throws (via `loadSourceFile`), because
 * the front matter cannot be assembled without the source record at all; but
 * the individual catalog fields are OPTIONAL -- creator/catalogUrl/ark may each
 * be `null` and render as an em dash. Catalog completeness is not this
 * feature's job, so their absence is honest, not an error.
 */

import path from 'node:path';

import { loadSourceFile } from '@/bibliography/load';

/**
 * The catalog fields the front matter draws from the bibliography SSOT. Each is
 * independently nullable (G-4): a `null` means the SSOT omits it, never an
 * error.
 */
export interface SourceCatalogMeta {
  /** Author/editor of the work (`Source.creator`), or `null` if the SSOT omits it. */
  creator: string | null;
  /** Catalog / landing-page URL (`RepositoryRecord.catalogUrl`), or `null` if none is recorded. */
  catalogUrl: string | null;
  /** Source-level ark (`RepositoryRecord.identifiers[type='ark']`), or `null` if none is recorded. */
  ark: string | null;
}

/**
 * Reads the SSOT catalog fields for one source. Injected into the Edition
 * builder so the unit test can supply a pure stub (no filesystem).
 */
export interface SourceMetaReader {
  /**
   * @throws Error only if the SSOT file for `sourceId` is unreadable/malformed
   *   (via `loadSourceFile`); never throws merely because a catalog field is
   *   absent -- absent fields come back `null`.
   */
  read(sourceId: string): SourceCatalogMeta;
}

/** Normalize an optional authored string to a non-empty value or `null`. */
function nonEmptyOrNull(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Build the concrete SSOT-backed reader. `repoRoot` is the repo root that holds
 * `bibliography/sources/` (resolve via `@/browser/load/repo-root`'s
 * `resolveRepoRoot()` at the wiring site).
 */
export function makeSourceMetaReader(repoRoot: string): SourceMetaReader {
  return {
    read(sourceId: string): SourceCatalogMeta {
      const filePath = path.join(repoRoot, 'bibliography', 'sources', `${sourceId}.yml`);
      const { source, records } = loadSourceFile(filePath);

      const creator = nonEmptyOrNull(source.creator);

      // First record carrying a catalog URL wins (records are authored in
      // preference order); absence is not an error.
      const catalogUrl =
        records.map((record) => nonEmptyOrNull(record.catalogUrl)).find((url) => url !== null) ??
        null;

      // Source-level ark: the first copy-level `ark` identifier across the
      // source's repository records; absence is not an error.
      const ark =
        records
          .flatMap((record) => record.identifiers ?? [])
          .filter((identifier) => identifier.type === 'ark')
          .map((identifier) => nonEmptyOrNull(identifier.value))
          .find((value) => value !== null) ?? null;

      return { creator, catalogUrl, ark };
    },
  };
}
