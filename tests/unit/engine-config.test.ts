import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  resolveEngine,
  resolveModel,
  loadEngineConfig,
  DEFAULT_MODELS,
} from '@/engine/config';

describe('engine/model resolution', () => {
  it('engine: flag over config over default', () => {
    expect(resolveEngine('codex', { engine: 'claude' })).toBe('codex');
    expect(resolveEngine(undefined, { engine: 'codex' })).toBe('codex');
    expect(resolveEngine(undefined, {})).toBe('claude');
  });

  it('engine: unknown flag throws', () => {
    expect(() => resolveEngine('gpt', {})).toThrow(/unknown engine/i);
  });

  it('model: flag over config over per-engine default', () => {
    expect(resolveModel('m1', 'codex', { models: { codex: 'm2' } })).toBe('m1');
    expect(resolveModel(undefined, 'codex', { models: { codex: 'm2' } })).toBe('m2');
    expect(resolveModel(undefined, 'codex', {})).toBe(DEFAULT_MODELS.codex);
    expect(resolveModel(undefined, 'claude', {})).toBe(DEFAULT_MODELS.claude);
  });
});

describe('loadEngineConfig', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function makeRepoRoot(configBody?: string): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'engine-config-'));
    tempDirs.push(dir);
    if (configBody !== undefined) {
      await writeFile(path.join(dir, 'translate.config.json'), configBody, 'utf-8');
    }
    return dir;
  }

  it('returns {} when translate.config.json is absent', async () => {
    const repoRoot = await makeRepoRoot();
    await expect(loadEngineConfig(repoRoot)).resolves.toEqual({});
  });

  it('reads engine + per-engine models when present', async () => {
    const repoRoot = await makeRepoRoot(
      JSON.stringify({ engine: 'codex', models: { claude: 'c1', codex: 'x1' } }),
    );
    await expect(loadEngineConfig(repoRoot)).resolves.toEqual({
      engine: 'codex',
      models: { claude: 'c1', codex: 'x1' },
    });
  });

  it('throws on an unknown engine value in config', async () => {
    const repoRoot = await makeRepoRoot(JSON.stringify({ engine: 'gpt' }));
    await expect(loadEngineConfig(repoRoot)).rejects.toThrow(/unknown engine/i);
  });

  it('throws on a non-object root', async () => {
    const repoRoot = await makeRepoRoot(JSON.stringify('not-an-object'));
    await expect(loadEngineConfig(repoRoot)).rejects.toThrow(/malformed/i);
  });

  it('throws on invalid JSON', async () => {
    const repoRoot = await makeRepoRoot('{ not valid json');
    await expect(loadEngineConfig(repoRoot)).rejects.toThrow();
  });

  it('tolerates unknown keys, ignoring them', async () => {
    const repoRoot = await makeRepoRoot(
      JSON.stringify({ engine: 'claude', somethingUnrelated: 42, models: { claude: 'c1', extra: 'nope' } }),
    );
    await expect(loadEngineConfig(repoRoot)).resolves.toEqual({
      engine: 'claude',
      models: { claude: 'c1' },
    });
  });
});
