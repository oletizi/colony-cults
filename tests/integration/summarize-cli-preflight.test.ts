import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProvenance, writeProvenance, type ProvenanceFields } from '@/archive/provenance';
import { companionYamlPath } from '@/archive/store';
import { parse } from '@/cli/parse';
import { runSummarize, type SummarizeCliDeps } from '@/cli/summarize';
import type { SummarizationRunner, SummaryResult } from '@/summarize/types';

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

/** Build a tmp archive holding one registered PB-P001 issue with a usable OCR text layer. */
async function buildIssueDir(): Promise<{ archiveRoot: string; cleanup: () => void }> {
  const archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-summarize-cli-preflight-'));
  const issueDir = path.join(
    archiveRoot,
    'archive/cases/port-breton/newspapers/la-nouvelle-france',
    '1875-01-15_bpt6k5603637g',
  );
  mkdirSync(issueDir, { recursive: true });

  const pageProvenance = await readProvenance(PAGE_FIXTURE);
  writeFileSync(path.join(issueDir, 'f001.jpg'), 'FAKE-PAGE-1');
  await writeProvenance(path.join(issueDir, 'f001.yml'), pageProvenance);

  const frenchText = 'Ceci est le texte francais original de ce numero du journal.';
  writeFileSync(path.join(issueDir, 'issue.txt'), frenchText);
  const ocrProvenance: ProvenanceFields = {
    ...pageProvenance,
    type: 'ocr-text',
    format: 'text/plain',
  };
  await writeProvenance(companionYamlPath(path.join(issueDir, 'issue.txt')), ocrProvenance);

  return {
    archiveRoot,
    cleanup: () => rmSync(archiveRoot, { recursive: true, force: true }),
  };
}

describe('runSummarize --dry-run: preflight is never invoked (AUDIT-20260722-04 CLI wiring)', () => {
  let built: { archiveRoot: string; cleanup: () => void } | undefined;

  afterEach(() => {
    built?.cleanup();
    built = undefined;
  });

  it('a single-issue dry-run completes without ever calling a throwing preflight', async () => {
    built = await buildIssueDir();
    const { preflight, calls } = poisonedPreflight();

    const deps: SummarizeCliDeps = {
      archiveRoot: built.archiveRoot,
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
