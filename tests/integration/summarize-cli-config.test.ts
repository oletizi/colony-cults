import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from '@/cli/parse';
import { buildSummarizeCliDeps, buildSummarizeSourceCliDeps } from '@/cli/summarize';

/**
 * AUDIT-20260722-03: `buildSummarizeCliDeps`/`buildSummarizeSourceCliDeps`
 * previously called `resolveSummarizerName`/`resolveSummaryModel` WITHOUT
 * ever loading `summarize.config.json`, so `flag > config > default`
 * silently degraded to `flag > default` -- a repository-configured model was
 * unreachable without passing `--model` on every single invocation.
 *
 * These drive the real dep builders (not just the resolver functions in
 * isolation) against a temp `repoRoot` holding a `summarize.config.json`, to
 * prove the config file is actually consulted end-to-end when no `--model`
 * flag is present on the CLI invocation.
 */
describe('buildSummarizeCliDeps / buildSummarizeSourceCliDeps: summarize.config.json wiring (AUDIT-20260722-03)', () => {
  const tempDirs: string[] = [];
  const prevCwd = process.cwd();
  const prevArchiveRoot = process.env.COLONY_ARCHIVE_ROOT;

  afterEach(async () => {
    process.chdir(prevCwd);
    if (prevArchiveRoot === undefined) {
      delete process.env.COLONY_ARCHIVE_ROOT;
    } else {
      process.env.COLONY_ARCHIVE_ROOT = prevArchiveRoot;
    }
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function makeRepoRootWithConfig(model: string): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'summarize-cli-config-'));
    tempDirs.push(dir);
    await writeFile(
      path.join(dir, 'summarize.config.json'),
      JSON.stringify({ model }),
      'utf-8',
    );
    return dir;
  }

  it('buildSummarizeCliDeps: a config-provided model is used when no --model flag is passed', async () => {
    const repoRoot = await makeRepoRootWithConfig('claude-opus-4-8');
    process.env.COLONY_ARCHIVE_ROOT = path.join(repoRoot, 'archive-root');
    process.chdir(repoRoot);

    const args = parse(['summarize', 'PB-P001']);
    const deps = await buildSummarizeCliDeps(args);

    expect(deps.model).toBe('claude-opus-4-8');
  });

  it('buildSummarizeSourceCliDeps: a config-provided model is used when no --model flag is passed', async () => {
    const repoRoot = await makeRepoRootWithConfig('claude-opus-4-8');
    process.env.COLONY_ARCHIVE_ROOT = path.join(repoRoot, 'archive-root');
    process.chdir(repoRoot);

    const args = parse(['summarize-source', 'PB-P001']);
    const deps = await buildSummarizeSourceCliDeps(args);

    expect(deps.model).toBe('claude-opus-4-8');
  });

  it('buildSummarizeCliDeps: an explicit --model flag still beats the config value', async () => {
    const repoRoot = await makeRepoRootWithConfig('claude-opus-4-8');
    process.env.COLONY_ARCHIVE_ROOT = path.join(repoRoot, 'archive-root');
    process.chdir(repoRoot);

    const args = parse(['summarize', 'PB-P001', '--model', 'claude-sonnet-5']);
    const deps = await buildSummarizeCliDeps(args);

    expect(deps.model).toBe('claude-sonnet-5');
  });
});
