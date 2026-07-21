import { describe, expect, it } from 'vitest';
import { looksLikeWafChallenge } from '@/sourcequery/block-detection';
import { defaultBrowserProfileDir, staleCookieHint } from '@/sourcequery/browser-profile';

describe('looksLikeWafChallenge', () => {
  it('is true for an Incapsula challenge interstitial', () => {
    const html =
      '<html><head><meta name="ROBOTS" content="NOINDEX, NOFOLLOW">' +
      '<script src="/_Incapsula_Resource?SWJIYLWA=x"></script></head>' +
      '<body>Request unsuccessful. Incapsula incident ID: 123-456</body></html>';
    expect(looksLikeWafChallenge(html)).toBe(true);
  });

  it('is true for the automatic/redirect/challenge triad (case-insensitive)', () => {
    expect(looksLikeWafChallenge('You will be AUTOMATICALLY REDIRECTED after the challenge.')).toBe(true);
  });

  it('is false for a normal (non-challenge) page', () => {
    expect(
      looksLikeWafChallenge('<html><body><h3>CONVICTION OF MARQUIS DE RAYS</h3><p>Paris...</p></body></html>'),
    ).toBe(false);
  });
});

describe('staleCookieHint', () => {
  it('names the profile path and the rm -rf remediation and TASK-44', () => {
    const hint = staleCookieHint();
    expect(hint).toContain(defaultBrowserProfileDir());
    expect(hint).toContain('rm -rf');
    expect(hint).toContain('TASK-44');
  });

  it('uses an injected profile dir when given one', () => {
    expect(staleCookieHint('/tmp/custom-profile')).toContain('rm -rf /tmp/custom-profile');
  });
});
