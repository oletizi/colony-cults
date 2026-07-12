import { describe, it, expect } from 'vitest';
import { warmUrls } from '@/pdf/publish/warm';
import type { HttpGet, HttpResponse } from '@/archive/public-cache';

/** A fake HTTP GET driven by a per-url outcome map: 'ok' | 'fail' | 'throw'. */
function fakeHttpGet(
  outcomes: Map<string, 'ok' | 'fail' | 'throw'>,
  calls: string[] = [],
): HttpGet {
  return async (url: string): Promise<HttpResponse> => {
    calls.push(url);
    const outcome = outcomes.get(url);
    if (outcome === 'throw') {
      throw new Error(`network error fetching ${url}`);
    }
    if (outcome === 'fail') {
      return {
        ok: false,
        status: 403,
        statusText: 'download_cap_exceeded',
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  };
}

describe('warmUrls — best-effort, non-fatal CDN warm (G-9/FR-015)', () => {
  it('all-OK: every url lands in warmed, none in failed', async () => {
    const urls = [
      'https://cdn.example/a.pdf',
      'https://cdn.example/b.pdf',
      'https://cdn.example/c.pdf',
    ];
    const outcomes = new Map<string, 'ok' | 'fail' | 'throw'>(
      urls.map((u) => [u, 'ok']),
    );
    const calls: string[] = [];

    const result = await warmUrls(urls, { httpGet: fakeHttpGet(outcomes, calls) });

    expect(result.warmed).toEqual(urls);
    expect(result.failed).toEqual([]);
    expect(calls).toEqual(urls);
  });

  it('a mix of 403 and thrown error: both land in failed with reasons; others warmed; never throws', async () => {
    const okUrl = 'https://cdn.example/ok.pdf';
    const capUrl = 'https://cdn.example/cap-exceeded.pdf';
    const throwUrl = 'https://cdn.example/network-error.pdf';
    const urls = [okUrl, capUrl, throwUrl];
    const outcomes = new Map<string, 'ok' | 'fail' | 'throw'>([
      [okUrl, 'ok'],
      [capUrl, 'fail'],
      [throwUrl, 'throw'],
    ]);

    const result = await warmUrls(urls, { httpGet: fakeHttpGet(outcomes) });

    expect(result.warmed).toEqual([okUrl]);
    expect(result.failed).toHaveLength(2);
    const capFailure = result.failed.find((f) => f.url === capUrl);
    const throwFailure = result.failed.find((f) => f.url === throwUrl);
    expect(capFailure).toBeDefined();
    expect(capFailure?.reason).toMatch(/403|download_cap_exceeded/);
    expect(throwFailure).toBeDefined();
    expect(throwFailure?.reason).toMatch(/network error/);
  });

  it('does not throw even when every url fails', async () => {
    const urls = ['https://cdn.example/x.pdf', 'https://cdn.example/y.pdf'];
    const outcomes = new Map<string, 'ok' | 'fail' | 'throw'>([
      [urls[0] as string, 'fail'],
      [urls[1] as string, 'throw'],
    ]);

    await expect(
      warmUrls(urls, { httpGet: fakeHttpGet(outcomes) }),
    ).resolves.toEqual({
      warmed: [],
      failed: [
        { url: urls[0], reason: expect.stringContaining('403') },
        { url: urls[1], reason: expect.stringContaining('network error') },
      ],
    });
  });

  it('logs per-url progress via opts.log when provided', async () => {
    const urls = ['https://cdn.example/logged.pdf'];
    const outcomes = new Map<string, 'ok' | 'fail' | 'throw'>([
      [urls[0] as string, 'ok'],
    ]);
    const lines: string[] = [];

    await warmUrls(urls, {
      httpGet: fakeHttpGet(outcomes),
      log: (m) => lines.push(m),
    });

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).toContain(urls[0]);
  });

  it('empty url list resolves to empty results without invoking httpGet', async () => {
    const calls: string[] = [];
    const result = await warmUrls([], {
      httpGet: fakeHttpGet(new Map(), calls),
    });
    expect(result).toEqual({ warmed: [], failed: [] });
    expect(calls).toEqual([]);
  });
});
