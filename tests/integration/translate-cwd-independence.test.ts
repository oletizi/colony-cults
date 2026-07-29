import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { ParsedArgs } from '@/cli/parse';
import {
  runTranslateSource,
  translateSourcesDir,
  type TranslateCliDeps,
} from '@/cli/translate';
import type { TranslationEngine } from '@/engine/types';

/**
 * AUDIT-22: `translate` / `translate-source` MUST RESOLVE THE SSOT
 * CWD-INDEPENDENTLY.
 *
 * Both commands built their `bibliography/sources` path as
 * `path.join(process.cwd(), 'bibliography', 'sources')`. Run from anywhere but
 * the repo root -- which is a completely ordinary thing to do -- that path does
 * not exist, and `sourceKind` deliberately treats an ABSENT directory as a
 * lookup MISS rather than an error. The consequences were both silent:
 *
 *   1. the Source Group guardrail never fired, so `translate-source <group>`
 *      fell through to a confusing downstream layout error instead of the
 *      intended "a Source Group has no archival object to translate"; and
 *   2. `ensureMemberLayoutRegistered` found no member file, so a source-group
 *      member's archive layout went UNREGISTERED with no diagnostic.
 *
 * These cases run with `process.cwd()` pointed at an empty temp directory --
 * the condition the defect needs -- and assert the commands behave exactly as
 * they do from the repo root.
 */

/** A source-group id that really exists in the committed SSOT. */
const GROUP_SOURCE_ID = 'PB-P060';

const UNUSED_ENGINE: TranslationEngine = {
  name: 'unused-in-this-test',
  run: () => {
    throw new Error('the engine must never be reached: the guardrail throws first');
  },
};

function args(sourceId: string): ParsedArgs {
  return {
    command: 'translate-source',
    positional: [sourceId],
    flags: {
      dryRun: false,
      force: false,
      verify: false,
      ocr: false,
      enhanceContrast: false,
      objectStore: false,
      reconcileRemote: false,
      checkpoint: false,
    },
    options: {},
  };
}

function deps(archiveRoot: string): TranslateCliDeps {
  return {
    engine: UNUSED_ENGINE,
    model: 'unused-in-this-test',
    archiveRoot,
    clock: () => new Date('2026-07-27T00:00:00.000Z'),
    log: () => {},
    preflight: async () => {},
    delay: async () => {},
  };
}

describe('translate SSOT resolution is cwd-independent (AUDIT-22)', () => {
  let elsewhere: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    elsewhere = mkdtempSync(path.join(tmpdir(), 'cc-translate-cwd-'));
    process.chdir(elsewhere);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(elsewhere, { recursive: true, force: true });
  });

  it('resolves the sources dir to the repo SSOT, not to the current directory', () => {
    const resolved = translateSourcesDir();
    expect(resolved).toBe(path.join(originalCwd, 'bibliography', 'sources'));
    expect(resolved.startsWith(elsewhere)).toBe(false);
  });

  it('translate-source still refuses a Source Group when run from another directory', async () => {
    await expect(
      runTranslateSource(args(GROUP_SOURCE_ID), deps(path.join(elsewhere, 'archive-root'))),
    ).rejects.toThrow(/is a Source Group/i);
  });
});
