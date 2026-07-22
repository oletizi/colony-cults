/**
 * LIVE smoke: exercise the governed client against loc.gov's Cloudflare-fronted
 * Chronicling America collection end-to-end. SKIPPED unless CORPUS_LIVE_SMOKE=1.
 *
 * A PASS confirms navigate()'s Cloudflare settle actually clears the managed
 * challenge and grounds a real result count. A FAILURE is ACCEPTABLE and is NOT
 * a build gate: Cloudflare may hard-loop this environment's IP regardless of a
 * correct client (spec Risks — IP reputation). Never add this to CI.
 */
import { describe, expect, it } from 'vitest';
import { PlaywrightBrowserSession } from '@/sourcequery/browser-session-playwright';
import { getSourceConfig } from '@/sourcequery/source-config';

describe.skipIf(process.env.CORPUS_LIVE_SMOKE !== '1')(
  'LIVE: chronicling-america Cloudflare clearing',
  () => {
    it('clears the loc.gov managed challenge and grounds a result count for "Marquis de Rays"', async () => {
      const config = getSourceConfig('chronicling-america');
      const session = new PlaywrightBrowserSession();
      await session.open();
      try {
        const url = config.buildQueryUrl('Marquis de Rays');
        const page = await session.navigate(url);
        // The settled page must NOT be the 403 challenge: either a real results
        // page (status 200) or an honest classifiable page. Assert we got past
        // the interstitial.
        expect(page.errored).toBe(false);
        expect(page.status).not.toBe(403);
        expect(page.html.toLowerCase()).not.toContain('cdn-cgi/challenge-platform');
      } finally {
        await session.close();
      }
    }, 60000);
  },
);
