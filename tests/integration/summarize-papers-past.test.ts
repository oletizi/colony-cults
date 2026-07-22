import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  deriveSourceLayout,
  registerSourceLayout,
  resolveFetchedDir,
} from '@/archive/location';
import { companionYamlPath } from '@/archive/store';
import type { ObjectStore } from '@/archive/object-store';
import { summarizeIssue, type SummarizeIssueCtx } from '@/summarize/issue';
import {
  issueConciseSummaryPath,
  issueThoroughSummaryPath,
} from '@/summarize/artifacts';
import type { SummarizationRunner, SummaryResult } from '@/summarize/types';
import type { LoadedSource } from '@/bibliography/load';
import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import type { AcquiredAsset } from '@/model/acquired-asset';

import { writeMemberFixture, type WriteMemberFixtureResult } from '../unit/pdf/member-fixture';

/**
 * Spec 017 CONVERGENCE coverage: a source-group MEMBER (Papers Past) whose
 * reading text is a DETACHED `ocr-text` asset is summarized by REUSING the
 * canonical `materializeIssueText` mechanism -- the interim CDN-prefetch
 * adapter is gone. `summarizeIssue` -> `selectSummaryInput` materializes a
 * standard `issue.txt` (+ full-`ProvenanceFields` sidecar) from the asset via a
 * FAKE `ObjectStore` returning the bytes, then selects it through the NORMAL
 * English-OCR path: both summary depths generate, the input layer is honestly
 * attributed to Papers Past (`origin: papers-past-ocr`,
 * `source_representation: papers-past-text-tab`) with NO translation layer, and
 * the attribution DERIVES from the materialized sidecar rather than a hardcoded
 * source-family branch. No real `claude`, no real network, no real B2.
 */

const FIXED_DATE = '2026-07-21T00:00:00.000Z';

const OCR_TEXT =
  'THREATENED INVASION OF WESTERN AUSTRALIA. The Evening Star reports on the ' +
  'de Rays expedition and its prospectus framing of the Port-Breton colony.';

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

/**
 * Build a source-group member fixture (N page-master folios + a detached
 * `ocr-text` asset with a fake `ObjectStore` serving its bytes, NO inline
 * `issue.txt`), English-language so the ocr-text IS the reading text (no
 * translation). The member dir the fixture writes into is exactly the dir
 * `materializeIssueText` (via `deriveSourceLayout`) targets and the summarizer
 * reads -- the dir-match invariant a dedicated test below also asserts.
 */
async function papersPastMember(sourceId: string): Promise<WriteMemberFixtureResult> {
  return writeMemberFixture({
    groupId: 'PB-G920',
    sourceId,
    case: 'port-breton',
    slug: `threatened-invasion-${sourceId.toLowerCase()}`,
    pageCount: 2,
    articleDate: '1880-04-01',
    ocrText: OCR_TEXT,
    language: 'English',
    sourceArchive: 'Papers Past',
  });
}

/** A member {@link LoadedSource} carrying the fixture's detached `ocr-text` asset. */
function memberLoadedSource(fixture: WriteMemberFixtureResult): LoadedSource {
  const record: AuthoredRepositoryRecord = {
    sourceArchive: fixture.repositoryRecord.sourceArchive,
    status: fixture.repositoryRecord.status,
    catalogUrl: fixture.repositoryRecord.catalogUrl,
    identifiers: fixture.repositoryRecord.identifiers,
    assets: fixture.repositoryRecord.assets,
  };
  return { source: fixture.memberSource, records: [record], identifierLeaks: [] };
}

function buildCtx(
  fixture: WriteMemberFixtureResult,
  runner: SummarizationRunner,
  objectStore: ObjectStore | undefined,
): SummarizeIssueCtx {
  return {
    runner,
    model: 'claude-sonnet-5',
    source: memberLoadedSource(fixture),
    archiveRoot: fixture.archiveRoot,
    objectStore,
    clock: () => new Date(FIXED_DATE),
    log: () => {},
  };
}

describe('summarizeIssue for a source-group member via materializeIssueText (spec 017 convergence)', () => {
  let fixture: WriteMemberFixtureResult | undefined;

  afterEach(() => {
    fixture?.cleanup();
    fixture = undefined;
  });

  it('materializes issue.txt from the ocr-text asset, generates both summaries, attributes the layer to Papers Past (no translation)', async () => {
    fixture = await papersPastMember('PB-P921');
    const { runner, calls } = fakeRunner();

    // No inline issue.txt before summarization -- it is materialized on demand.
    expect(existsSync(path.join(fixture.sourceDir, 'issue.txt'))).toBe(false);

    const result = await summarizeIssue(
      fixture.sourceDir,
      buildCtx(fixture, runner, fixture.objectStore),
    );

    expect(result.status).toBe('generated');

    // materializeIssueText produced issue.txt (+ its full-ProvenanceFields
    // sidecar) in the member's flat archive dir == the issueDir summarize read.
    const issueTxtPath = path.join(fixture.sourceDir, 'issue.txt');
    expect(existsSync(issueTxtPath)).toBe(true);
    expect(await readFile(issueTxtPath, 'utf-8')).toBe(OCR_TEXT);
    expect(existsSync(path.join(fixture.sourceDir, 'issue.txt.yml'))).toBe(true);

    // The runner saw the OCR reading text (English-only, no French delimiters).
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('THREATENED INVASION');
    expect(calls[0].text).not.toContain('FRENCH OCR TEXT');

    const thoroughPath = issueThoroughSummaryPath(fixture.sourceDir);
    const concisePath = issueConciseSummaryPath(fixture.sourceDir);
    expect(existsSync(thoroughPath)).toBe(true);
    expect(existsSync(concisePath)).toBe(true);

    const thoroughYaml = await readFile(companionYamlPath(thoroughPath), 'utf-8');
    // Exactly ONE input layer: the materialized issue.txt, attributed to Papers
    // Past as source-downloaded OCR (origin DERIVED from the materialized
    // issue.txt.yml's source_representation, not a hardcoded branch).
    expect(thoroughYaml).toContain('input_layers:');
    expect(thoroughYaml).toContain('  - path: "issue.txt"');
    expect(thoroughYaml).toContain(`    sha256: "${fixture.ocrTextSha256}"`);
    expect(thoroughYaml).toContain('    origin: "papers-past-ocr"');
    expect(thoroughYaml).toContain('    source_representation: "papers-past-text-tab"');
    // No project/translation attribution, no French OCR, no translation file.
    expect(thoroughYaml).not.toContain('project-translation');
    expect(thoroughYaml).not.toContain('issue.en.txt');
    expect(thoroughYaml).not.toContain('FRENCH');
    // Only one sequence item.
    expect(thoroughYaml.match(/^ {2}- path:/gm)?.length).toBe(1);
  });

  it('materializes into the SAME dir the summarizer reads (dir-match invariant)', async () => {
    fixture = await papersPastMember('PB-P922');
    const { runner } = fakeRunner();

    await summarizeIssue(fixture.sourceDir, buildCtx(fixture, runner, fixture.objectStore));

    // The dir materializeIssueText writes into (deriveSourceLayout-derived) MUST
    // equal the dir the summarizer/CLI resolves via the registered layout --
    // otherwise summarize would materialize to one place and read another.
    registerSourceLayout('PB-P922', deriveSourceLayout(fixture.memberSource));
    const resolved = resolveFetchedDir('PB-P922', 'PB-P922', fixture.archiveRoot);
    expect(resolved).toBe(fixture.sourceDir);
    expect(existsSync(path.join(resolved, 'issue.txt'))).toBe(true);
  });

  it('fails loud when the ocr-text asset checksum does not match the fetched bytes (materializeIssueText contract)', async () => {
    fixture = await papersPastMember('PB-P923');
    const { runner } = fakeRunner();

    // Tamper the member's ocr-text asset checksum: the fake ObjectStore still
    // returns the correct bytes, so sha256(fetched) != asset.checksum -> throw.
    const tampered = memberLoadedSource(fixture);
    tampered.records[0].assets = (tampered.records[0].assets ?? []).map(
      (asset): AcquiredAsset =>
        asset.role === 'ocr-text' ? { ...asset, checksum: 'deadbeef'.repeat(8) } : asset,
    );
    const ctx: SummarizeIssueCtx = {
      ...buildCtx(fixture, runner, fixture.objectStore),
      source: tampered,
    };

    await expect(summarizeIssue(fixture.sourceDir, ctx)).rejects.toThrow(
      /checksum|mismatch|sha256|PB-P923/i,
    );
  });

  it('fails loud (no silent skip) when a member needs materialization but no ObjectStore is provided', async () => {
    fixture = await papersPastMember('PB-P924');
    const { runner } = fakeRunner();

    await expect(
      summarizeIssue(fixture.sourceDir, buildCtx(fixture, runner, undefined)),
    ).rejects.toThrow(/ObjectStore/);
  });
});

describe('summarizeIssue still fails loud for a known-French source with no translation (AUDIT-17 preserved)', () => {
  let archiveRoot: string | undefined;

  afterEach(() => {
    if (archiveRoot !== undefined) {
      rmSync(archiveRoot, { recursive: true, force: true });
    }
    archiveRoot = undefined;
  });

  it('a French source (no ocr-text asset) whose issue.en.txt is absent fails loud ("translation pending")', async () => {
    archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-summarize-fr-'));
    const issueDir = path.join(
      archiveRoot,
      'archive/cases/port-breton/newspapers/la-nouvelle-france/1885-01-01_ark',
    );
    mkdirSync(issueDir, { recursive: true });
    // Only the French OCR is present -- the exact silent-wrong-input case.
    writeFileSync(
      path.join(issueDir, 'issue.txt'),
      'Ceci est le texte francais original de ce numero.',
      'utf-8',
    );

    const frenchSource: LoadedSource = {
      source: {
        sourceId: 'PB-P001',
        titles: [{ text: 'La Nouvelle France', role: 'canonical' }],
        kind: 'periodical',
        language: 'French',
        identifiers: [],
      },
      records: [],
      identifierLeaks: [],
    };
    const { runner } = fakeRunner();
    const ctx: SummarizeIssueCtx = {
      runner,
      model: 'claude-sonnet-5',
      source: frenchSource,
      archiveRoot,
      clock: () => new Date(FIXED_DATE),
      log: () => {},
    };

    await expect(summarizeIssue(issueDir, ctx)).rejects.toThrow(/translation pending/);
  });
});
