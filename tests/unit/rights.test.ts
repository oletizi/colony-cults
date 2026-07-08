import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { HttpClient } from '@/gallica/http-client';
import { GallicaHttpClient } from '@/gallica/gallica-client';
import { assertPublicDomain, resolveRights } from '@/rights/gate';

const FIXTURES = path.resolve(__dirname, '../fixtures');

/**
 * Build a real GallicaHttpClient whose only outside dependency (fetch) is a
 * stub returning the given fixture body. This exercises the real URL
 * construction, the real XML parse, and the real rights gate -- no network.
 */
function clientReturning(fixtureBody: string): GallicaHttpClient {
  const http = new HttpClient({
    fetch: async () => new Response(fixtureBody, { status: 200 }),
    sleep: async () => {},
  });
  return new GallicaHttpClient(http);
}

describe('assertPublicDomain (rights gate, FR-004/FR-005)', () => {
  it('passes for a public-domain OAIRecord and captures the raw response', async () => {
    const body = readFileSync(
      path.join(FIXTURES, 'oairecord-bpt6k5603637g.xml'),
      'utf-8',
    );
    const rights = await assertPublicDomain(
      'bpt6k5603637g',
      clientReturning(body),
    );

    expect(rights.status).toBe('public-domain');
    expect(rights.ark).toBe('bpt6k5603637g');
    // FR-005: the full raw OAIRecord XML is retained verbatim.
    expect(rights.rawResponse).toBe(body);
    expect(rights.rawResponse).toContain('domaine public');
    expect(rights.dcRights.map((v) => v.toLowerCase())).toContain(
      'domaine public',
    );
    expect(rights.dcRights.map((v) => v.toLowerCase())).toContain(
      'public domain',
    );
  });

  it('THROWS and downloads nothing for a non-public-domain OAIRecord', async () => {
    const body = readFileSync(
      path.join(FIXTURES, 'oairecord-non-public-domain.xml'),
      'utf-8',
    );
    await expect(
      assertPublicDomain('bpt6k5603637g', clientReturning(body)),
    ).rejects.toThrow(/not confirmed public-domain|in copyright/i);
  });

  it('FAILS CLOSED on MIXED rights (public-domain AND in-copyright)', async () => {
    const body = readFileSync(
      path.join(FIXTURES, 'oairecord-mixed-rights.xml'),
      'utf-8',
    );
    const client = clientReturning(body);

    // Even though a "domaine public" marker is present, the co-occurring
    // "in copyright" value makes the overall rights ambiguous, so the gate
    // must BLOCK the download (copyright uncertainty blocks mirroring).
    await expect(assertPublicDomain('bpt6k5603637g', client)).rejects.toThrow(
      /not confirmed public-domain/i,
    );

    // The refusal names ALL observed rights values (both the PD markers and
    // the restrictive one) so the human sees why it was blocked.
    await expect(
      assertPublicDomain('bpt6k5603637g', client),
    ).rejects.toThrow(/in copyright/i);

    // resolveRights (dry-run reporting) classifies it as 'other', not
    // 'public-domain', while still capturing the raw response verbatim.
    const rights = await resolveRights('bpt6k5603637g', client);
    expect(rights.status).toBe('other');
    expect(rights.rawResponse).toBe(body);
    expect(rights.dcRights.map((v) => v.toLowerCase())).toContain('in copyright');
  });
});
