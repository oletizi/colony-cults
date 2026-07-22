import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { writeProvenance, type ProvenanceFields } from '@/archive/provenance';
import { companionYamlPath } from '@/archive/store';
import { summarizeIssue, type SummarizeIssueCtx } from '@/summarize/issue';
import {
  resolvePapersPastInput,
  type PapersPastPrefetch,
} from '@/summarize/papers-past-input';
import {
  issueConciseSummaryPath,
  issueThoroughSummaryPath,
} from '@/summarize/artifacts';
import type { SummarizationRunner, SummaryResult } from '@/summarize/types';
import type { LoadedSource } from '@/bibliography/load';
import type { Source } from '@/model/source';
import type { AuthoredRepositoryRecord } from '@/bibliography/model';

/**
 * US6 / FR-019..FR-021 coverage: a Papers Past source reads its B2-resident
 * `ocr-text` asset (English-only, NO translation layer), generates both summary
 * depths, and attributes the input layer honestly to Papers Past
 * (`origin: papers-past-ocr`, `source_representation: papers-past-text-tab`).
 * Also covers the FR-020 pre-fetch + fail-loud contract at the
 * `resolvePapersPastInput` seam. No real `claude`, no real network.
 */

const FIXED_DATE = '2026-07-21T00:00:00.000Z';
const OCR_KEY = 'archive/papers-past/esd18800401.2.28/730b6152c97549c9364c9d7506923bc3791f097abb0fdd4b0eb2a23c53855168.txt';
const OCR_CHECKSUM = '730b6152c97549c9364c9d7506923bc3791f097abb0fdd4b0eb2a23c53855168';
const OCR_TEXT =
  'THREATENED INVASION OF WESTERN AUSTRALIA. The Evening Star reports on the ' +
  'de Rays expedition and its prospectus framing of the Port-Breton colony.';

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

const CANNED_RESULT: SummaryResult = {
  thoroughBody: 'A detailed narrative account of this Papers Past newspaper article.',
  structured: {
    topics: ['colonization', 'Port-Breton'],
    people: ['Charles du Breil, Marquis de Rays'],
    places: ['Western Australia', 'Port-Breton'],
    dates: ['1880-04-01'],
    claims: ['The article frames the expedition as a threatened invasion.'],
  },
  concise: 'An Evening Star article on the de Rays expedition and Port-Breton scheme.',
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

/** A Papers Past {@link LoadedSource} whose ocr-text asset points at {@link OCR_KEY}. */
function papersPastSource(): LoadedSource {
  const source: Source = {
    sourceId: 'PB-P073',
    titles: [{ text: 'THREATENED INVASION OF WESTERN AUSTRALIA', role: 'canonical' }],
    kind: 'periodical',
    language: 'English',
    case: 'port-breton',
    identifiers: [],
  };
  const record: AuthoredRepositoryRecord = {
    sourceArchive: 'Papers Past',
    status: 'archived',
    sourceUrl: 'https://paperspast.natlib.govt.nz/newspapers/ESD18800401.2.28',
    identifiers: [{ type: 'papers-past', value: 'ESD18800401.2.28' }],
    assets: [
      {
        sourceUrl: 'https://paperspast.natlib.govt.nz/newspapers/ESD18800401.2.28',
        mediaType: 'text/plain; charset=utf-8',
        objectStoreKey: OCR_KEY,
        checksum: OCR_CHECKSUM,
        byteLength: OCR_TEXT.length,
        provenancePath: `archive/papers-past/esd18800401.2.28/${OCR_CHECKSUM}.yml`,
        role: 'ocr-text',
        sequence: 0,
        sourceRepresentation: 'papers-past-text-tab',
      },
    ],
  };
  return { source, records: [record], identifierLeaks: [] };
}

interface BuiltPapersPast {
  archiveRoot: string;
  issueDir: string;
  cleanup: () => void;
}

/**
 * Build a tmp archive holding a Papers Past clipping: a full page-provenance
 * companion (`f001.yml`, the base citation source `summarizeIssue` reads) plus
 * the pre-fetched OCR `.txt` at `<archiveRoot>/<OCR_KEY>`.
 */
async function buildPapersPast(opts: { withLocalOcr: boolean }): Promise<BuiltPapersPast> {
  const archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-summarize-pp-'));
  const issueDir = path.join(
    archiveRoot,
    'archive/cases/port-breton/newspapers/threatened-invasion',
  );
  mkdirSync(issueDir, { recursive: true });

  const pageProvenance: ProvenanceFields = {
    id: 'PB-P073',
    title: 'THREATENED INVASION OF WESTERN AUSTRALIA',
    type: 'page-image',
    case: 'port-breton',
    language: 'English',
    source_archive: 'Papers Past',
    catalog_url: 'https://paperspast.natlib.govt.nz/newspapers/ESD18800401.2.28',
    original_url: 'https://paperspast.natlib.govt.nz/newspapers/ESD18800401.2.28',
    rights_status: 'public-domain',
    retrieved: '2026-07-21T05:21:34.562Z',
    local_path: 'archive/cases/port-breton/newspapers/threatened-invasion/f001.gif',
    sha256: 'c'.repeat(64),
    size: 0,
    format: 'image/gif',
    ocr_status: 'searchable',
    object_store: null,
    rights_raw: '<results/>',
    notes: null,
  };
  writeFileSync(path.join(issueDir, 'f001.gif'), 'FAKE-STRIP-1');
  await writeProvenance(path.join(issueDir, 'f001.yml'), pageProvenance);

  if (opts.withLocalOcr) {
    const dest = path.join(archiveRoot, OCR_KEY);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, OCR_TEXT, 'utf-8');
  }

  return {
    archiveRoot,
    issueDir,
    cleanup: () => rmSync(archiveRoot, { recursive: true, force: true }),
  };
}

function buildCtx(built: BuiltPapersPast, runner: SummarizationRunner): SummarizeIssueCtx {
  return {
    runner,
    model: 'claude-sonnet-5',
    source: papersPastSource(),
    archiveRoot: built.archiveRoot,
    clock: () => new Date(FIXED_DATE),
    log: () => {},
  };
}

describe('summarizeIssue for a Papers Past source (US6, FR-019..FR-021)', () => {
  let built: BuiltPapersPast | undefined;

  afterEach(() => {
    built?.cleanup();
    built = undefined;
  });

  it('reads the ocr-text asset, generates both summaries, and attributes the layer to Papers Past (no translation)', async () => {
    built = await buildPapersPast({ withLocalOcr: true });
    const { runner, calls } = fakeRunner();

    const result = await summarizeIssue(built.issueDir, buildCtx(built, runner));

    expect(result.status).toBe('generated');
    expect(calls).toHaveLength(1);
    // The OCR reading text was passed to the runner; no French-OCR delimiters.
    expect(calls[0].text).toContain('THREATENED INVASION');
    expect(calls[0].text).not.toContain('FRENCH OCR TEXT');

    const thoroughPath = issueThoroughSummaryPath(built.issueDir);
    const concisePath = issueConciseSummaryPath(built.issueDir);
    expect(existsSync(thoroughPath)).toBe(true);
    expect(existsSync(concisePath)).toBe(true);

    const thoroughYaml = await readFile(companionYamlPath(thoroughPath), 'utf-8');
    // Exactly ONE input layer (English-only, no translation), attributed to
    // Papers Past as source-downloaded OCR.
    expect(thoroughYaml).toContain('input_layers:');
    expect(thoroughYaml).toContain(`  - path: "${OCR_KEY}"`);
    expect(thoroughYaml).toContain(`    sha256: "${sha256(OCR_TEXT)}"`);
    expect(thoroughYaml).toContain('    origin: "papers-past-ocr"');
    expect(thoroughYaml).toContain('    source_representation: "papers-past-text-tab"');
    // No project-ocr / project-translation attribution on a Papers Past summary.
    expect(thoroughYaml).not.toContain('project-translation');
    expect(thoroughYaml).not.toContain('issue.en.txt');
    // Only one sequence item.
    expect(thoroughYaml.match(/^ {2}- path:/gm)?.length).toBe(1);
  });
});

describe('resolvePapersPastInput pre-fetch + fail-loud (FR-020)', () => {
  let built: BuiltPapersPast | undefined;

  afterEach(() => {
    built?.cleanup();
    built = undefined;
  });

  it('fails loud naming the asset when the .txt is absent and NO CDN base is configured', async () => {
    built = await buildPapersPast({ withLocalOcr: false });
    const prefetch: PapersPastPrefetch = {
      cdnBase: undefined,
      fetch: async () => {
        throw new Error('fetch must not be called when there is no CDN base');
      },
    };

    await expect(
      resolvePapersPastInput(papersPastSource(), built.archiveRoot, prefetch),
    ).rejects.toThrow(new RegExp(OCR_KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await expect(
      resolvePapersPastInput(papersPastSource(), built.archiveRoot, prefetch),
    ).rejects.toThrow(/CORPUS_CDN_BASE|no CDN base/);
  });

  it('pre-fetches the .txt from the CDN when absent, writes it locally, and returns the Papers Past layer', async () => {
    built = await buildPapersPast({ withLocalOcr: false });
    const dest = path.join(built.archiveRoot, OCR_KEY);
    expect(existsSync(dest)).toBe(false);

    let fetched: string | undefined;
    const prefetch: PapersPastPrefetch = {
      cdnBase: 'https://cdn.example',
      fetch: async (url: string) => {
        fetched = url;
        return { ok: true, status: 200, text: async () => OCR_TEXT };
      },
    };

    const result = await resolvePapersPastInput(papersPastSource(), built.archiveRoot, prefetch);

    expect(fetched).toBe(`https://cdn.example/${OCR_KEY}`);
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, 'utf-8')).toBe(OCR_TEXT);
    expect(result.layers).toEqual([
      {
        path: OCR_KEY,
        sha256: sha256(OCR_TEXT),
        origin: 'papers-past-ocr',
        sourceRepresentation: 'papers-past-text-tab',
      },
    ]);
  });

  it('fails loud when the CDN pre-fetch returns a non-200 response', async () => {
    built = await buildPapersPast({ withLocalOcr: false });
    const prefetch: PapersPastPrefetch = {
      cdnBase: 'https://cdn.example',
      fetch: async () => ({ ok: false, status: 404, text: async () => 'not found' }),
    };

    await expect(
      resolvePapersPastInput(papersPastSource(), built.archiveRoot, prefetch),
    ).rejects.toThrow(/HTTP 404/);
  });

  it('fails loud when the CDN pre-fetch throws (network failure)', async () => {
    built = await buildPapersPast({ withLocalOcr: false });
    const prefetch: PapersPastPrefetch = {
      cdnBase: 'https://cdn.example',
      fetch: async () => {
        throw new Error('ECONNREFUSED');
      },
    };

    await expect(
      resolvePapersPastInput(papersPastSource(), built.archiveRoot, prefetch),
    ).rejects.toThrow(/pre-fetch failed|ECONNREFUSED/);
  });
});
