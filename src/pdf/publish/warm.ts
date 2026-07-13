/**
 * Best-effort, NON-fatal CDN warm of freshly-published URLs (spec 008,
 * contract guarantee G-9 / FR-015).
 *
 * A warm/verify read is a download-capped class of request: a `403
 * download_cap_exceeded` response, any other non-OK response, or a thrown
 * network error is a routine, EXPECTED outcome here, not a bug. Each such
 * outcome is CAUGHT and recorded in `failed` with a reason -- `warmUrls`
 * itself never throws. The recorded publication stands regardless of whether
 * the warm succeeds (the caller must not treat a warm failure as grounds to
 * roll back or refuse the publish).
 */

import { defaultHttpGet, type HttpGet } from '@/archive/public-cache';

/** One warm failure: the url that failed and a human-readable reason. */
export interface WarmFailure {
  url: string;
  reason: string;
}

/** Outcome of a {@link warmUrls} call. */
export interface WarmResult {
  /** URLs that returned an OK response. */
  warmed: string[];
  /** URLs that returned a non-OK response or threw, with a reason each. */
  failed: WarmFailure[];
}

/** Options for {@link warmUrls} (all injectable; real `fetch` by default). */
export interface WarmUrlsOptions {
  /** Anonymous HTTP GET (default {@link defaultHttpGet}). */
  httpGet?: HttpGet;
  /** Optional line-oriented progress sink. */
  log?: (message: string) => void;
}

/**
 * GET each of `urls` via the injected `httpGet`, best-effort. A non-OK
 * response or a thrown error is caught and recorded in `failed` with a
 * reason; it MUST NOT propagate out of this function (the warm is
 * deliberately non-fatal -- see module doc / G-9).
 */
export async function warmUrls(
  urls: string[],
  opts: WarmUrlsOptions = {},
): Promise<WarmResult> {
  const httpGet = opts.httpGet ?? defaultHttpGet;

  const warmed: string[] = [];
  const failed: WarmFailure[] = [];

  for (const url of urls) {
    try {
      const response = await httpGet(url);
      if (response.ok) {
        opts.log?.(`  warm  OK    ${url}`);
        warmed.push(url);
      } else {
        const reason = `${response.status} ${response.statusText}`;
        opts.log?.(`  warm  FAIL  ${url} (${reason})`);
        failed.push({ url, reason });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      opts.log?.(`  warm  FAIL  ${url} (${reason})`);
      failed.push({ url, reason });
    }
  }

  return { warmed, failed };
}
