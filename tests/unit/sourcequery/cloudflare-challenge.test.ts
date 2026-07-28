import { describe, expect, it } from 'vitest';
import {
  looksLikeCloudflareChallenge,
  cloudflareChallengeCleared,
} from '@/sourcequery/cloudflare-challenge';

// The SRCH-0033 interstitial shape: the cdn-cgi challenge-platform script +
// the "Just a moment..." title, served under HTTP 403.
const CF_INTERSTITIAL =
  '<!DOCTYPE html><html><head><title>Just a moment...</title>' +
  '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=abc"></script>' +
  '</head><body><div class="main-wrapper"><noscript>Enable JavaScript and cookies to continue' +
  '</noscript></div><script>window._cf_chl_opt={cRay:"abc"};</script></body></html>';

const CLEARED_RESULTS_PAGE =
  '<html><body><div class="results"><h3>CONVICTION OF MARQUIS DE RAYS</h3></div></body></html>';

// An Incapsula interstitial — a DIFFERENT WAF that must NOT match the
// Cloudflare-specific predicate (it is handled unchanged elsewhere).
const INCAPSULA_INTERSTITIAL =
  '<html><head><script src="/_Incapsula_Resource?SWJIYLWA=x"></script></head>' +
  '<body>Request unsuccessful. Incapsula incident ID: 123-456</body></html>';

describe('looksLikeCloudflareChallenge', () => {
  it('is true for a Cloudflare managed-challenge interstitial served under 403', () => {
    expect(looksLikeCloudflareChallenge(CF_INTERSTITIAL, 403)).toBe(true);
  });

  it('is true under a null status (goto resolved null on the interstitial)', () => {
    expect(looksLikeCloudflareChallenge(CF_INTERSTITIAL, null)).toBe(true);
  });

  it('is true under 503 (the other status Cloudflare serves the interstitial under)', () => {
    expect(looksLikeCloudflareChallenge(CF_INTERSTITIAL, 503)).toBe(true);
  });

  it('is FALSE for a 200 page even if it bears a residual cf marker (already solved)', () => {
    const solvedWithResidualScript =
      '<html><body>real content<script>cf-chl residue</script></body></html>';
    expect(looksLikeCloudflareChallenge(solvedWithResidualScript, 200)).toBe(false);
  });

  it('is FALSE for a normal results page', () => {
    expect(looksLikeCloudflareChallenge(CLEARED_RESULTS_PAGE, 200)).toBe(false);
  });

  it('is FALSE for an Incapsula interstitial (Cloudflare-specific, not broad WAF)', () => {
    expect(looksLikeCloudflareChallenge(INCAPSULA_INTERSTITIAL, 403)).toBe(false);
  });
});

describe('cloudflareChallengeCleared', () => {
  it('is false while the active challenge markers are still present', () => {
    expect(cloudflareChallengeCleared(CF_INTERSTITIAL)).toBe(false);
  });

  it('is true once the challenge markers are gone (auto-reloaded to real content)', () => {
    expect(cloudflareChallengeCleared(CLEARED_RESULTS_PAGE)).toBe(true);
  });
});
