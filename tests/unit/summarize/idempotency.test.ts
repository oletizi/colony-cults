import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeProvenance, type ProvenanceFields } from '@/archive/provenance';
import { companionYamlPath } from '@/archive/store';
import { issueThoroughSummaryPath } from '@/summarize/artifacts';
import { checkSummaryFreshness, summaryIsUpToDate } from '@/summarize/idempotency';
import type { SelectedInputLayer } from '@/summarize/select-input';

/**
 * Unit coverage for the formalized input-layer sha idempotency key (T031,
 * US5, FR-010, research.md Decision 4): a summary is up-to-date iff its
 * thorough sidecar exists AND every entry in {@link SelectedInputLayer}
 * matches, in order, the sidecar's recorded `input_layers[*].{path,sha256}`.
 * Extracted from the inline `isUpToDate` this test formalizes into
 * `src/summarize/idempotency.ts` (T033) -- `summarizeIssue` (T034) is
 * refactored to call it rather than duplicate the comparison.
 */

/** Minimal valid thorough-summary provenance record, overridable per test. */
function baseSummaryProvenance(
  overrides: Partial<ProvenanceFields> = {},
): ProvenanceFields {
  return {
    id: 'PB-P001',
    title: 'La Nouvelle France',
    type: 'summary-thorough',
    case: 'port-breton',
    language: 'English',
    source_archive: 'Gallica / BnF',
    catalog_url: 'https://gallica.bnf.fr/ark:/12148/bpt6k5603637g',
    original_url: '',
    rights_status: 'public-domain',
    retrieved: '2026-07-21T00:00:00.000Z',
    local_path: 'archive/cases/port-breton/.../issue.summary.long.en.md',
    sha256: 'b'.repeat(64),
    size: 812,
    format: 'text/markdown',
    ocr_status: 'searchable',
    engine: 'claude-code-cli',
    model: 'claude-sonnet-5',
    interpretation: 'machine-generated-summary',
    object_store: null,
    rights_raw: '<results/>',
    notes: null,
    ...overrides,
  };
}

const LAYERS: SelectedInputLayer[] = [
  { path: 'issue.txt', sha256: 'c'.repeat(64) },
  { path: 'issue.en.txt', sha256: 'd'.repeat(64) },
];

describe('checkSummaryFreshness / summaryIsUpToDate (T031, US5, FR-010)', () => {
  let issueDir: string;

  beforeEach(() => {
    issueDir = mkdtempSync(path.join(tmpdir(), 'cc-idempotency-'));
  });

  afterEach(() => {
    rmSync(issueDir, { recursive: true, force: true });
  });

  it('reports "fresh" when no thorough summary sidecar exists yet', async () => {
    const result = await checkSummaryFreshness(issueDir, LAYERS);
    expect(result.freshness).toBe('fresh');
    expect(await summaryIsUpToDate(issueDir, LAYERS)).toBe(false);
  });

  it('reports "up-to-date" when every selected layer path+sha256 matches the recorded input_layers, in order', async () => {
    await writeProvenance(
      companionYamlPath(issueThoroughSummaryPath(issueDir)),
      baseSummaryProvenance({ input_layers: LAYERS }),
    );

    const result = await checkSummaryFreshness(issueDir, LAYERS);
    expect(result.freshness).toBe('up-to-date');
    expect(await summaryIsUpToDate(issueDir, LAYERS)).toBe(true);
  });

  it('reports "stale" when one layer\'s sha256 differs from the recorded value', async () => {
    await writeProvenance(
      companionYamlPath(issueThoroughSummaryPath(issueDir)),
      baseSummaryProvenance({ input_layers: LAYERS }),
    );

    const mutated: SelectedInputLayer[] = [
      LAYERS[0],
      { path: 'issue.en.txt', sha256: 'e'.repeat(64) },
    ];

    const result = await checkSummaryFreshness(issueDir, mutated);
    expect(result.freshness).toBe('stale');
    expect(await summaryIsUpToDate(issueDir, mutated)).toBe(false);
  });

  it('reports "stale" when the selected layer set has a different length than recorded', async () => {
    await writeProvenance(
      companionYamlPath(issueThoroughSummaryPath(issueDir)),
      baseSummaryProvenance({ input_layers: [LAYERS[0]] }),
    );

    const result = await checkSummaryFreshness(issueDir, LAYERS);
    expect(result.freshness).toBe('stale');
  });

  it('reports "stale" (never throws) when the recorded sidecar has no input_layers at all', async () => {
    await writeProvenance(
      companionYamlPath(issueThoroughSummaryPath(issueDir)),
      baseSummaryProvenance({ input_layers: undefined }),
    );

    const result = await checkSummaryFreshness(issueDir, LAYERS);
    expect(result.freshness).toBe('stale');
  });

  it('fails loud when the sidecar exists but is genuinely corrupt (unparseable)', async () => {
    const yamlPath = companionYamlPath(issueThoroughSummaryPath(issueDir));
    mkdirSync(path.dirname(yamlPath), { recursive: true });
    // Missing required fields (e.g. no `object_store` key at all) -- this is
    // corrupt state, not absence, and must fail loud rather than being
    // silently treated as "not up to date".
    writeFileSync(yamlPath, 'id: "PB-P001"\n', 'utf-8');

    await expect(checkSummaryFreshness(issueDir, LAYERS)).rejects.toThrow();
  });
});
