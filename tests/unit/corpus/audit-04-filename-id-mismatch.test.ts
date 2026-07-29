import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { validateCorpora, type InstalledCapabilities } from '@/corpus/validate';
import { allocateMemberId } from '@/sourcegroup/id-alloc';

/**
 * AUDIT-04 REGRESSION — the allocator reads FILENAMES, the validator reads
 * DECLARED IDs, and nothing compared the two.
 *
 * `@/sourcegroup/id-alloc`'s `nextCandidate` scans `<prefix><digits>.yml`
 * FILENAMES for the highest used suffix. `@/corpus/validate-existing-data`'s
 * `nextIdFindings` predicts the same number from the DECLARED `sourceId`s.
 * The two agree only while every file's basename equals its declared id --
 * which nothing checked.
 *
 * The fixture is the minimal divergence: `AL002.yml` declares `AL003`.
 *   - declared ids are {AL001, AL003} -> the validator predicts next = AL004,
 *     sees it free, and reports NOTHING;
 *   - filenames are {AL001.yml, AL002.yml} -> the allocator computes max = 2
 *     and mints AL003, whose `wx` exclusive-create SUCCEEDS because no file by
 *     that NAME exists.
 *
 * Two records now declare AL003, and `duplicate-source-id` fires only on the
 * NEXT validation run -- after the bytes have landed. The gate has to close
 * before the write, so the mismatch itself is the finding.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CORPORA = path.join(REPO_ROOT, 'tests', 'fixtures', 'corpora', 'validate-filename-mismatch');
const SOURCES = path.join(REPO_ROOT, 'tests', 'fixtures', 'sources', 'validate-filename-mismatch');

const NO_CAPABILITIES: InstalledCapabilities = { repositories: [], sourceQueries: [] };

let scratch: string;

beforeAll(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'audit-04-'));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('AUDIT-04 — filename vs declared sourceId', () => {
  it('reports source-filename-id-mismatch, naming the file and both ids', () => {
    const result = validateCorpora(CORPORA, SOURCES, NO_CAPABILITIES);

    const mismatch = result.findings.filter((f) => f.rule === 'source-filename-id-mismatch');
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0].subject).toBe('AL003');
    expect(mismatch[0].message).toContain('AL002.yml');
    expect(mismatch[0].message).toContain('AL003.yml');
    expect(result.ok).toBe(false);
  });

  it('THE MECHANISM: without that rule the allocator mints the colliding id', async () => {
    // Reproduces the hazard the rule exists to gate. The allocator reads
    // filenames, so it never sees the AL003 already declared inside AL002.yml.
    const dir = path.join(scratch, 'alloc');
    cpSync(SOURCES, dir, { recursive: true });

    const allocated = await allocateMemberId(
      dir,
      { prefix: 'AL', padWidth: 3 },
      (id) => `sourceId: ${id}\ncase: alpha-case\nkind: monograph\n`,
    );

    // The `wx` claim succeeds -- nothing named AL003.yml existed -- so the
    // repository now holds two records declaring AL003.
    expect(allocated).toBe('AL003');
  });

  it('stays silent on a sources dir where every basename matches its declared id', () => {
    const clean = validateCorpora(
      path.join(REPO_ROOT, 'tests', 'fixtures', 'corpora', 'validate-valid'),
      path.join(REPO_ROOT, 'tests', 'fixtures', 'sources', 'validate-valid'),
      { repositories: ['gallica', 'papers-past'], sourceQueries: ['papers-past'] },
    );

    expect(clean.findings.filter((f) => f.rule === 'source-filename-id-mismatch')).toEqual([]);
  });
});
