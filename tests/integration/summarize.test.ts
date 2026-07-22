import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProvenance, writeProvenance, type ProvenanceFields } from '@/archive/provenance';
import { companionYamlPath } from '@/archive/store';
import { summarizeIssue, type SummarizeIssueCtx } from '@/summarize/issue';
import {
  issueConciseSummaryPath,
  issueThoroughSummaryPath,
} from '@/summarize/artifacts';
import type { SummarizationRunner, SummaryResult } from '@/summarize/types';
import type { LoadedSource } from '@/bibliography/load';

/** A minimal Gallica {@link LoadedSource} whose SSOT `language` drives routing. */
function gallicaSource(language: string): LoadedSource {
  return {
    source: {
      sourceId: 'PB-P001',
      titles: [{ text: 'La Nouvelle France', role: 'canonical' }],
      kind: 'periodical',
      language,
      identifiers: [],
    },
    records: [],
    identifierLeaks: [],
  };
}

/**
 * End-to-end coverage for the US1 generation flow (T014, contracts/cli-summarize.md
 * Scenario 1/3): `summarizeIssue` driven against a temp archive laid out exactly
 * as `resolveFetchedDir` expects for the registered periodical `PB-P001`, with a
 * FAKE `SummarizationRunner` returning a canned, deterministic `SummaryResult` --
 * no real `claude`, no network. Mirrors the tmp-archive harness in
 * `tests/integration/translate-issue.test.ts`.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE_FIXTURE = path.resolve(here, '../fixtures/page-provenance.yml');

const FIXED_DATE = '2026-07-21T00:00:00.000Z';

const CONCISE_SENTENCE =
  'This issue reports on the early progress of the Port-Breton colony in New Ireland.';

const CANNED_RESULT: SummaryResult = {
  thoroughBody:
    'A detailed narrative account of this issue, covering the founding of the ' +
    `Port-Breton colony. ${CONCISE_SENTENCE} It also records the weather and supply state.`,
  structured: {
    topics: ['colonization', 'Port-Breton'],
    people: ['Charles du Breil, Marquis de Rays'],
    places: ['Port-Breton', 'New Ireland'],
    dates: ['1875-01-15'],
    claims: ['The colony reports steady progress in its first weeks.'],
  },
  concise: CONCISE_SENTENCE,
};

function fakeRunner(
  result: SummaryResult = CANNED_RESULT,
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

/** Built tmp archive for one registered, already-fetched-and-OCR'd issue. */
interface BuiltIssue {
  archiveRoot: string;
  issueDir: string;
  cleanup: () => void;
}

/**
 * Build a tmp archive for the registered periodical `PB-P001`, laid out
 * exactly as `resolveFetchedDir`/`findIssueDir` expect: one page image
 * companion (`f001.yml`, the base-page provenance source), an `issue.txt`
 * (French OCR), and -- when `withTranslation` -- an `issue.en.txt` (English
 * translation) with its own companion, so both input layers are exercised
 * (Scenario 3, FR-002).
 */
async function buildIssueDir(opts: { withTranslation: boolean }): Promise<BuiltIssue> {
  const archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-summarize-'));
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

  if (opts.withTranslation) {
    const englishText =
      'This is the English translation of this issue, describing the colony.';
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
  }

  return {
    archiveRoot,
    issueDir,
    cleanup: () => rmSync(archiveRoot, { recursive: true, force: true }),
  };
}

function buildCtx(
  archiveRoot: string,
  runner: SummarizationRunner,
  source: LoadedSource,
): SummarizeIssueCtx {
  return {
    runner,
    model: 'claude-sonnet-5',
    source,
    archiveRoot,
    clock: () => new Date(FIXED_DATE),
    log: () => {},
  };
}

describe('summarizeIssue (T014, US1 end-to-end generation)', () => {
  let built: BuiltIssue | undefined;

  afterEach(() => {
    built?.cleanup();
    built = undefined;
  });

  it('writes both summary artifacts + sidecars + a manifest entry, from a single OCR text layer', async () => {
    built = await buildIssueDir({ withTranslation: false });
    const { runner, calls } = fakeRunner();

    // English-native source: issue.txt is the English OCR, summarized alone.
    const result = await summarizeIssue(
      built.issueDir,
      buildCtx(built.archiveRoot, runner, gallicaSource('English')),
    );

    expect(result.status).toBe('generated');
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe('claude-sonnet-5');

    const thoroughPath = issueThoroughSummaryPath(built.issueDir);
    const concisePath = issueConciseSummaryPath(built.issueDir);
    expect(existsSync(thoroughPath)).toBe(true);
    expect(existsSync(concisePath)).toBe(true);
    expect(existsSync(companionYamlPath(thoroughPath))).toBe(true);
    expect(existsSync(companionYamlPath(concisePath))).toBe(true);

    const thoroughText = await readFile(thoroughPath, 'utf-8');
    expect(thoroughText).toContain(CANNED_RESULT.thoroughBody);
    expect(thoroughText).toContain('topics:');
    expect(thoroughText).toContain('Port-Breton');

    const conciseText = await readFile(concisePath, 'utf-8');
    expect(conciseText.trim()).toBe(CANNED_RESULT.concise);
    // The concise introduces no claim absent from the thorough (SC-003): every
    // word of the (single-sentence) concise appears, verbatim, in the thorough.
    expect(thoroughText).toContain(CANNED_RESULT.concise);

    const thoroughYaml = await readFile(companionYamlPath(thoroughPath), 'utf-8');
    expect(thoroughYaml).toContain('interpretation: "machine-generated-summary"');
    expect(thoroughYaml).toContain('engine: "fake-summarizer"');
    expect(thoroughYaml).toContain('model: "claude-sonnet-5"');
    expect(thoroughYaml).toContain('type: "summary-thorough"');
    expect(thoroughYaml).toContain('format: "text/markdown"');
    expect(thoroughYaml).toMatch(/input_layers:\n\s+- path: "issue\.txt"/);

    const conciseYaml = await readFile(companionYamlPath(concisePath), 'utf-8');
    expect(conciseYaml).toContain('interpretation: "machine-generated-summary"');
    expect(conciseYaml).toContain('type: "summary-concise"');

    const manifest = await readFile(
      path.join(built.archiveRoot, 'manifests', 'MANIFEST.sha256'),
      'utf-8',
    );
    const thoroughRel = path
      .relative(built.archiveRoot, thoroughPath)
      .split(path.sep)
      .join('/');
    const conciseRel = path
      .relative(built.archiveRoot, concisePath)
      .split(path.sep)
      .join('/');
    expect(manifest).toContain(thoroughRel);
    expect(manifest).toContain(conciseRel);
  });

  it('records BOTH the French OCR and English translation as input layers (Scenario 3, FR-002)', async () => {
    built = await buildIssueDir({ withTranslation: true });
    const { runner, calls } = fakeRunner();

    // French source with a translation present: both layers are combined.
    const result = await summarizeIssue(
      built.issueDir,
      buildCtx(built.archiveRoot, runner, gallicaSource('French')),
    );

    expect(result.status).toBe('generated');
    expect(calls).toHaveLength(1);
    // The combined French+English text was passed to the runner.
    expect(calls[0].text).toContain('FRENCH OCR TEXT');
    expect(calls[0].text).toContain('ENGLISH TRANSLATION');

    const thoroughYaml = await readFile(
      companionYamlPath(issueThoroughSummaryPath(built.issueDir)),
      'utf-8',
    );
    expect(thoroughYaml).toMatch(/input_layers:\n\s+- path: "issue\.txt"/);
    expect(thoroughYaml).toContain('issue.en.txt');
  });
});
