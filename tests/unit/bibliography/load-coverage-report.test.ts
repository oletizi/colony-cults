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

/** The repository's real committed manifests (`<repoRoot>/corpora`). */
const REAL_CORPORA_ROOT = path.resolve(__dirname, '..', '..', '..', 'corpora');

/**
 * Seed a temp repoRoot with the committed corpus manifests. Since T023
 * (FR-018) `loadCoverageReport` derives its Source-filename policy from the
 * manifests under `<repoRoot>/corpora` -- a repo root with none cannot say
 * which files are Sources and fails loud rather than enumerating nothing.
 */
function seedCorpora(repoRoot: string): void {
  cpSync(REAL_CORPORA_ROOT, path.join(repoRoot, 'corpora'), { recursive: true });
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'load-coverage-report-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('loadCoverageReport: happy path over the committed bibliography', () => {
  it('returns a well-formed CoverageReport including the live PB-P004 work-bundle', () => {
    const report = loadCoverageReport();

    expect(report).toHaveProperty('perWorkBundle');
    expect(report).toHaveProperty('evidenceClassDistribution');
    expect(report).toHaveProperty('register');
    expect(report).toHaveProperty('searchHistory');
    expect(Array.isArray(report.perWorkBundle)).toBe(true);

    const pb004 = report.perWorkBundle.find((wb) => wb.workBundle === 'PB-P004');
    expect(pb004).toBeDefined();
  });
});

describe('loadCoverageReport: fail-loud on malformed data', () => {
  it('throws rather than returning a partial report when a source is malformed', () => {
    const sourcesDir = path.join(dir, 'bibliography', 'sources');
    mkdirSync(sourcesDir, { recursive: true });
    seedCorpora(dir);
    // Matches the corpus's Source-filename policy + the sourceId-stem rule by
    // name, but omits the required `titles` field (rule 2) -- loadAllSources
    // fails loud on this, and that failure must propagate unchanged.
    writeFileSync(
      path.join(sourcesDir, 'PB-P999.yml'),
      `
sourceId: PB-P999
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
    seedCorpora(dir);
    // No bibliography/search-log.yml written -- loadSearchLog's documented
    // "none logged yet" case.

    let report: CoverageReport | undefined;
    expect(() => {
      report = loadCoverageReport(dir);
    }).not.toThrow();
    expect(report?.searchHistory.matrix).toEqual([]);
  });
});
