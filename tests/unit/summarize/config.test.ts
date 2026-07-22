import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  resolveSummaryModel,
  resolveSummarizerName,
  loadSummaryConfig,
  DEFAULT_SUMMARY_MODEL,
} from '@/summarize/config';

describe('summarize/config resolution', () => {
  it('model: flag over config over default', () => {
    expect(resolveSummaryModel('m1', { model: 'm2' })).toBe('m1');
    expect(resolveSummaryModel(undefined, { model: 'm2' })).toBe('m2');
    expect(resolveSummaryModel(undefined, {})).toBe(DEFAULT_SUMMARY_MODEL);
    expect(resolveSummaryModel(undefined)).toBe(DEFAULT_SUMMARY_MODEL);
  });

  it('model: an empty/whitespace-only flag falls through to config', () => {
    expect(resolveSummaryModel('   ', { model: 'm2' })).toBe('m2');
    expect(resolveSummaryModel('', { model: 'm2' })).toBe('m2');
    expect(resolveSummaryModel('', {})).toBe(DEFAULT_SUMMARY_MODEL);
  });

  it('engine: flag over config over default', () => {
    expect(resolveSummarizerName('claude', { engine: 'claude' })).toBe('claude');
    expect(resolveSummarizerName(undefined, { engine: 'claude' })).toBe('claude');
    expect(resolveSummarizerName(undefined, {})).toBe('claude');
    expect(resolveSummarizerName(undefined)).toBe('claude');
  });

  it('engine: unknown flag throws', () => {
    expect(() => resolveSummarizerName('gpt', {})).toThrow(/unknown summarizer/i);
  });

  it('engine: an empty/whitespace-only flag falls through to config', () => {
    expect(resolveSummarizerName('   ', { engine: 'claude' })).toBe('claude');
    expect(resolveSummarizerName('', { engine: 'claude' })).toBe('claude');
    expect(resolveSummarizerName('', {})).toBe('claude');
  });
});

/**
 * AUDIT-20260722-03: `loadSummaryConfig` mirrors `loadEngineConfig`
 * (`src/engine/config.ts`) -- the summarize CLI previously had NO config
 * loader at all, so `flag > config > default` silently degraded to
 * `flag > default`. These cover the loader itself; `resolveSummaryModel`'s
 * "no flag -> config wins" behavior is covered above (`model: flag over
 * config over default`) -- this is the missing wiring that feeds it a real
 * config instead of `undefined`.
 */
describe('loadSummaryConfig', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function makeRepoRoot(configBody?: string): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'summary-config-'));
    tempDirs.push(dir);
    if (configBody !== undefined) {
      await writeFile(path.join(dir, 'summarize.config.json'), configBody, 'utf-8');
    }
    return dir;
  }

  it('returns {} when summarize.config.json is absent', async () => {
    const repoRoot = await makeRepoRoot();
    await expect(loadSummaryConfig(repoRoot)).resolves.toEqual({});
  });

  it('reads model + engine when present, and a config-provided model wins when no --model flag is passed (AUDIT-20260722-03)', async () => {
    const repoRoot = await makeRepoRoot(
      JSON.stringify({ model: 'claude-opus-4-8', engine: 'claude' }),
    );
    const config = await loadSummaryConfig(repoRoot);
    expect(config).toEqual({ model: 'claude-opus-4-8', engine: 'claude' });

    // The no-flag path: a config-provided model is used when no --model flag
    // was passed on the CLI (flag > config > default).
    expect(resolveSummaryModel(undefined, config)).toBe('claude-opus-4-8');
    expect(resolveSummarizerName(undefined, config)).toBe('claude');
  });

  it('throws on an unknown engine value in config', async () => {
    const repoRoot = await makeRepoRoot(JSON.stringify({ engine: 'gpt' }));
    await expect(loadSummaryConfig(repoRoot)).rejects.toThrow(/unknown summarizer/i);
  });

  it('throws on a non-object root', async () => {
    const repoRoot = await makeRepoRoot(JSON.stringify('not-an-object'));
    await expect(loadSummaryConfig(repoRoot)).rejects.toThrow(/malformed/i);
  });

  it('throws on invalid JSON', async () => {
    const repoRoot = await makeRepoRoot('{ not valid json');
    await expect(loadSummaryConfig(repoRoot)).rejects.toThrow();
  });

  it('tolerates unknown keys, ignoring them', async () => {
    const repoRoot = await makeRepoRoot(
      JSON.stringify({ model: 'claude-opus-4-8', somethingUnrelated: 42 }),
    );
    await expect(loadSummaryConfig(repoRoot)).resolves.toEqual({ model: 'claude-opus-4-8' });
  });
});
