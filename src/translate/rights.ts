import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { resolveFetchedDir } from '@/archive/location';
import { readProvenance } from '@/archive/provenance';

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
 * Absolute path to the first page's provenance companion YAML (`f001.yml`,
 * before `f002.yml`, ...), in page order.
 *
 * We scan the `f###.yml` companions DIRECTLY rather than deriving them from the
 * `f###.jpg` images: the archive's object-store migration moves page images to
 * external storage and REMOVES the local `.jpg` files while KEEPING the
 * `f###.yml` companions in git. Reading rights must therefore not depend on a
 * local image being present -- only on its persistent provenance companion.
 *
 * Exported so `translateIssue`'s base-provenance path reuses the SAME scan:
 * both consumers of "the first page" must stay object-store-robust together.
 */
export async function firstPageProvenanceYaml(issueDir: string): Promise<string> {
  const entries = await readdir(issueDir);
  const companions = entries
    .filter((name) => /^f\d{3}\.yml$/.test(name))
    .sort();
  if (companions.length === 0) {
    throw new Error(
      `readIssueRights: no page provenance (f###.yml) found in ${issueDir} -- fetch the issue first`,
    );
  }
  return path.join(issueDir, companions[0]);
}

/**
 * Read an issue's rights determination + citation OFFLINE, purely from what
 * the fetcher already wrote to disk (research.md R3): locate the issue
 * directory via {@link resolveFetchedDir} (no census, no network; periodical
 * -> `findIssueDir`, monograph -> `monographDir`), then read the
 * first page's provenance companion YAML (page order, `f001.yml` before
 * `f002.yml`, ...) via {@link readProvenance}. The rights gate already ran at
 * fetch time (`@/rights/gate`); this never re-queries Gallica. Reading the
 * `.yml` companion (not the `.jpg` image) keeps this robust to the object-store
 * image migration, which removes local images but keeps their companions.
 *
 * Fails loud -- no fallback, no default -- when the issue has never been
 * fetched or has no page provenance companion YAML.
 */
export async function readIssueRights(
  sourceId: string,
  issueArk: string,
  archiveRoot: string,
): Promise<IssueRights> {
  const issueDir = resolveFetchedDir(sourceId, issueArk, archiveRoot);
  const yamlPath = await firstPageProvenanceYaml(issueDir);

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
