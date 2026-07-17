/**
 * Quickstart contract-scenario coverage matrix (T052,
 * specs/013-archiveorg-acquisition-path/quickstart.md, "Contract scenarios
 * the tests must cover"). That table maps each spec acceptance scenario to
 * an expected behavior; this file is the audit trail proving each row has a
 * real, still-present covering test -- not a restatement of the assertions
 * themselves (duplicating full fake-driven pipelines here would just be a
 * second, drifting copy of `acquire.test.ts`/`fidelity.test.ts`/etc).
 *
 * Each row below names the exact file + `it(...)` title that covers it, and
 * a `it()` in this file asserts that title is still present, verbatim, in
 * that file's source -- so if the covering test is ever renamed or deleted,
 * THIS file fails loud rather than silently going stale (Principle V).
 *
 * The "`--dry-run`" row is now fully covered: "no B2 write" and "staging
 * retained" have real covering tests, and the "no re-fetch next run" clause
 * (Principle XII / D-11) is satisfied by `stageFile`'s cache-first path --
 * an already-staged non-empty file is re-read from disk, so a dry-run examine
 * pass followed by the real acquire re-downloads nothing (behavioral proof in
 * `staging.test.ts`; this file confirms the cache logic is present).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'src', 'repository', 'internet-archive');

function source(fileName: string): string {
  return readFileSync(join(DIR, fileName), 'utf-8');
}

/** One quickstart row: the scenario, which file(s) cover it, and the `it()` title(s) to find there. */
interface CoverageRow {
  scenario: string;
  file: string;
  itTitles: readonly string[];
}

const FULLY_COVERED_ROWS: readonly CoverageRow[] = [
  {
    scenario: 'Resolve a real `texts` item (US1 / FR-002)',
    file: 'adapter.test.ts',
    itTitles: ['returns the ia-item identifier', 'returns the details page as sourceUrl'],
  },
  {
    scenario: 'Resolve ambiguous PDFs -- throws (US5 / FR-003 / SC-006)',
    file: 'adapter.test.ts',
    itTitles: [
      'throws when the item exposes two equally-eligible page-image PDFs',
      'throws when the item exposes only an OCR-only PDF (no page-image PDF)',
    ],
  },
  {
    scenario: 'Rights evidence only -- no rightsStatus/verdict (US3 / FR-004)',
    file: 'rights.test.ts',
    itTitles: ['never expresses a public-domain (or any other) rights verdict'],
  },
  {
    scenario: 'Acquire without public-domain -- throws before any fetch (US3 / FR-005 / SC-004)',
    file: 'acquire.test.ts',
    itTitles: [
      'throws for rightsStatus "${status}" and never touches the client',
      'throws when no rightsAssessment is present at all',
    ],
  },
  {
    scenario:
      'Quality gate `unsound` -- zero B2 bytes, staging retained (US2 / FR-008 / SC-002)',
    file: 'acquire.test.ts',
    itTitles: ['throws on an unsound assessment, writes nothing, and retains staging'],
  },
  {
    scenario: 'Staged-checksum mismatch -- throws (US2 / FR-008)',
    file: 'quality-gate.test.ts',
    itTitles: [
      'throws when a "sound" assessment carries a checksum that does not match the staged file',
    ],
  },
  {
    scenario: 'Fidelity: PDF equivalent -- PDF exploded, no image-set fetch (US5 / FR-009)',
    file: 'fidelity.test.ts',
    itTitles: ['returns source "pdf" when the median ratio is >= 0.90'],
  },
  {
    scenario: 'Fidelity: PDF degraded -- image-set fetched + used (US5 / FR-009)',
    file: 'fidelity.test.ts',
    itTitles: ['returns source "image-set" when the median ratio is < 0.90'],
  },
  {
    scenario: 'Page-to-leaf, single image -- method: pdfimages-lossless (US4 / FR-010)',
    file: 'extract.test.ts',
    itTitles: [
      'routes three single-covering leaves to lossless extraction with sourcePdfObject provenance',
    ],
  },
  {
    scenario:
      'Page-to-leaf, overlay page -- method: pdftoppm-rasterised at recorded DPI (US4 / FR-010)',
    file: 'extract.test.ts',
    itTitles: [
      'rasterises a multi-image leaf at native DPI (from scandata) and a zero-image leaf at the 400 fallback',
    ],
  },
  {
    scenario: 'Count != approved range -- throws (US4 / FR-010 / SC-005)',
    file: 'extract.test.ts',
    itTitles: [
      'throws (fail loud, SC-005) when an approved leaf is also flagged excluded and would be skipped',
    ],
  },
  {
    scenario:
      'Excluded leaves -- absent from page-masters, present in source PDF, recorded (US4 / FR-011 / SC-003)',
    file: 'extract.test.ts',
    itTitles: [
      'omits out-of-range excluded leaves from pages and records them with classification + a non-"discarded" reason',
    ],
  },
  {
    scenario: 'Idempotent re-acquire -- already-stored assets skipped, no duplicate (US1 / INV-E)',
    file: 'acquire.test.ts',
    itTitles: [
      'skips PUT when the object already exists with a matching checksum',
      'throws when a keyed object exists with a mismatched checksum (remote change)',
    ],
  },
  {
    scenario: 'Dispatch by copy type -- ia-item -> this adapter only (INV-D / IA-INV-G)',
    file: '../registry.test.ts',
    itTitles: [
      'dispatches a record with an ia-item identifier to the internet-archive adapter',
      'preserves existing ark and accession dispatch when internet-archive adapter is registered',
    ],
  },
];

describe('Quickstart contract-scenario matrix -- fully covered rows', () => {
  it.each(FULLY_COVERED_ROWS)('$scenario -- covered by $file', (row) => {
    const text = source(row.file);
    for (const title of row.itTitles) {
      expect(text).toContain(title);
    }
  });
});

describe('Quickstart contract-scenario matrix -- `--dry-run` (XII / D-11): partial coverage, reported', () => {
  it('covers "no B2 write" and "staging retained"', () => {
    const text = source('acquire.test.ts');
    expect(text).toContain(
      'performs no PUT, retains staging, and reports incomplete with no assets',
    );
  });

  it('covers "no re-fetch next run" -- `stageFile` reuses an already-staged file (Principle XII / D-11)', () => {
    // `stageFile` (`@/repository/internet-archive/staging.ts`) now checks for an
    // already-staged non-empty file at `destPath` (the XII cache path) and re-reads
    // its bytes WITHOUT calling `client.getBytes` -- so a `--dry-run` examine pass
    // followed by the real acquire (or two dry runs in a row) re-downloads NOTHING.
    // The behavioral proof lives in `staging.test.ts` (reuse skips getBytes); this
    // row just confirms the cache logic is present in the source.
    const stagingSource = source('staging.ts');
    expect(stagingSource).toMatch(/readStagedFile|await stat\(destPath\)/);
    expect(source('staging.test.ts')).toMatch(/re-?read|reuse|cache|already[- ]staged/i);
  });
});
