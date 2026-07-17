import { describe, it, expect } from 'vitest';

import { parseRightsAssessArgs, runRightsAssessCli } from '@/cli/bib-rights-assess';

/**
 * Tests for `bib rights-assess`'s CLI wiring (T018): the pure argv parsing,
 * and the synchronous fail-loud branch that returns before any filesystem/
 * network access. The FULL review/write paths are exercised at the
 * `@/rights/assess` level (`reviewRightsEvidence`/`recordRightsAssessment`
 * tests), mirroring how sibling CLI verbs are tested (e.g.
 * `@/cli/bib-inventory.test`).
 */

describe('parseRightsAssessArgs', () => {
  it('parses a bare review-mode invocation (no --status)', () => {
    const parsed = parseRightsAssessArgs(['PB-M001']);
    expect(parsed.sourceId).toBe('PB-M001');
    expect(parsed.status).toBeUndefined();
    expect(parsed.basis).toBeUndefined();
    expect(parsed.archive).toBeUndefined();
    expect(parsed.jurisdiction).toBeUndefined();
    expect(parsed.rightsRaw).toBeUndefined();
  });

  it('parses a write-mode invocation with all flags', () => {
    const parsed = parseRightsAssessArgs([
      'PB-M001',
      '--archive',
      'New Italy Museum',
      '--status',
      'public-domain',
      '--basis',
      'Photograph created before 1955',
      '--jurisdiction',
      'AU',
      '--rights-raw',
      '© New Italy Museum',
    ]);
    expect(parsed.archive).toBe('New Italy Museum');
    expect(parsed.status).toBe('public-domain');
    expect(parsed.basis).toBe('Photograph created before 1955');
    expect(parsed.jurisdiction).toBe('AU');
    expect(parsed.rightsRaw).toBe('© New Italy Museum');
  });

  it('throws (fail loud) on an unknown flag (strict parsing)', () => {
    expect(() => parseRightsAssessArgs(['PB-M001', '--bogus', 'x'])).toThrow();
  });
});

describe('runRightsAssessCli (synchronous fail-loud branches)', () => {
  it('returns exit code 2 when <sourceId> is missing', async () => {
    const code = await runRightsAssessCli([]);
    expect(code).toBe(2);
  });

  it('returns exit code 2 on an unknown flag', async () => {
    const code = await runRightsAssessCli(['PB-M001', '--bogus', 'x']);
    expect(code).toBe(2);
  });
});
