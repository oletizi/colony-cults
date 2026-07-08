import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { findIssueDir } from '@/archive/location';
import { readProvenance } from '@/archive/provenance';
import { companionYamlPath } from '@/archive/store';

/**
 * The rights determination + citation needed to gate/label a translation run
 * for one issue (data-model.md "Validation rules": refuse unless
 * `rights_status === 'public-domain'`; citation carried into each translated
 * artifact's provenance).
 */
export interface IssueRights {
  /** Rights determination copied from the source page provenance. */
  rights_status: string;
  /** Original-language citation, carried from the source page provenance. */
  citation: {
    title: string;
    catalog_url: string;
    language: string;
  };
}

/**
 * Zero-padded page-image filenames (`f001.jpg`), in page order. Mirrors
 * `gatherPageImages` in `src/ocr/run.ts` so both offline consumers of a
 * fetched issue agree on what "the first page" means.
 */
async function firstPageImageName(issueDir: string): Promise<string> {
  const entries = await readdir(issueDir);
  const pages = entries.filter((name) => /^f\d{3}\.jpg$/.test(name)).sort();
  if (pages.length === 0) {
    throw new Error(
      `readIssueRights: no page images (f###.jpg) found in ${issueDir} -- fetch its images first`,
    );
  }
  return pages[0];
}

/**
 * Read an issue's rights determination + citation OFFLINE, purely from what
 * the fetcher already wrote to disk (research.md R3): locate the issue
 * directory via {@link findIssueDir} (no census, no network), then read the
 * companion YAML of the first page image (page order, `f001.jpg` before
 * `f002.jpg`, ...) via {@link readProvenance}. The rights gate already ran at
 * fetch time (`@/rights/gate`); this never re-queries Gallica.
 *
 * Fails loud -- no fallback, no default -- when the issue has never been
 * fetched, has no page images, or the first page has no companion provenance
 * YAML.
 */
export async function readIssueRights(
  sourceId: string,
  issueArk: string,
  archiveRoot: string,
): Promise<IssueRights> {
  const issueDir = findIssueDir(sourceId, issueArk, archiveRoot);
  const firstPage = await firstPageImageName(issueDir);
  const yamlPath = companionYamlPath(path.join(issueDir, firstPage));

  if (!existsSync(yamlPath)) {
    throw new Error(
      `readIssueRights: no page provenance found at "${yamlPath}" for issue ` +
        `"${issueArk}" -- fetch its images first`,
    );
  }

  const fields = await readProvenance(yamlPath);

  return {
    rights_status: fields.rights_status,
    citation: {
      title: fields.title,
      catalog_url: fields.catalog_url,
      language: fields.language,
    },
  };
}
