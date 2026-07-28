/**
 * Cloudflare managed-challenge predicates (spec 2026-07-21).
 *
 * Pure, Playwright-free content probes used by the browser session's settle
 * loop to decide (a) whether a page is a Cloudflare MANAGED-challenge
 * interstitial worth dwelling on, and (b) whether that challenge has since
 * cleared. Deliberately NARROWER than block-detection's
 * `looksLikeWafChallenge`: only Cloudflare's self-solving managed challenge
 * (which a real browser can wait out) matches here. Incapsula/Anubis are
 * intentionally excluded so their handling stays unchanged.
 */

/**
 * Active Cloudflare managed-challenge content markers (case-insensitive).
 * Any one present ⇒ the page carries an active Cloudflare challenge.
 * These are Cloudflare-specific on purpose — no Incapsula/Anubis strings.
 */
const CHALLENGE_MARKERS: readonly string[] = [
  'cdn-cgi/challenge-platform',
  'challenges.cloudflare.com',
  'cf-chl',
  '_cf_chl_opt',
  'just a moment',
];

/** True when `html` carries any active Cloudflare managed-challenge marker. */
function hasChallengeMarker(html: string): boolean {
  const lower = html.toLowerCase();
  return CHALLENGE_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * HTTP statuses a Cloudflare managed-challenge interstitial is served under:
 * 403, 503, or `null` (a `goto` that resolved null on the interstitial). A
 * `200` is NOT a challenge status — a solved page can carry a residual marker.
 */
function isChallengeStatus(status: number | null): boolean {
  return status === null || status === 403 || status === 503;
}

/**
 * True when the page is a Cloudflare managed-challenge interstitial worth
 * dwelling on: an active challenge marker AND a challenge-consistent status.
 * The status gate keeps an already-solved 200 (which may retain a residual
 * challenge script) from spuriously entering the settle loop.
 */
export function looksLikeCloudflareChallenge(html: string, status: number | null): boolean {
  return isChallengeStatus(status) && hasChallengeMarker(html);
}

/**
 * True when a page that WAS a Cloudflare challenge no longer shows the active
 * challenge markers — i.e. the managed challenge self-solved and the page
 * auto-reloaded to real content. The settle loop polls this to detect
 * resolution.
 */
export function cloudflareChallengeCleared(html: string): boolean {
  return !hasChallengeMarker(html);
}
