import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseProvenance, type ProvenanceFields } from '@/archive/provenance';
import {
  buildSummaryProvenance,
  issueThoroughSummaryPath,
  issueConciseSummaryPath,
  sourceThoroughSummaryPath,
  sourceConciseSummaryPath,
} from '@/summarize/artifacts';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(here, '../../fixtures/page-provenance.yml');

function loadBase(): ProvenanceFields {
  return parseProvenance(readFileSync(FIXTURE_PATH, 'utf-8'));
}

const INPUT_LAYERS = [
  { path: 'issue.txt', sha256: 'c'.repeat(64) },
  { path: 'issue.en.txt', sha256: 'd'.repeat(64) },
];

describe('issueThoroughSummaryPath / issueConciseSummaryPath', () => {
  it('builds the thorough issue summary path', () => {
    expect(issueThoroughSummaryPath('/archive/issue-dir')).toBe(
      path.join('/archive/issue-dir', 'issue.summary.long.en.md'),
    );
  });

  it('builds the concise issue summary path', () => {
    expect(issueConciseSummaryPath('/archive/issue-dir')).toBe(
      path.join('/archive/issue-dir', 'issue.summary.short.en.md'),
    );
  });
});

describe('sourceThoroughSummaryPath / sourceConciseSummaryPath', () => {
  it('builds the thorough source rollup summary path', () => {
    expect(sourceThoroughSummaryPath('/archive/source-dir')).toBe(
      path.join('/archive/source-dir', 'source.summary.long.en.md'),
    );
  });

  it('builds the concise source rollup summary path', () => {
    expect(sourceConciseSummaryPath('/archive/source-dir')).toBe(
      path.join('/archive/source-dir', 'source.summary.short.en.md'),
    );
  });
});

describe('buildSummaryProvenance', () => {
  it('sets summary-specific fields for the thorough depth', () => {
    const base = loadBase();
    const result = buildSummaryProvenance(
      base,
      'thorough',
      'claude-code-cli',
      'claude-sonnet-5',
      '2026-07-21',
      INPUT_LAYERS,
    );

    expect(result.type).toBe('summary-thorough');
    expect(result.format).toBe('text/markdown');
    expect(result.language).toBe('English');
    expect(result.engine).toBe('claude-code-cli');
    expect(result.model).toBe('claude-sonnet-5');
    expect(result.retrieved).toBe('2026-07-21');
    expect(result.interpretation).toBe('machine-generated-summary');
    expect(result.input_layers).toEqual(INPUT_LAYERS);
    expect(result.object_store).toBeNull();
  });

  it('sets summary-specific fields for the concise depth', () => {
    const base = loadBase();
    const result = buildSummaryProvenance(
      base,
      'concise',
      'claude-code-cli',
      'claude-sonnet-5',
      '2026-07-21',
      INPUT_LAYERS,
    );

    expect(result.type).toBe('summary-concise');
    expect(result.format).toBe('text/markdown');
    expect(result.language).toBe('English');
    expect(result.interpretation).toBe('machine-generated-summary');
    expect(result.object_store).toBeNull();
  });

  it('derives rights/catalog fields from base', () => {
    const base = loadBase();
    const result = buildSummaryProvenance(
      base,
      'thorough',
      'claude-code-cli',
      'claude-sonnet-5',
      '2026-07-21',
      INPUT_LAYERS,
    );

    expect(result.id).toBe(base.id);
    expect(result.title).toBe(base.title);
    expect(result.case).toBe(base.case);
    expect(result.source_archive).toBe(base.source_archive);
    expect(result.catalog_url).toBe(base.catalog_url);
    expect(result.original_url).toBe(base.original_url);
    expect(result.rights_status).toBe(base.rights_status);
    expect(result.rights_raw).toBe(base.rights_raw);
    expect(result.notes).toBe(base.notes);
  });

  it('does not mutate the base ProvenanceFields', () => {
    const base = loadBase();
    const baseCopy = { ...base };
    buildSummaryProvenance(
      base,
      'thorough',
      'claude-code-cli',
      'claude-sonnet-5',
      '2026-07-21',
      INPUT_LAYERS,
    );
    expect(base).toEqual(baseCopy);
  });

  it('returns a distinct object, not the same reference as base', () => {
    const base = loadBase();
    const result = buildSummaryProvenance(
      base,
      'thorough',
      'claude-code-cli',
      'claude-sonnet-5',
      '2026-07-21',
      INPUT_LAYERS,
    );
    expect(result).not.toBe(base);
  });

  it('sets input_quality when provided (FR-016)', () => {
    const base = loadBase();
    const result = buildSummaryProvenance(
      base,
      'thorough',
      'claude-code-cli',
      'claude-sonnet-5',
      '2026-07-21',
      INPUT_LAYERS,
      { tier: 'low', note: 'source OCR low-confidence; summary may inherit errors' },
    );

    expect(result.input_quality).toEqual({
      tier: 'low',
      note: 'source OCR low-confidence; summary may inherit errors',
    });
  });

  it('omits input_quality when not provided', () => {
    const base = loadBase();
    const result = buildSummaryProvenance(
      base,
      'thorough',
      'claude-code-cli',
      'claude-sonnet-5',
      '2026-07-21',
      INPUT_LAYERS,
    );

    expect(result.input_quality).toBeUndefined();
  });
});
