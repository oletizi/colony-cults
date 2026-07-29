import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parse } from '@/cli/parse';
import { buildSummarizeCliDeps, buildSummarizeSourceCliDeps } from '@/cli/summarize';
import { buildTranslateCliDeps } from '@/cli/translate';

/**
 * AUDIT-22 (second instance): `bib summarize` / `bib summarize-source` /
 * `translate` MUST RESOLVE THE SSOT AND ARCHIVE ROOTS CWD-INDEPENDENTLY, WHILE
 * STILL READING THEIR CONFIG FILE RELATIVE TO CWD.
 *
 * All three dep builders used ONE `const repoRoot = process.cwd()` for two
 * unrelated jobs. Only one of them is legitimately caller-relative:
 *
 *  - `summarize.config.json` / `translate.config.json` are operator-supplied
 *    files that travel with the working directory. That is INTENDED and is
 *    asserted here as well as in `summarize-cli-config.test.ts` (which
 *    `chdir`s for exactly that reason) -- fixing the defect below must not
 *    "fix" this too.
 *  - `bibliography/sources` is a fixed location in the repository. Built from
 *    `process.cwd()`, `bib summarize` run from anywhere but the repo root
 *    pointed `sourcesDir` at a directory that does not exist, and
 *    `ensureMemberLayoutRegistered` documents an absent member as "not a
 *    member" and returns -- so a source-group member's archive layout went
 *    UNREGISTERED with no diagnostic at all.
 *
 * Every case runs with `process.cwd()` pointed at a temp directory holding a
 * config file -- the condition the defect needs -- and asserts BOTH halves:
 * the SSOT/archive resolution still finds the real repo, AND the temp cwd's
 * config is still honored.
 */

/** A model name that appears in NO default and NO committed config, so reading it proves the temp config was consulted. */
const CONFIG_ONLY_MODEL = 'claude-cwd-probe-9';

describe('summarize/translate resolve the SSOT cwd-independently but the config cwd-relatively (AUDIT-22)', () => {
  let elsewhere: string;
  let originalCwd: string;
  const previousArchiveRoot = process.env.COLONY_ARCHIVE_ROOT;

  beforeEach(() => {
    originalCwd = process.cwd();
    elsewhere = mkdtempSync(path.join(tmpdir(), 'cc-summarize-cwd-'));
    writeFileSync(
      path.join(elsewhere, 'summarize.config.json'),
      JSON.stringify({ model: CONFIG_ONLY_MODEL }),
      'utf-8',
    );
    writeFileSync(
      path.join(elsewhere, 'translate.config.json'),
      JSON.stringify({ models: { claude: CONFIG_ONLY_MODEL } }),
      'utf-8',
    );
    // An explicit archive root, so `resolveArchiveRoot` has something to
    // resolve regardless of the developer's environment.
    process.env.COLONY_ARCHIVE_ROOT = path.join(elsewhere, 'archive-root');
    process.chdir(elsewhere);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (previousArchiveRoot === undefined) {
      delete process.env.COLONY_ARCHIVE_ROOT;
    } else {
      process.env.COLONY_ARCHIVE_ROOT = previousArchiveRoot;
    }
    rmSync(elsewhere, { recursive: true, force: true });
  });

  it('buildSummarizeCliDeps: sourcesDir points at the repo SSOT, not the current directory', async () => {
    const deps = await buildSummarizeCliDeps(parse(['summarize', 'PB-P001']));

    expect(deps.sourcesDir).toBe(path.join(originalCwd, 'bibliography', 'sources'));
    expect(deps.sourcesDir.startsWith(elsewhere)).toBe(false);
  });

  it('buildSummarizeCliDeps: the temp cwd’s summarize.config.json is still honored', async () => {
    const deps = await buildSummarizeCliDeps(parse(['summarize', 'PB-P001']));

    expect(deps.model).toBe(CONFIG_ONLY_MODEL);
    expect(deps.archiveRoot).toBe(path.join(elsewhere, 'archive-root'));
  });

  it('buildSummarizeSourceCliDeps: sourcesDir points at the repo SSOT, not the current directory', async () => {
    const deps = await buildSummarizeSourceCliDeps(parse(['summarize-source', 'PB-P001']));

    expect(deps.sourcesDir).toBe(path.join(originalCwd, 'bibliography', 'sources'));
    expect(deps.sourcesDir.startsWith(elsewhere)).toBe(false);
  });

  it('buildSummarizeSourceCliDeps: the temp cwd’s summarize.config.json is still honored', async () => {
    const deps = await buildSummarizeSourceCliDeps(parse(['summarize-source', 'PB-P001']));

    expect(deps.model).toBe(CONFIG_ONLY_MODEL);
    expect(deps.archiveRoot).toBe(path.join(elsewhere, 'archive-root'));
  });

  it('buildTranslateCliDeps: the temp cwd’s translate.config.json is still honored', async () => {
    const deps = await buildTranslateCliDeps(parse(['translate-source', 'PB-P001']));

    expect(deps.model).toBe(CONFIG_ONLY_MODEL);
    expect(deps.archiveRoot).toBe(path.join(elsewhere, 'archive-root'));
  });
});
