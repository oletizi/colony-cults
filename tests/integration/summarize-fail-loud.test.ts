import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProvenance, writeProvenance } from '@/archive/provenance';
import { summarizeIssue, type SummarizeIssueCtx } from '@/summarize/issue';
import {
  issueConciseSummaryPath,
  issueThoroughSummaryPath,
} from '@/summarize/artifacts';
import type { SummarizationRunner } from '@/summarize/types';
import type { LoadedSource } from '@/bibliography/load';

/** An English-native Gallica source, so the no-usable-text path names both files. */
function englishSource(): LoadedSource {
  return {
    source: {
      sourceId: 'PB-P001',
      titles: [{ text: 'La Nouvelle France', role: 'canonical' }],
      kind: 'periodical',
      language: 'English',
      identifiers: [],
    },
    records: [],
    identifierLeaks: [],
  };
}

/**
 * Fail-loud coverage for the US1 generation flow (T015, spec.md FR-003, US1
 * AC-3, contracts/cli-summarize.md "Exit / error contract"): an issue with
 * NEITHER `issue.txt` NOR `issue.en.txt` must throw a descriptive error and
 * write ZERO summary artifacts -- no fabricated summary (Constitution V).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE_FIXTURE = path.resolve(here, '../fixtures/page-provenance.yml');

/** A runner that must NEVER be called on the no-usable-text path. */
function unreachableRunner(): SummarizationRunner {
  return {
    name: 'unreachable',
    summarize: async () => {
      throw new Error('summarize: the SummarizationRunner must not be invoked when no usable text exists');
    },
  };
}

describe('summarizeIssue fail-loud on no usable text (T015, FR-003)', () => {
  let archiveRoot: string | undefined;

  afterEach(() => {
    if (archiveRoot !== undefined) {
      rmSync(archiveRoot, { recursive: true, force: true });
      archiveRoot = undefined;
    }
  });

  it('throws a descriptive error and writes zero summary artifacts when issue.txt and issue.en.txt are both absent', async () => {
    archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-summarize-failloud-'));
    const issueDir = path.join(
      archiveRoot,
      'archive/cases/port-breton/newspapers/la-nouvelle-france',
      '1875-01-15_bpt6k5603637g',
    );
    mkdirSync(issueDir, { recursive: true });

    // A page image + companion exist (the issue WAS fetched), but OCR/translation
    // never ran -- neither issue.txt nor issue.en.txt is present.
    const pageProvenance = await readProvenance(PAGE_FIXTURE);
    writeFileSync(path.join(issueDir, 'f001.jpg'), 'FAKE-PAGE-1');
    await writeProvenance(path.join(issueDir, 'f001.yml'), pageProvenance);

    const ctx: SummarizeIssueCtx = {
      runner: unreachableRunner(),
      model: 'claude-sonnet-5',
      source: englishSource(),
      archiveRoot,
      clock: () => new Date('2026-07-21T00:00:00.000Z'),
      log: () => {},
    };

    await expect(summarizeIssue(issueDir, ctx)).rejects.toThrow(/issue\.txt|issue\.en\.txt|usable text/);

    expect(existsSync(issueThoroughSummaryPath(issueDir))).toBe(false);
    expect(existsSync(issueConciseSummaryPath(issueDir))).toBe(false);
    expect(existsSync(path.join(archiveRoot, 'manifests', 'MANIFEST.sha256'))).toBe(false);
  });
});
