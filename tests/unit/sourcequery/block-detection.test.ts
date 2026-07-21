import { describe, it, expect } from 'vitest';
import { classify } from '@/sourcequery/block-detection';
import type { PageResult, QuerySummary } from '@/sourcequery/types';
import type { SourceConfig } from '@/sourcequery/source-config';
import { DEFAULT_GRACE } from '@/sourcequery/source-config';
import { parse } from 'node-html-parser';

/**
 * Minimal, real SourceConfig fixture. `resultSelector` anchors block-detection;
 * `parseSummary` counts `.result` children inside the `.results` container.
 */
function makeConfig(): SourceConfig {
  return {
    id: 'fixture',
    baseUrl: 'https://fixture.test',
    buildQueryUrl: (query: string) => `https://fixture.test/search?q=${encodeURIComponent(query)}`,
    resultSelector: '.results',
    parseSummary: (html: string): QuerySummary => {
      const root = parse(html);
      const container = root.querySelector('.results');
      const rows = container ? container.querySelectorAll('.result') : [];
      return {
        count: rows.length,
        candidates: rows.map((row) => ({ title: row.text.trim(), ref: '' })),
      };
    },
    retention: 'persist',
    attribution: 'Fixture source',
    minIntervalMs: 1000,
    grace: DEFAULT_GRACE,
  };
}

function page(overrides: Partial<PageResult>): PageResult {
  return {
    status: 200,
    html: '',
    snapshotMarkdown: '',
    errored: false,
    ...overrides,
  };
}

const RESULTS_TWO = '<html><body><div class="results"><div class="result">A</div><div class="result">B</div></div></body></html>';
const RESULTS_ZERO = '<html><body><div class="results"></div></body></html>';

describe('sourcequery/block-detection classify', () => {
  it('classifies HTTP 403 as a status block', () => {
    const result = classify(page({ status: 403, html: RESULTS_TWO }), makeConfig());
    expect(result).toEqual({ outcome: 'block', kind: 'status', detail: 'HTTP 403' });
  });

  it('classifies HTTP 429 as a status block', () => {
    const result = classify(page({ status: 429, html: RESULTS_TWO }), makeConfig());
    expect(result).toEqual({ outcome: 'block', kind: 'status', detail: 'HTTP 429' });
  });

  it('classifies HTTP 500 (5xx) as a status block', () => {
    const result = classify(page({ status: 500, html: RESULTS_TWO }), makeConfig());
    expect(result).toEqual({ outcome: 'block', kind: 'status', detail: 'HTTP 500' });
  });

  it('classifies HTTP 503 (5xx) as a status block', () => {
    const result = classify(page({ status: 503, html: RESULTS_ZERO }), makeConfig());
    expect(result).toEqual({ outcome: 'block', kind: 'status', detail: 'HTTP 503' });
  });

  it('classifies an errored navigation as a drop block', () => {
    const result = classify(page({ errored: true, status: null, html: '' }), makeConfig());
    expect(result.outcome).toBe('block');
    if (result.outcome === 'block') {
      expect(result.kind).toBe('drop');
      expect(result.detail.length).toBeGreaterThan(0);
    }
  });

  it('classifies an Incapsula challenge fingerprint (no result container) as a challenge block', () => {
    const html = '<html><body>Incapsula incident ID: 1234-5678</body></html>';
    const result = classify(page({ status: 200, html }), makeConfig());
    expect(result.outcome).toBe('block');
    if (result.outcome === 'block') {
      expect(result.kind).toBe('challenge');
      expect(result.detail).toContain('Incapsula incident ID');
    }
  });

  it('classifies a Cloudflare "Just a moment" challenge (no container) as a challenge block', () => {
    const html = '<html><head><title>Just a moment...</title></head><body>cf-chl</body></html>';
    const result = classify(page({ status: 200, html }), makeConfig());
    expect(result.outcome).toBe('block');
    if (result.outcome === 'block') {
      expect(result.kind).toBe('challenge');
      expect(result.detail).toContain('Just a moment');
    }
  });

  it('matches challenge fingerprints case-insensitively', () => {
    const html = '<html><body>REQUEST UNSUCCESSFUL. please retry.</body></html>';
    const result = classify(page({ status: 200, html }), makeConfig());
    expect(result.outcome).toBe('block');
    if (result.outcome === 'block') {
      expect(result.kind).toBe('challenge');
      expect(result.detail).toContain('Request unsuccessful');
    }
  });

  it('matches the automatic/redirect/challenge triad', () => {
    const html = '<html><body>You will be redirected via an automatic challenge shortly.</body></html>';
    const result = classify(page({ status: 200, html }), makeConfig());
    expect(result.outcome).toBe('block');
    if (result.outcome === 'block') {
      expect(result.kind).toBe('challenge');
    }
  });

  it('does NOT treat a challenge fingerprint as a block when the result container is present', () => {
    // A page that both mentions a fingerprint string AND rendered the real container.
    const html = '<html><body><div class="results"><div class="result">Incapsula incident ID mention in a result</div></div></body></html>';
    const result = classify(page({ status: 200, html }), makeConfig());
    expect(result.outcome).toBe('result');
  });

  it('classifies a rendered container with rows as a result', () => {
    const result = classify(page({ status: 200, html: RESULTS_TWO }), makeConfig());
    expect(result).toEqual({ outcome: 'result' });
  });

  it('classifies a rendered container with zero rows as a legitimate empty', () => {
    const result = classify(page({ status: 200, html: RESULTS_ZERO }), makeConfig());
    expect(result).toEqual({ outcome: 'empty' });
  });

  it('throws when there is no positive block signal and no result container', () => {
    const html = '<html><body><p>Some unrelated page with no container and no fingerprint.</p></body></html>';
    expect(() => classify(page({ status: 200, html }), makeConfig())).toThrow(/could not be classified/i);
  });
});
