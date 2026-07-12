import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadSearchLogForValidate } from '@/bibliography/validate-search-log';

/**
 * T024: `bib validate` must load `bibliography/search-log.yml` alongside the
 * SSOT sources, so a malformed search-log (V6 duplicate id, V7 missing
 * required field) fails loud as part of `bib validate` -- not only when `bib
 * coverage` happens to run. `runValidate` (`@/cli/bibliography`) calls this
 * exact function; `resolveRepoRoot()` always resolves to this checked-out
 * repo (no override), so this suite exercises the wiring directly against a
 * temp `repoRoot` rather than through the CLI.
 */

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), 'validate-search-log-test-'));
  mkdirSync(path.join(repoRoot, 'bibliography'), { recursive: true });
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

function writeSearchLog(contents: string): void {
  writeFileSync(path.join(repoRoot, 'bibliography', 'search-log.yml'), contents, 'utf-8');
}

describe('loadSearchLogForValidate (bib validate wiring for V6/V7)', () => {
  it('resolves bibliography/search-log.yml under repoRoot and returns its parsed entries', () => {
    writeSearchLog(`
- id: SRCH-0001
  date: 2026-07-03
  repository: State Library of Queensland
  campaign: PB-P004
  scope: "de Rays trial records"
  coverage: "catalogue searched; nothing new"
`);
    const entries = loadSearchLogForValidate(repoRoot);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('SRCH-0001');
  });

  it('returns [] when search-log.yml is absent (not required to exist yet)', () => {
    expect(loadSearchLogForValidate(repoRoot)).toEqual([]);
  });

  it('fails loud on a duplicate search-log id (V6), naming the duplicate', () => {
    writeSearchLog(`
- id: SRCH-0001
  date: 2026-07-03
  repository: State Library of Queensland
  campaign: PB-P004
  scope: "de Rays trial records"
  coverage: "catalogue searched; nothing new"
- id: SRCH-0001
  date: 2026-07-05
  repository: Gallica / BnF
  campaign: PB-P004
  scope: "Marquis de Rays pamphlets"
  coverage: "OAI search; 1 new candidate"
`);
    expect(() => loadSearchLogForValidate(repoRoot)).toThrow(/SRCH-0001/);
    expect(() => loadSearchLogForValidate(repoRoot)).toThrow(/duplicate/i);
  });

  it('fails loud when a search-log entry is missing a required field (V7), naming the entry', () => {
    writeSearchLog(`
- id: SRCH-0001
  date: 2026-07-03
  repository: State Library of Queensland
  campaign: PB-P004
  scope: "de Rays trial records"
`);
    expect(() => loadSearchLogForValidate(repoRoot)).toThrow(/SRCH-0001/);
    expect(() => loadSearchLogForValidate(repoRoot)).toThrow(/coverage/);
  });
});
