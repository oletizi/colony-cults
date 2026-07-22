import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readProvenance, writeProvenance, type ProvenanceFields } from '@/archive/provenance';
import { companionYamlPath } from '@/archive/store';
import { sourceRootDir } from '@/archive/location';
import { parse } from '@/cli/parse';
import { runSummarizeSource, type SummarizeSourceCliDeps } from '@/cli/summarize';
import { summarizeIssue, type SummarizeIssueCtx } from '@/summarize/issue';
import {
  sourceConciseSummaryPath,
  sourceThoroughSummaryPath,
} from '@/summarize/artifacts';
import type { SummarizationRunner, SummaryResult } from '@/summarize/types';
import { loadSourceFile } from '@/bibliography/load';
import { writeSourceFile } from '@/bibliography/source-writer';
import { validateSummaryRef } from '@/bibliography/summary-reference';
import type { Source } from '@/model/source';

/**
 * End-to-end coverage for the US4 per-source ROLLUP (T028, spec.md FR-009,
 * quickstart.md Scenario 6): `runSummarizeSource` driven against a temp
 * archive laid out exactly as `discoverIssueArks`/`resolveFetchedDir` expect
 * for the registered periodical `PB-P001`, with SOME issues already
 * summarized (via the real `summarizeIssue`, seeding realistic per-issue
 * artifacts + sidecars) and SOME not -- proving the rollup COVERS WHAT EXISTS
 * (partial coverage is NOT an error) and that the Constitution XV weld (the
 * bibliography `summaryRef` written in the SAME operation as the rollup
 * artifacts) holds. No real `claude`, no network -- fake `SummarizationRunner`s
 * throughout.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE_FIXTURE = path.resolve(here, '../fixtures/page-provenance.yml');

const FIXED_DATE = '2026-07-21T00:00:00.000Z';

const ISSUE_RESULT: SummaryResult = {
  thoroughBody: 'A detailed narrative account of this issue, covering colony affairs.',
  structured: {
    topics: ['colonization'],
    people: ['Charles du Breil, Marquis de Rays'],
    places: ['Port-Breton'],
    dates: ['1875-01-15'],
    claims: ['The colony reports steady progress.'],
  },
  concise: 'This issue reports on the Port-Breton colony.',
};

const ROLLUP_RESULT: SummaryResult = {
  thoroughBody: 'A synthesized account of the source across its summarized issues.',
  structured: {
    topics: ['colonization', 'Port-Breton'],
    people: ['Charles du Breil, Marquis de Rays'],
    places: ['Port-Breton', 'New Ireland'],
    dates: ['1875'],
    claims: ['The enterprise recruited settlers over multiple issues.'],
  },
  concise: 'A rollup abstract of the Port-Breton periodical across its covered issues.',
};

function fakeRunner(
  result: SummaryResult,
): { runner: SummarizationRunner; calls: Array<{ text: string; model?: string }> } {
  const calls: Array<{ text: string; model?: string }> = [];
  return {
    runner: {
      name: 'fake-summarizer',
      summarize: async (text: string, model?: string) => {
        calls.push({ text, model });
        return result;
      },
    },
    calls,
  };
}

interface BuiltSource {
  archiveRoot: string;
  sourcesDir: string;
  cleanup: () => void;
}

/** One issue directory laid out exactly as `resolveFetchedDir` expects for `PB-P001`. */
async function buildIssueDir(archiveRoot: string, ark: string, date: string): Promise<string> {
  const issueDir = path.join(
    archiveRoot,
    'archive/cases/port-breton/newspapers/la-nouvelle-france',
    `${date}_${ark}`,
  );
  mkdirSync(issueDir, { recursive: true });

  const pageProvenance = await readProvenance(PAGE_FIXTURE);
  writeFileSync(path.join(issueDir, 'f001.jpg'), 'FAKE-PAGE-1');
  await writeProvenance(path.join(issueDir, 'f001.yml'), pageProvenance);

  const frenchText = `Texte francais original du numero du ${date}, decrivant la colonie.`;
  writeFileSync(path.join(issueDir, 'issue.txt'), frenchText);
  const ocrProvenance: ProvenanceFields = {
    ...pageProvenance,
    type: 'ocr-text',
    format: 'text/plain',
  };
  await writeProvenance(companionYamlPath(path.join(issueDir, 'issue.txt')), ocrProvenance);

  return issueDir;
}

function baseSource(sourceId: string): Source {
  return {
    sourceId,
    kind: 'periodical',
    case: 'port-breton',
    titles: [{ text: 'La Nouvelle France', role: 'canonical' }],
    identifiers: [],
  };
}

/**
 * Build a tmp archive + tmp bibliography sourcesDir with `PB-P001`: TWO
 * already-summarized issues (via the real `summarizeIssue`) and ONE fetched
 * but NOT summarized issue -- partial coverage.
 */
async function buildPartiallySummarizedSource(): Promise<BuiltSource> {
  const archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-summarize-source-'));
  const sourcesDir = mkdtempSync(path.join(tmpdir(), 'cc-summarize-source-bib-'));

  const covered1 = await buildIssueDir(archiveRoot, 'bpt6k5603637g', '1875-01-15');
  const covered2 = await buildIssueDir(archiveRoot, 'bpt6k5603638h', '1875-02-15');
  await buildIssueDir(archiveRoot, 'bpt6k5603639i', '1875-03-15'); // missing: never summarized

  const issueCtx: SummarizeIssueCtx = {
    runner: fakeRunner(ISSUE_RESULT).runner,
    model: 'claude-sonnet-5',
    archiveRoot,
    clock: () => new Date(FIXED_DATE),
    log: () => {},
  };
  await summarizeIssue(covered1, issueCtx);
  await summarizeIssue(covered2, issueCtx);

  writeSourceFile(sourcesDir, { source: baseSource('PB-P001'), records: [] });

  return {
    archiveRoot,
    sourcesDir,
    cleanup: () => {
      rmSync(archiveRoot, { recursive: true, force: true });
      rmSync(sourcesDir, { recursive: true, force: true });
    },
  };
}

describe('runSummarizeSource (T028, US4 per-source rollup end-to-end)', () => {
  let built: BuiltSource | undefined;

  afterEach(() => {
    built?.cleanup();
    built = undefined;
  });

  it('rolls up covered issues, records covered/missing, and welds the summaryRef in the same operation', async () => {
    built = await buildPartiallySummarizedSource();
    const { runner, calls } = fakeRunner(ROLLUP_RESULT);

    const deps: SummarizeSourceCliDeps = {
      archiveRoot: built.archiveRoot,
      sourcesDir: built.sourcesDir,
      clock: () => new Date(FIXED_DATE),
      log: () => {},
      preflight: async () => {},
      runner,
      model: 'claude-sonnet-5',
    };

    // Partial coverage (2 of 3 issues summarized) must NOT throw.
    await expect(
      runSummarizeSource(parse(['summarize-source', 'PB-P001']), deps),
    ).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe('claude-sonnet-5');
    // The rollup runner was fed BOTH covered issues' thorough content.
    expect(calls[0].text).toContain(ISSUE_RESULT.thoroughBody);

    const sourceDir = sourceRootDir('PB-P001', built.archiveRoot);
    const thoroughPath = sourceThoroughSummaryPath(sourceDir);
    const concisePath = sourceConciseSummaryPath(sourceDir);

    // Artifacts + sidecars + manifest, all via storeAsset.
    expect(existsSync(thoroughPath)).toBe(true);
    expect(existsSync(concisePath)).toBe(true);
    expect(existsSync(companionYamlPath(thoroughPath))).toBe(true);
    expect(existsSync(companionYamlPath(concisePath))).toBe(true);

    const manifest = await readFile(
      path.join(built.archiveRoot, 'manifests', 'MANIFEST.sha256'),
      'utf-8',
    );
    const thoroughRel = path.relative(built.archiveRoot, thoroughPath).split(path.sep).join('/');
    const conciseRel = path.relative(built.archiveRoot, concisePath).split(path.sep).join('/');
    expect(manifest).toContain(thoroughRel);
    expect(manifest).toContain(conciseRel);

    // Covered vs missing issues recorded (cover-what-exists, FR-009).
    const thoroughText = await readFile(thoroughPath, 'utf-8');
    expect(thoroughText).toContain('covered_issues:');
    expect(thoroughText).toContain('bpt6k5603637g');
    expect(thoroughText).toContain('bpt6k5603638h');
    expect(thoroughText).toContain('missing_issues:');
    expect(thoroughText).toContain('bpt6k5603639i');
    expect(thoroughText).toContain(ROLLUP_RESULT.thoroughBody);

    const conciseText = await readFile(concisePath, 'utf-8');
    expect(conciseText.trim()).toBe(ROLLUP_RESULT.concise);

    const thoroughYaml = await readFile(companionYamlPath(thoroughPath), 'utf-8');
    expect(thoroughYaml).toContain('interpretation: "machine-generated-summary"');
    expect(thoroughYaml).toContain('type: "summary-thorough"');

    // Constitution XV weld: the bibliography summaryRef is written in the
    // SAME operation, and resolves to the rollup thorough artifact.
    const sourceFilePath = path.join(built.sourcesDir, 'PB-P001.yml');
    const loaded = loadSourceFile(sourceFilePath);
    expect(loaded.source.summaryRef).toBe(thoroughRel);
    const resolved = validateSummaryRef(loaded.source, built.archiveRoot);
    expect(resolved).toBe(thoroughPath);
  });
});
