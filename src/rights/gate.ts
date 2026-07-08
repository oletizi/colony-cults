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

/** True when `value` is one of the recognized public-domain markers. */
function isPublicDomainValue(value: string): boolean {
  return PUBLIC_DOMAIN_VALUES.has(value.trim().toLowerCase());
}

/**
 * Fail-closed public-domain determination: true ONLY when there is at least
 * one recognized public-domain value AND *every* `dc:rights` value present is
 * a recognized public-domain marker.
 *
 * A record carrying BOTH "domaine public" and "in copyright" is therefore
 * treated as NOT public-domain -- copyright uncertainty must block mirroring,
 * so any unrecognized/restrictive value poisons the whole determination. An
 * empty `dc:rights` set is likewise not public-domain (no affirmative marker).
 */
function isPublicDomain(dcRights: string[]): boolean {
  if (dcRights.length === 0) {
    return false;
  }
  return dcRights.every(isPublicDomainValue);
}

/** Render the observed rights values for a descriptive error/refusal. */
function describeObserved(dcRights: string[]): string {
  if (dcRights.length === 0) {
    return '<no dc:rights present>';
  }
  return dcRights.map((value) => JSON.stringify(value)).join(', ');
}

/**
 * Resolve an issue's rights from its OAIRecord WITHOUT deciding whether to
 * download. Returns a fully-populated {@link Rights} (status + raw response +
 * parsed values) and never throws on an `other`/absent status -- so dry-run
 * reporting can surface the status of every issue, including non-public-domain
 * ones, before {@link assertPublicDomain} would refuse it.
 */
export async function resolveRights(
  issueArk: string,
  client: OaiRecordClient,
): Promise<Rights> {
  const { rawResponse, dcRights } = await client.oaiRights(issueArk);
  const status: Rights['status'] = isPublicDomain(dcRights)
    ? 'public-domain'
    : 'other';
  return { ark: issueArk, status, rawResponse, dcRights };
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
  const rights = await resolveRights(issueArk, client);

  if (rights.status !== 'public-domain') {
    throw new Error(
      `rights gate: issue ${issueArk} is not confirmed public-domain ` +
        `(observed dc:rights: ${describeObserved(rights.dcRights)}); ` +
        `refusing to download anything`,
    );
  }

  return rights;
}
