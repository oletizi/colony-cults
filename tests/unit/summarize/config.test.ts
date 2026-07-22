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

  /**
   * AUDIT-20260722-13: loadSummaryConfig must fail loud when a known key
   * is present but malformed (wrong type), instead of silently accepting
   * and falling back to defaults.
   */
  describe('malformed known keys (AUDIT-20260722-13)', () => {
    it('throws when model is present but not a string (number)', async () => {
      const repoRoot = await makeRepoRoot(JSON.stringify({ model: 123 }));
      await expect(loadSummaryConfig(repoRoot)).rejects.toThrow(
        /invalid model field.*expected string.*number/i,
      );
    });

    it('throws when model is present but not a string (object)', async () => {
      const repoRoot = await makeRepoRoot(JSON.stringify({ model: { nested: 'value' } }));
      await expect(loadSummaryConfig(repoRoot)).rejects.toThrow(
        /invalid model field.*expected string.*object/i,
      );
    });

    it('throws when model is present but not a string (array)', async () => {
      const repoRoot = await makeRepoRoot(JSON.stringify({ model: ['a', 'b'] }));
      await expect(loadSummaryConfig(repoRoot)).rejects.toThrow(
        /invalid model field.*expected string.*object/i,
      );
    });

    it('throws when model is present but not a string (boolean)', async () => {
      const repoRoot = await makeRepoRoot(JSON.stringify({ model: true }));
      await expect(loadSummaryConfig(repoRoot)).rejects.toThrow(
        /invalid model field.*expected string.*boolean/i,
      );
    });

    it('throws when engine is present but not a string (number)', async () => {
      const repoRoot = await makeRepoRoot(JSON.stringify({ engine: 456 }));
      await expect(loadSummaryConfig(repoRoot)).rejects.toThrow(
        /invalid engine field.*expected string.*number/i,
      );
    });

    it('throws when engine is present but not a string (object)', async () => {
      const repoRoot = await makeRepoRoot(JSON.stringify({ engine: { type: 'claude' } }));
      await expect(loadSummaryConfig(repoRoot)).rejects.toThrow(
        /invalid engine field.*expected string.*object/i,
      );
    });

    it('throws when engine is present but not a string (array)', async () => {
      const repoRoot = await makeRepoRoot(JSON.stringify({ engine: ['claude'] }));
      await expect(loadSummaryConfig(repoRoot)).rejects.toThrow(
        /invalid engine field.*expected string.*object/i,
      );
    });

    it('throws when engine is present but not a string (boolean)', async () => {
      const repoRoot = await makeRepoRoot(JSON.stringify({ engine: false }));
      await expect(loadSummaryConfig(repoRoot)).rejects.toThrow(
        /invalid engine field.*expected string.*boolean/i,
      );
    });

    it('succeeds when both model and engine are absent (defaults ok)', async () => {
      const repoRoot = await makeRepoRoot(JSON.stringify({}));
      await expect(loadSummaryConfig(repoRoot)).resolves.toEqual({});
    });

    it('succeeds when unrelated keys are present with malformed types (unknown keys ignored)', async () => {
      const repoRoot = await makeRepoRoot(
        JSON.stringify({
          model: 'claude-opus-4-8',
          someNumber: 42,
          someObject: { nested: true },
          someArray: [1, 2, 3],
        }),
      );
      await expect(loadSummaryConfig(repoRoot)).resolves.toEqual({ model: 'claude-opus-4-8' });
    });
  });
});
