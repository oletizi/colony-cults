import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProvenance, writeProvenance, type ProvenanceFields } from '@/archive/provenance';
import { companionYamlPath, storeAsset } from '@/archive/store';
import { summarizeIssue, type SummarizeIssueCtx } from '@/summarize/issue';
import { selectSummaryInput } from '@/summarize/select-input';
import { firstPageProvenanceYaml } from '@/translate/rights';
import {
  buildSummaryProvenance,
  issueConciseSummaryPath,
  issueThoroughSummaryPath,
  renderThoroughMarkdown,
} from '@/summarize/artifacts';
import type { SummarizationRunner, SummaryResult } from '@/summarize/types';

/**
 * Idempotency/resumability coverage for `summarizeIssue` (T032, US5, FR-010,
 * quickstart.md Scenario 4): a second run over an already-summarized issue
 * whose input layers are unchanged is a full skip (zero runner calls);
 * mutating `issue.en.txt` (the translation input layer) causes the issue to
 * be regenerated on the next run and its sidecar `input_layers` shas updated;
 * `force: true` always regenerates regardless of what is already recorded.
 * Also covers AUDIT-20260722-07 (a run interrupted between the thorough and
 * concise `storeAsset` writes must regenerate on the next run, in EITHER
 * half-written direction) and AUDIT-20260722-04 (`ctx.preflight` fires
 * lazily, only right before generation, never on a skip). Mirrors
 * `tests/integration/translate-idempotent.test.ts` (T020) and shares the
 * tmp-archive fixture shape with `tests/integration/summarize.test.ts`
 * (T014).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE_FIXTURE = path.resolve(here, '../fixtures/page-provenance.yml');

const FIXED_DATE = '2026-07-21T00:00:00.000Z';

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

function fakeRunner(): {
  runner: SummarizationRunner;
  calls: Array<{ text: string; model?: string }>;
} {
  const calls: Array<{ text: string; model?: string }> = [];
  return {
    runner: {
      name: 'fake-summarizer',
      summarize: async (text: string, model?: string) => {
        calls.push({ text, model });
        return CANNED_RESULT;
      },
    },
    calls,
  };
}

/** Built tmp archive for one registered, already-fetched-and-OCR'd+translated issue. */
interface BuiltIssue {
  archiveRoot: string;
  issueDir: string;
  cleanup: () => void;
}

/** Mirrors `buildIssueDir` in `tests/integration/summarize.test.ts` (T014). */
async function buildIssueDir(): Promise<BuiltIssue> {
  const archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-summarize-idem-'));
  const issueDir = path.join(
    archiveRoot,
    'archive/cases/port-breton/newspapers/la-nouvelle-france',
    '1875-01-15_bpt6k5603637g',
  );
  mkdirSync(issueDir, { recursive: true });

  const pageProvenance = await readProvenance(PAGE_FIXTURE);
  writeFileSync(path.join(issueDir, 'f001.jpg'), 'FAKE-PAGE-1');
  await writeProvenance(path.join(issueDir, 'f001.yml'), pageProvenance);

  const frenchText =
    'Ceci est le texte francais original de ce numero du journal, decrivant la colonie.';
  writeFileSync(path.join(issueDir, 'issue.txt'), frenchText);
  const ocrProvenance: ProvenanceFields = {
    ...pageProvenance,
    type: 'ocr-text',
    format: 'text/plain',
  };
  await writeProvenance(companionYamlPath(path.join(issueDir, 'issue.txt')), ocrProvenance);

  const englishText = 'This is the English translation of this issue, describing the colony.';
  writeFileSync(path.join(issueDir, 'issue.en.txt'), englishText);
  const translationProvenance: ProvenanceFields = {
    ...pageProvenance,
    type: 'english-translation',
    format: 'text/plain',
    language: 'English',
  };
  await writeProvenance(
    companionYamlPath(path.join(issueDir, 'issue.en.txt')),
    translationProvenance,
  );

  return {
    archiveRoot,
    issueDir,
    cleanup: () => rmSync(archiveRoot, { recursive: true, force: true }),
  };
}

function buildCtx(
  archiveRoot: string,
  runner: SummarizationRunner,
  overrides: Partial<SummarizeIssueCtx> = {},
): SummarizeIssueCtx {
  return {
    runner,
    model: 'claude-sonnet-5',
    archiveRoot,
    clock: () => new Date(FIXED_DATE),
    log: () => {},
    ...overrides,
  };
}

describe('summarizeIssue idempotency (T032, US5, FR-010)', () => {
  let built: BuiltIssue | undefined;

  afterEach(() => {
    built?.cleanup();
    built = undefined;
  });

  it('a second run with unchanged input layers is a full skip -- zero runner calls', async () => {
    built = await buildIssueDir();

    const first = fakeRunner();
    const firstResult = await summarizeIssue(built.issueDir, buildCtx(built.archiveRoot, first.runner));
    expect(firstResult.status).toBe('generated');
    expect(first.calls).toHaveLength(1);

    // A FRESH runner spy for the second run: any call at all is a failure.
    const second = fakeRunner();
    const secondResult = await summarizeIssue(built.issueDir, buildCtx(built.archiveRoot, second.runner));

    expect(secondResult.status).toBe('skipped');
    expect(second.calls).toHaveLength(0);
  });

  it('mutating issue.en.txt after a summary exists causes a regeneration on rerun, with updated sidecar shas', async () => {
    built = await buildIssueDir();

    const first = fakeRunner();
    const firstResult = await summarizeIssue(built.issueDir, buildCtx(built.archiveRoot, first.runner));
    expect(firstResult.status).toBe('generated');

    const thoroughYamlPath = companionYamlPath(issueThoroughSummaryPath(built.issueDir));
    const beforeProvenance = await readProvenance(thoroughYamlPath);
    const beforeShaForTranslation = beforeProvenance.input_layers?.find(
      (layer) => layer.path === 'issue.en.txt',
    )?.sha256;
    expect(beforeShaForTranslation).toBeDefined();

    // Mutate issue.en.txt's bytes (as a re-translation would) and update its
    // recorded sha256 so selectSummaryInput reports the NEW sha as current.
    const mutatedEnglishText =
      'This is the RE-TRANSLATED English text of this issue, describing the colony anew.';
    writeFileSync(path.join(built.issueDir, 'issue.en.txt'), mutatedEnglishText);

    const second = fakeRunner();
    const secondResult = await summarizeIssue(built.issueDir, buildCtx(built.archiveRoot, second.runner));

    expect(secondResult.status).toBe('generated');
    expect(second.calls).toHaveLength(1);
    expect(second.calls[0].text).toContain('RE-TRANSLATED');

    const afterProvenance = await readProvenance(thoroughYamlPath);
    const afterShaForTranslation = afterProvenance.input_layers?.find(
      (layer) => layer.path === 'issue.en.txt',
    )?.sha256;
    expect(afterShaForTranslation).toBeDefined();
    expect(afterShaForTranslation).not.toBe(beforeShaForTranslation);

    const thoroughText = await readFile(issueThoroughSummaryPath(built.issueDir), 'utf-8');
    expect(thoroughText).toContain(CANNED_RESULT.thoroughBody);
  });

  it('force: true always regenerates, even when the input layers are unchanged', async () => {
    built = await buildIssueDir();

    const first = fakeRunner();
    const firstResult = await summarizeIssue(built.issueDir, buildCtx(built.archiveRoot, first.runner));
    expect(firstResult.status).toBe('generated');

    const second = fakeRunner();
    const secondResult = await summarizeIssue(
      built.issueDir,
      buildCtx(built.archiveRoot, second.runner, { force: true }),
    );

    expect(secondResult.status).toBe('generated');
    expect(second.calls).toHaveLength(1);
  });

  it('AUDIT-20260722-07: regenerates (does not skip) when only the thorough artifact+sidecar was written before an interrupt, and produces the concise', async () => {
    built = await buildIssueDir();

    // Simulate a run that completed the FIRST `storeAsset` call in
    // `summarizeIssue` (the thorough artifact) and was then interrupted
    // before the second (the concise artifact) -- write ONLY the thorough
    // artifact+sidecar directly, exactly as `summarizeIssue` would have left
    // things at that point.
    const selected = await selectSummaryInput(built.issueDir);
    const base = await readProvenance(await firstPageProvenanceYaml(built.issueDir));
    const inputLayers = selected.layers.map((layer) => ({ path: layer.path, sha256: layer.sha256 }));
    const thoroughProvenance = buildSummaryProvenance(
      base,
      'thorough',
      'fake-summarizer',
      'claude-sonnet-5',
      FIXED_DATE,
      inputLayers,
    );
    await storeAsset(
      new TextEncoder().encode(renderThoroughMarkdown(CANNED_RESULT)),
      issueThoroughSummaryPath(built.issueDir),
      thoroughProvenance,
      built.archiveRoot,
      { force: true },
    );

    // Confirm the interrupt is genuinely simulated: the concise artifact does
    // NOT exist yet.
    expect(existsSync(issueConciseSummaryPath(built.issueDir))).toBe(false);

    const runner = fakeRunner();
    const result = await summarizeIssue(built.issueDir, buildCtx(built.archiveRoot, runner.runner));

    expect(result.status).toBe('generated');
    expect(runner.calls).toHaveLength(1);
    expect(existsSync(issueConciseSummaryPath(built.issueDir))).toBe(true);

    const conciseText = await readFile(issueConciseSummaryPath(built.issueDir), 'utf-8');
    expect(conciseText).toContain(CANNED_RESULT.concise);
  });

  it('round-0 self-red-team edge: regenerates when only the concise artifact+sidecar exists and the thorough is missing', async () => {
    built = await buildIssueDir();

    // Mirror-image half-pair: a concise sidecar exists (however that came to
    // be) but the thorough is missing -- must still regenerate, not skip.
    const selected = await selectSummaryInput(built.issueDir);
    const base = await readProvenance(await firstPageProvenanceYaml(built.issueDir));
    const inputLayers = selected.layers.map((layer) => ({ path: layer.path, sha256: layer.sha256 }));
    const conciseProvenance = buildSummaryProvenance(
      base,
      'concise',
      'fake-summarizer',
      'claude-sonnet-5',
      FIXED_DATE,
      inputLayers,
    );
    await storeAsset(
      new TextEncoder().encode(`${CANNED_RESULT.concise}\n`),
      issueConciseSummaryPath(built.issueDir),
      conciseProvenance,
      built.archiveRoot,
      { force: true },
    );

    expect(existsSync(issueThoroughSummaryPath(built.issueDir))).toBe(false);

    const runner = fakeRunner();
    const result = await summarizeIssue(built.issueDir, buildCtx(built.archiveRoot, runner.runner));

    expect(result.status).toBe('generated');
    expect(runner.calls).toHaveLength(1);
    expect(existsSync(issueThoroughSummaryPath(built.issueDir))).toBe(true);
  });

  it('AUDIT-20260722-04: ctx.preflight is called lazily -- never on a skip, only right before generation', async () => {
    built = await buildIssueDir();

    let preflightCalls = 0;
    const preflight = async (): Promise<void> => {
      preflightCalls += 1;
    };

    const first = fakeRunner();
    const firstResult = await summarizeIssue(
      built.issueDir,
      buildCtx(built.archiveRoot, first.runner, { preflight }),
    );
    expect(firstResult.status).toBe('generated');
    expect(preflightCalls).toBe(1);

    // A second run over unchanged input layers skips -- preflight must NOT
    // fire again.
    const second = fakeRunner();
    const secondResult = await summarizeIssue(
      built.issueDir,
      buildCtx(built.archiveRoot, second.runner, { preflight }),
    );
    expect(secondResult.status).toBe('skipped');
    expect(preflightCalls).toBe(1);
  });
});
