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
import { summarizeSource, type SummarizeSourceCtx } from '@/summarize/source-rollup';
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

/**
 * Direct `summarizeSource` coverage for the govern findings AUDIT-20260722-08
 * (both-artifact idempotency), AUDIT-20260722-02 (resolved `thoroughPath` on
 * a skip), and AUDIT-20260722-04 (lazy `ctx.preflight`). Drives
 * `summarizeSource` directly (not through the CLI weld) so each scenario can
 * tamper with exactly one artifact/sidecar between calls -- channel
 * enumeration over the two-artifact, non-atomic write: thorough-only,
 * concise-only, and both-present-but-stale.
 */
describe('summarizeSource (AUDIT-20260722-08/02/04: both-artifact idempotency + lazy preflight)', () => {
  let built: BuiltSource | undefined;

  afterEach(() => {
    built?.cleanup();
    built = undefined;
  });

  function ctxFor(built0: BuiltSource, runner: SummarizationRunner): SummarizeSourceCtx {
    return {
      runner,
      model: 'claude-sonnet-5',
      archiveRoot: built0.archiveRoot,
      clock: () => new Date(FIXED_DATE),
      log: () => {},
    };
  }

  it('regenerates when the thorough artifact is present but the concise artifact is missing (interrupted write)', async () => {
    built = await buildPartiallySummarizedSource();
    const first = fakeRunner(ROLLUP_RESULT);
    const firstResult = await summarizeSource('PB-P001', ctxFor(built, first.runner));
    expect(firstResult.status).toBe('generated');

    // Simulate an interrupt landing BETWEEN the two non-atomic `storeAsset`
    // calls: the thorough artifact + sidecar survive, the concise half never
    // landed -- the state a keyed-on-thorough-only `isUpToDate` would
    // silently skip over.
    rmSync(firstResult.concisePath);
    rmSync(companionYamlPath(firstResult.concisePath));
    expect(existsSync(firstResult.thoroughPath)).toBe(true);
    expect(existsSync(firstResult.concisePath)).toBe(false);

    const second = fakeRunner(ROLLUP_RESULT);
    const secondResult = await summarizeSource('PB-P001', ctxFor(built, second.runner));

    expect(secondResult.status).toBe('generated');
    expect(second.calls).toHaveLength(1);
    expect(existsSync(secondResult.concisePath)).toBe(true);
  });

  it('regenerates when the concise artifact is present but the thorough artifact is missing (reverse interrupt)', async () => {
    built = await buildPartiallySummarizedSource();
    const first = fakeRunner(ROLLUP_RESULT);
    const firstResult = await summarizeSource('PB-P001', ctxFor(built, first.runner));
    expect(firstResult.status).toBe('generated');

    rmSync(firstResult.thoroughPath);
    rmSync(companionYamlPath(firstResult.thoroughPath));
    expect(existsSync(firstResult.thoroughPath)).toBe(false);
    expect(existsSync(firstResult.concisePath)).toBe(true);

    const second = fakeRunner(ROLLUP_RESULT);
    const secondResult = await summarizeSource('PB-P001', ctxFor(built, second.runner));

    expect(secondResult.status).toBe('generated');
    expect(second.calls).toHaveLength(1);
    expect(existsSync(secondResult.thoroughPath)).toBe(true);
  });

  it('regenerates when both artifacts are present but the concise sidecar records a stale covered-issue set', async () => {
    built = await buildPartiallySummarizedSource();
    const first = fakeRunner(ROLLUP_RESULT);
    const firstResult = await summarizeSource('PB-P001', ctxFor(built, first.runner));
    expect(firstResult.status).toBe('generated');

    const conciseYamlPath = companionYamlPath(firstResult.concisePath);
    const staleProvenance = await readProvenance(conciseYamlPath);
    await writeProvenance(conciseYamlPath, {
      ...staleProvenance,
      input_layers: [{ path: 'stale/no-longer-covered.md', sha256: '0'.repeat(64) }],
    });

    const second = fakeRunner(ROLLUP_RESULT);
    const secondResult = await summarizeSource('PB-P001', ctxFor(built, second.runner));

    expect(secondResult.status).toBe('generated');
    expect(second.calls).toHaveLength(1);
  });

  it('skips when both artifacts are up to date, and result.thoroughPath stays resolved on the skip', async () => {
    built = await buildPartiallySummarizedSource();
    const first = fakeRunner(ROLLUP_RESULT);
    const firstResult = await summarizeSource('PB-P001', ctxFor(built, first.runner));
    expect(firstResult.status).toBe('generated');

    const second = fakeRunner(ROLLUP_RESULT);
    const secondResult = await summarizeSource('PB-P001', ctxFor(built, second.runner));

    expect(secondResult.status).toBe('skipped');
    expect(second.calls).toHaveLength(0);
    // AUDIT-20260722-02: the CLI weld re-asserts the bibliography summaryRef
    // from `result.thoroughPath` even on a 'skipped' rerun -- it must stay a
    // resolved path, never undefined, on every non-dry-run status.
    expect(secondResult.thoroughPath).toBe(firstResult.thoroughPath);
    expect(existsSync(secondResult.thoroughPath)).toBe(true);
  });

  it('calls ctx.preflight lazily: never on dry-run, never on a skip, exactly once right before a real generation', async () => {
    built = await buildPartiallySummarizedSource();
    const preflightCalls: string[] = [];
    const preflight = async () => {
      preflightCalls.push('called');
    };

    const dryRunResult = await summarizeSource('PB-P001', {
      ...ctxFor(built, fakeRunner(ROLLUP_RESULT).runner),
      dryRun: true,
      preflight,
    });
    expect(dryRunResult.status).toBe('dry-run');
    expect(preflightCalls).toHaveLength(0);

    const generateRunner = fakeRunner(ROLLUP_RESULT);
    const generated = await summarizeSource('PB-P001', {
      ...ctxFor(built, generateRunner.runner),
      preflight,
    });
    expect(generated.status).toBe('generated');
    expect(preflightCalls).toHaveLength(1);

    const skipRunner = fakeRunner(ROLLUP_RESULT);
    const skipped = await summarizeSource('PB-P001', {
      ...ctxFor(built, skipRunner.runner),
      preflight,
    });
    expect(skipped.status).toBe('skipped');
    // Unchanged -- a skip never touches the engine, so it must never touch
    // the preflight either.
    expect(preflightCalls).toHaveLength(1);
  });
});
