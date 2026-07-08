import type { Rights } from '@/model/rights';
import type { OaiRecordClient } from '@/gallica/gallica-client';

/**
 * The only `dc:rights` values Gallica uses to assert an item is public-domain.
 * Compared case-insensitively after trimming. The IIIF manifest `license`
 * field is deliberately NOT consulted (FR-004 requires the per-item rights
 * metadata endpoint).
 */
const PUBLIC_DOMAIN_VALUES: ReadonlySet<string> = new Set([
  'domaine public',
  'public domain',
]);

/** True when at least one `dc:rights` value asserts the public domain. */
function isPublicDomain(dcRights: string[]): boolean {
  return dcRights.some((value) =>
    PUBLIC_DOMAIN_VALUES.has(value.trim().toLowerCase()),
  );
}

/** Render the observed rights values for a descriptive error/refusal. */
function describeObserved(dcRights: string[]): string {
  if (dcRights.length === 0) {
    return '<no dc:rights present>';
  }
  return dcRights.map((value) => JSON.stringify(value)).join(', ');
}

/**
 * The rights gate (FR-004/FR-005): resolve an issue's rights from its
 * OAIRecord and permit a download ONLY when a `dc:rights` value confirms the
 * public domain.
 *
 * On any other or absent status this THROWS a descriptive Error naming the ark
 * and the observed rights values, and downloads nothing. The full raw
 * OAIRecord XML is always captured in the returned {@link Rights.rawResponse}
 * (and, for the refusal case, is fetched but no asset is written).
 *
 * It does NOT consult the IIIF manifest license field.
 */
export async function assertPublicDomain(
  issueArk: string,
  client: OaiRecordClient,
): Promise<Rights> {
  const { rawResponse, dcRights } = await client.oaiRights(issueArk);
  const status: Rights['status'] = isPublicDomain(dcRights)
    ? 'public-domain'
    : 'other';

  const rights: Rights = { ark: issueArk, status, rawResponse, dcRights };

  if (status !== 'public-domain') {
    throw new Error(
      `rights gate: issue ${issueArk} is not confirmed public-domain ` +
        `(observed dc:rights: ${describeObserved(dcRights)}); ` +
        `refusing to download anything`,
    );
  }

  return rights;
}
