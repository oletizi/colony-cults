import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CoverageReport } from '@/bibliography/coverage/coverage-model';
import { loadCoverageReport } from '@/bibliography/coverage/load-coverage-report';

/**
 * T003: unit coverage for {@link loadCoverageReport}
 * (specs/008-coverage-web-view/contracts/load-coverage-report.md) -- the
 * build-time entry point that wraps the shipped loaders + projection
 * unchanged. Exercises the three guarantees the contract calls out: the
 * happy path over the committed bibliography (G-1), fail-loud propagation on
 * malformed SSOT (G-2), and an absent search log NOT being an error (G-3).
 */

const FIXTURES_SOURCES_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'fixtures',
  'coverage',
  'sources',
);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'load-coverage-report-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('loadCoverageReport: happy path over the committed bibliography', () => {
  it('returns a well-formed CoverageReport including the live PB-P004 campaign', () => {
    const report = loadCoverageReport();

    expect(report).toHaveProperty('perCampaign');
    expect(report).toHaveProperty('evidenceClassDistribution');
    expect(report).toHaveProperty('register');
    expect(report).toHaveProperty('searchHistory');
    expect(Array.isArray(report.perCampaign)).toBe(true);

    const pb004 = report.perCampaign.find((campaign) => campaign.campaign === 'PB-P004');
    expect(pb004).toBeDefined();
  });
});

describe('loadCoverageReport: fail-loud on malformed data', () => {
  it('throws rather than returning a partial report when a source is malformed', () => {
    const sourcesDir = path.join(dir, 'bibliography', 'sources');
    mkdirSync(sourcesDir, { recursive: true });
    // Matches the loader's SOURCE_FILE_PATTERN/sourceId-stem rules by name,
    // but omits the required `titles` field (rule 2) -- loadAllSources fails
    // loud on this, and that failure must propagate unchanged.
    writeFileSync(
      path.join(sourcesDir, 'PB-999.yml'),
      `
sourceId: PB-999
kind: monograph
`,
      'utf-8',
    );
    writeFileSync(path.join(dir, 'bibliography', 'search-log.yml'), '[]\n', 'utf-8');

    expect(() => loadCoverageReport(dir)).toThrow();
  });
});

describe('loadCoverageReport: absent search log is not an error', () => {
  it('does not throw and returns an empty searchHistory.matrix when search-log.yml is absent', () => {
    const sourcesDir = path.join(dir, 'bibliography', 'sources');
    mkdirSync(sourcesDir, { recursive: true });
    cpSync(FIXTURES_SOURCES_DIR, sourcesDir, { recursive: true });
    // No bibliography/search-log.yml written -- loadSearchLog's documented
    // "none logged yet" case.

    let report: CoverageReport | undefined;
    expect(() => {
      report = loadCoverageReport(dir);
    }).not.toThrow();
    expect(report?.searchHistory.matrix).toEqual([]);
  });
});
