import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { stringify } from 'yaml';
import { loadIssueSummary, loadSourceSummary } from '@/browser/load/summary';

/**
 * `loadIssueSummary` / `loadSourceSummary` pair a unit's concise
 * machine-generated summary artifact (`issue.summary.short.en.md` /
 * `source.summary.short.en.md`) with the `MachineAssistLabel` read from its
 * provenance sidecar (see specs/017-asset-summaries/contracts/browser-view.md
 * and src/browser/load/translation.ts, the pattern this mirrors).
 *
 * Honest-absence semantics: a missing concise artifact -> `null` (graceful
 * no-summary state), never fabricated. A PRESENT artifact with a missing or
 * corrupt sidecar throws (fail loud) -- unlike the optional translation
 * machine-assist label, `LoadedSummary.label` is a required field, so there
 * is no honest partial state once the artifact exists.
 */

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeUnitDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'corpus-browser-summary-'));
  tempDirs.push(dir);
  return dir;
}

function writeConcise(unitDir: string, filename: string, content: string): void {
  writeFileSync(path.join(unitDir, filename), content, 'utf-8');
}

function writeSidecar(unitDir: string, filename: string, fields: Record<string, unknown>): void {
  writeFileSync(path.join(unitDir, filename), stringify(fields), 'utf-8');
}

const COMPLETE_SIDECAR_FIELDS = {
  engine: 'claude-code-cli',
  model: 'claude-sonnet-5',
  retrieved: '2026-07-21',
};

describe('loadIssueSummary', () => {
  it('returns { concise, label } when issue.summary.short.en.md + its sidecar exist', () => {
    const issueDir = makeUnitDir();
    writeConcise(issueDir, 'issue.summary.short.en.md', 'The colony sought new settlers.');
    writeSidecar(issueDir, 'issue.summary.short.en.md.yml', COMPLETE_SIDECAR_FIELDS);

    const result = loadIssueSummary(issueDir);

    expect(result).not.toBeNull();
    expect(result?.concise).toBe('The colony sought new settlers.');
    expect(result?.label).toEqual({
      engine: 'claude-code-cli',
      model: 'claude-sonnet-5',
      retrieved: '2026-07-21',
    });
  });

  it('returns null when the concise artifact is absent (honest absence, graceful no-summary)', () => {
    const issueDir = makeUnitDir();

    const result = loadIssueSummary(issueDir);

    expect(result).toBeNull();
  });

  it('throws when the concise artifact is present but its sidecar is missing', () => {
    const issueDir = makeUnitDir();
    writeConcise(issueDir, 'issue.summary.short.en.md', 'The colony sought new settlers.');

    expect(() => loadIssueSummary(issueDir)).toThrow();
  });

  it('throws when the sidecar does not parse to a YAML mapping', () => {
    const issueDir = makeUnitDir();
    writeConcise(issueDir, 'issue.summary.short.en.md', 'The colony sought new settlers.');
    writeFileSync(
      path.join(issueDir, 'issue.summary.short.en.md.yml'),
      '- just\n- a\n- list\n',
      'utf-8'
    );

    expect(() => loadIssueSummary(issueDir)).toThrow();
  });

  it('throws naming the missing field when the sidecar lacks "engine"', () => {
    const issueDir = makeUnitDir();
    writeConcise(issueDir, 'issue.summary.short.en.md', 'The colony sought new settlers.');
    writeSidecar(issueDir, 'issue.summary.short.en.md.yml', {
      model: 'claude-sonnet-5',
      retrieved: '2026-07-21',
    });

    expect(() => loadIssueSummary(issueDir)).toThrow(/engine/);
  });

  it('throws naming the missing field when the sidecar lacks "retrieved"', () => {
    const issueDir = makeUnitDir();
    writeConcise(issueDir, 'issue.summary.short.en.md', 'The colony sought new settlers.');
    writeSidecar(issueDir, 'issue.summary.short.en.md.yml', {
      engine: 'claude-code-cli',
      model: 'claude-sonnet-5',
    });

    expect(() => loadIssueSummary(issueDir)).toThrow(/retrieved/);
  });

  it('carries model: null when the sidecar omits the optional "model" field', () => {
    const issueDir = makeUnitDir();
    writeConcise(issueDir, 'issue.summary.short.en.md', 'The colony sought new settlers.');
    writeSidecar(issueDir, 'issue.summary.short.en.md.yml', {
      engine: 'claude-code-cli',
      retrieved: '2026-07-21',
    });

    const result = loadIssueSummary(issueDir);

    expect(result?.label.model).toBeNull();
  });
});

describe('loadSourceSummary', () => {
  it('returns { concise, label } when source.summary.short.en.md + its sidecar exist', () => {
    const sourceDir = makeUnitDir();
    writeConcise(sourceDir, 'source.summary.short.en.md', 'A periodical covering the colony.');
    writeSidecar(sourceDir, 'source.summary.short.en.md.yml', COMPLETE_SIDECAR_FIELDS);

    const result = loadSourceSummary(sourceDir);

    expect(result).not.toBeNull();
    expect(result?.concise).toBe('A periodical covering the colony.');
    expect(result?.label.engine).toBe('claude-code-cli');
  });

  it('returns null when the source concise artifact is absent', () => {
    const sourceDir = makeUnitDir();

    expect(loadSourceSummary(sourceDir)).toBeNull();
  });

  it('throws when the source concise artifact is present but corrupt (no sidecar)', () => {
    const sourceDir = makeUnitDir();
    writeConcise(sourceDir, 'source.summary.short.en.md', 'A periodical covering the colony.');

    expect(() => loadSourceSummary(sourceDir)).toThrow();
  });
});
