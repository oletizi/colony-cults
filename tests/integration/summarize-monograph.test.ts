import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readProvenance, writeProvenance, type ProvenanceFields } from '@/archive/provenance';
import { companionYamlPath } from '@/archive/store';
import { sourceRootDir } from '@/archive/location';
import { parse } from '@/cli/parse';
import {
  runSummarize,
  runSummarizeSource,
  type SummarizeCliDeps,
  type SummarizeSourceCliDeps,
} from '@/cli/summarize';
import {
  issueConciseSummaryPath,
  issueThoroughSummaryPath,
  sourceConciseSummaryPath,
  sourceThoroughSummaryPath,
} from '@/summarize/artifacts';
import type { SummarizationRunner, SummaryResult } from '@/summarize/types';
import { writeSourceFile } from '@/bibliography/source-writer';
import { loadSourceFile } from '@/bibliography/load';
import { validateSummaryRef } from '@/bibliography/summary-reference';
import type { Source } from '@/model/source';

/**
 * AUDIT-live-01: `bib summarize <sourceId>` with NO `issueArk` silently did
 * nothing (exit 0, zero artifacts) for a MONOGRAPH source (e.g. PB-P002),
 * because `runSummarize` resolved the whole-source ark list via
 * `discoverIssueArks` -- which enumerates dated issue SUBDIRECTORIES (the
 * periodical convention) and always finds none for a monograph's flat
 * document directory. Only the explicit-ark path (`resolveFetchedDir`
 * ignores the ark for a monograph) worked.
 *
 * Uses the REAL, statically-registered monograph source `PB-P002`
 * (`src/archive/location.ts`, `kind: 'monograph'`) against a temp archive
 * root, exactly as the bug was found running the feature on real data --
 * this sidesteps `ensureMemberLayoutRegistered`'s hardcoded
 * `process.cwd()/bibliography/sources` lookup (used by `runSummarize`),
 * which only matters for a source-group MEMBER not already in the static
 * `SOURCE_LAYOUTS` registry; PB-P002 is static, so that lookup is a no-op.
 *
 * Drives BOTH CLI entry points with NO issueArk and a fake runner:
 *  - `runSummarize` must generate the per-issue two-depth summary (the bug:
 *    zero artifacts, exit 0).
 *  - `runSummarizeSource` must then roll that single covered "issue" up into
 *    the per-source summary + weld the bibliography `summaryRef` (the
 *    analogous gap in `summarizeSource`'s `gatherCoverage`,
 *    `src/summarize/source-rollup.ts`).
 */

const FIXED_DATE = '2026-07-21T00:00:00.000Z';

const MONO_SOURCE_ID = 'PB-P002';
const MONO_ARK = 'bpt6k58039518';
const MONO_SUBPATH =
  'archive/cases/port-breton/books/nouvelle-france-colonie-libre-port-breton';

const ISSUE_RESULT: SummaryResult = {
  thoroughBody: 'A detailed narrative account of this monograph, covering its full text.',
  structured: {
    topics: ['colonization'],
    people: [],
    places: ['Port-Breton'],
    dates: [],
    claims: [],
  },
  concise: 'This monograph describes the Port-Breton colony scheme.',
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

function baseSource(sourceId: string): Source {
  return {
    sourceId,
    kind: 'monograph',
    case: 'port-breton',
    titles: [{ text: 'Nouvelle-France: Colonie libre de Port-Breton', role: 'canonical' }],
    identifiers: [],
  };
}

interface BuiltMonograph {
  archiveRoot: string;
  sourcesDir: string;
  dir: string;
  cleanup: () => void;
}

/**
 * Build a tmp archive + tmp bibliography sourcesDir holding a fetched (and
 * OCR'd) MONOGRAPH -- a FLAT directory (`issue.txt` + one page companion, no
 * dated `_ark` subdirectory) at PB-P002's registered slug, mirroring
 * `tests/integration/translate-monograph.test.ts`'s fixture shape.
 */
async function buildMonograph(): Promise<BuiltMonograph> {
  const archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-summarize-mono-'));
  const sourcesDir = mkdtempSync(path.join(tmpdir(), 'cc-summarize-mono-bib-'));
  const dir = path.join(archiveRoot, MONO_SUBPATH);
  mkdirSync(dir, { recursive: true });

  const pageProvenance: ProvenanceFields = {
    id: MONO_SOURCE_ID,
    title: 'Nouvelle-France: Colonie libre de Port-Breton',
    type: 'page-image',
    case: 'port-breton',
    language: 'French',
    source_archive: 'Gallica / BnF',
    catalog_url: `https://gallica.bnf.fr/ark:/12148/${MONO_ARK}`,
    original_url: '',
    rights_status: 'public-domain',
    retrieved: '2026-07-10T00:00:00.000Z',
    local_path: `${MONO_SUBPATH}/f001.jpg`,
    sha256: 'deadbeef',
    size: 0,
    format: 'image/jpeg',
    ocr_status: 'searchable',
    object_store: null,
    rights_raw: '<results/>',
    notes: null,
  };
  writeFileSync(path.join(dir, 'f001.jpg'), 'FAKE-PAGE-1');
  await writeProvenance(path.join(dir, 'f001.yml'), pageProvenance);

  const frenchText =
    'Ceci est le texte francais original de cette monographie, decrivant la colonie.';
  writeFileSync(path.join(dir, 'issue.txt'), frenchText);
  const ocrProvenance: ProvenanceFields = {
    ...pageProvenance,
    type: 'ocr-text',
    format: 'text/plain',
  };
  await writeProvenance(companionYamlPath(path.join(dir, 'issue.txt')), ocrProvenance);

  writeSourceFile(sourcesDir, { source: baseSource(MONO_SOURCE_ID), records: [] });

  return {
    archiveRoot,
    sourcesDir,
    dir,
    cleanup: () => {
      rmSync(archiveRoot, { recursive: true, force: true });
      rmSync(sourcesDir, { recursive: true, force: true });
    },
  };
}

describe('AUDIT-live-01: bib summarize <monograph> with no issueArk', () => {
  let built: BuiltMonograph | undefined;

  afterEach(() => {
    built?.cleanup();
    built = undefined;
  });

  it('runSummarize generates both summary artifacts for a whole-source (no-ark) monograph run', async () => {
    built = await buildMonograph();
    const { runner, calls } = fakeRunner(ISSUE_RESULT);

    const deps: SummarizeCliDeps = {
      archiveRoot: built.archiveRoot,
      clock: () => new Date(FIXED_DATE),
      log: () => {},
      preflight: async () => {},
      runner,
      model: 'claude-sonnet-5',
      delay: async () => undefined,
    };

    // NOTE: no issueArk positional arg -- exactly the reported bug shape.
    await expect(
      runSummarize(parse(['summarize', MONO_SOURCE_ID]), deps),
    ).resolves.toBeUndefined();

    // The bug: this call used to make ZERO engine calls and write ZERO
    // artifacts (silent no-op, exit 0).
    expect(calls).toHaveLength(1);

    const thoroughPath = issueThoroughSummaryPath(built.dir);
    const concisePath = issueConciseSummaryPath(built.dir);
    expect(existsSync(thoroughPath)).toBe(true);
    expect(existsSync(concisePath)).toBe(true);
    expect(existsSync(companionYamlPath(thoroughPath))).toBe(true);
    expect(existsSync(companionYamlPath(concisePath))).toBe(true);
  });

  it('runSummarizeSource then rolls the single covered monograph "issue" up into the source rollup + summaryRef', async () => {
    built = await buildMonograph();

    // Seed the per-issue summary first (mirrors the real two-step workflow:
    // `bib summarize <id>` then `bib summarize-source <id>`).
    const issueRun = fakeRunner(ISSUE_RESULT);
    await runSummarize(parse(['summarize', MONO_SOURCE_ID]), {
      archiveRoot: built.archiveRoot,
      clock: () => new Date(FIXED_DATE),
      log: () => {},
      preflight: async () => {},
      runner: issueRun.runner,
      model: 'claude-sonnet-5',
      delay: async () => undefined,
    });
    expect(issueRun.calls).toHaveLength(1);

    const rollupResult: SummaryResult = {
      thoroughBody: 'A synthesized rollup account of this monograph.',
      structured: {
        topics: ['colonization'],
        people: [],
        places: ['Port-Breton'],
        dates: [],
        claims: [],
      },
      concise: 'A rollup abstract of the monograph.',
    };
    const rollupRun = fakeRunner(rollupResult);

    const sourceDeps: SummarizeSourceCliDeps = {
      archiveRoot: built.archiveRoot,
      sourcesDir: built.sourcesDir,
      clock: () => new Date(FIXED_DATE),
      log: () => {},
      preflight: async () => {},
      runner: rollupRun.runner,
      model: 'claude-sonnet-5',
    };

    await expect(
      runSummarizeSource(parse(['summarize-source', MONO_SOURCE_ID]), sourceDeps),
    ).resolves.toBeUndefined();

    expect(rollupRun.calls).toHaveLength(1);

    const sourceDir = sourceRootDir(MONO_SOURCE_ID, built.archiveRoot);
    const thoroughPath = sourceThoroughSummaryPath(sourceDir);
    const concisePath = sourceConciseSummaryPath(sourceDir);
    expect(existsSync(thoroughPath)).toBe(true);
    expect(existsSync(concisePath)).toBe(true);

    const sourceFilePath = path.join(built.sourcesDir, `${MONO_SOURCE_ID}.yml`);
    const loaded = loadSourceFile(sourceFilePath);
    expect(loaded.source.summaryRef).toBeDefined();
    const resolved = validateSummaryRef(loaded.source, built.archiveRoot);
    expect(resolved).toBe(thoroughPath);
  });
});
