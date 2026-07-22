import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProvenance, writeProvenance, type ProvenanceFields } from '@/archive/provenance';
import { companionYamlPath } from '@/archive/store';
import { parse } from '@/cli/parse';
import { runSummarize, type SummarizeCliDeps } from '@/cli/summarize';
import { writeSourceFile } from '@/bibliography/source-writer';
import type { SummarizationRunner, SummaryResult } from '@/summarize/types';
import type { Source } from '@/model/source';

/**
 * AUDIT-20260722-04, CLI side (self-red-team, per the task driving this
 * fix): `runSummarize` no longer calls `d.preflight()` eagerly -- it passes
 * `d.preflight` through into `SummarizeIssueCtx.preflight`, which
 * `summarizeIssue` (`src/summarize/issue.ts`) invokes LAZILY, only right
 * before the actual engine call. This proves that wiring end-to-end through
 * the CLI entry point: a `--dry-run` invocation of `runSummarize`, given a
 * `preflight` thunk that always throws (simulating `claude` absent), must
 * complete WITHOUT ever tripping that thunk -- dry-run never reaches the
 * generation boundary that would call it.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE_FIXTURE = path.resolve(here, '../fixtures/page-provenance.yml');

const CANNED_RESULT: SummaryResult = {
  thoroughBody: 'A detailed narrative account of this issue, covering Port-Breton.',
  structured: {
    topics: ['colonization'],
    people: [],
    places: ['Port-Breton'],
    dates: [],
    claims: [],
  },
  concise: 'This issue reports on Port-Breton.',
};

function poisonedPreflight(): { preflight: () => Promise<void>; calls: number[] } {
  const calls: number[] = [];
  return {
    preflight: async () => {
      calls.push(1);
      throw new Error('claude: command not found -- simulated absence, should never be called');
    },
    calls,
  };
}

function fakeRunner(): SummarizationRunner {
  return {
    name: 'fake-summarizer',
    summarize: async () => CANNED_RESULT,
  };
}

/** An English-native PB-P001 source (issue.txt is the English OCR, summarized alone). */
function baseSource(): Source {
  return {
    sourceId: 'PB-P001',
    kind: 'periodical',
    case: 'port-breton',
    titles: [{ text: 'La Nouvelle France', role: 'canonical' }],
    language: 'English',
    identifiers: [],
  };
}

/** Build a tmp archive + sourcesDir holding one registered PB-P001 issue with a usable OCR text layer. */
async function buildIssueDir(): Promise<{
  archiveRoot: string;
  sourcesDir: string;
  cleanup: () => void;
}> {
  const archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-summarize-cli-preflight-'));
  const sourcesDir = mkdtempSync(path.join(tmpdir(), 'cc-summarize-cli-preflight-bib-'));
  const issueDir = path.join(
    archiveRoot,
    'archive/cases/port-breton/newspapers/la-nouvelle-france',
    '1875-01-15_bpt6k5603637g',
  );
  mkdirSync(issueDir, { recursive: true });

  const pageProvenance = await readProvenance(PAGE_FIXTURE);
  writeFileSync(path.join(issueDir, 'f001.jpg'), 'FAKE-PAGE-1');
  await writeProvenance(path.join(issueDir, 'f001.yml'), pageProvenance);

  const englishText = 'This is the English OCR text of this issue.';
  writeFileSync(path.join(issueDir, 'issue.txt'), englishText);
  const ocrProvenance: ProvenanceFields = {
    ...pageProvenance,
    type: 'ocr-text',
    format: 'text/plain',
  };
  await writeProvenance(companionYamlPath(path.join(issueDir, 'issue.txt')), ocrProvenance);

  writeSourceFile(sourcesDir, { source: baseSource(), records: [] });

  return {
    archiveRoot,
    sourcesDir,
    cleanup: () => {
      rmSync(archiveRoot, { recursive: true, force: true });
      rmSync(sourcesDir, { recursive: true, force: true });
    },
  };
}

describe('runSummarize --dry-run: preflight is never invoked (AUDIT-20260722-04 CLI wiring)', () => {
  let built: { archiveRoot: string; sourcesDir: string; cleanup: () => void } | undefined;

  afterEach(() => {
    built?.cleanup();
    built = undefined;
  });

  it('a single-issue dry-run completes without ever calling a throwing preflight', async () => {
    built = await buildIssueDir();
    const { preflight, calls } = poisonedPreflight();

    const deps: SummarizeCliDeps = {
      archiveRoot: built.archiveRoot,
      sourcesDir: built.sourcesDir,
      clock: () => new Date('2026-07-21T00:00:00.000Z'),
      log: () => {},
      preflight,
      runner: fakeRunner(),
      model: 'claude-sonnet-5',
      delay: async () => undefined,
    };

    const args = parse(['summarize', 'PB-P001', 'bpt6k5603637g', '--dry-run']);

    await expect(runSummarize(args, deps)).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it('a whole-source dry-run completes without ever calling a throwing preflight', async () => {
    built = await buildIssueDir();
    const { preflight, calls } = poisonedPreflight();

    const deps: SummarizeCliDeps = {
      archiveRoot: built.archiveRoot,
      sourcesDir: built.sourcesDir,
      clock: () => new Date('2026-07-21T00:00:00.000Z'),
      log: () => {},
      preflight,
      runner: fakeRunner(),
      model: 'claude-sonnet-5',
      delay: async () => undefined,
    };

    const args = parse(['summarize', 'PB-P001', '--dry-run']);

    await expect(runSummarize(args, deps)).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});
