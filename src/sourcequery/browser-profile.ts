import os from 'node:os';
import path from 'node:path';

/**
 * The persistent Playwright profile directory the governed browser session
 * launches (`launchPersistentContext`). Single source of truth so both the
 * query client and the acquire adapter can name it in diagnostics without
 * importing Playwright. Kept identical to the value the session actually uses.
 */
export function defaultBrowserProfileDir(): string {
  return path.join(os.tmpdir(), 'corpus-gap-closure', 'browser-profile');
}

/**
 * The operator-facing remediation hint for a suspected stale-cookie WAF
 * re-challenge (TASK-44): a source that previously cleared the WAF suddenly
 * returns a challenge because the persistent profile replays a stale/expired
 * session cookie. Diagnostics ONLY — the tooling never flushes the session
 * automatically (operator decision); it tells the agent the likely cause and the
 * one-line fix.
 */
export function staleCookieHint(profileDir: string = defaultBrowserProfileDir()): string {
  return (
    'HINT: if a source that previously worked now returns a WAF challenge, the ' +
    'persistent browser profile may hold a stale/expired WAF session cookie forcing ' +
    'an immediate re-challenge (TASK-44). Fix: clear the profile and retry -- ' +
    `rm -rf ${profileDir}`
  );
}
