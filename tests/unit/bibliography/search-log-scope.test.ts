import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadSearchLog } from '@/bibliography/search-log';
import type { ScopeResolutionContext } from '@/bibliography/scope';
import { resolveScopeRef } from '@/bibliography/scope';
import { validateSearchLogScopes } from '@/bibliography/validate-search-log';
import type { Source } from '@/model/source';

/**
 * T010 (US1): the search-log `campaign:` -> `scope:` clean-break cutover
 * (spec 010, FR-004/FR-005, INV-CUT). Covers:
 * (a) the loader THROWS on a `campaign:` key (INV-2, clean break);
 * (b) the loader accepts a well-formed `scope:` entry;
 * (c) validation FAILS LOUD (as a ValidationFinding) when a scope does not
 *     resolve under its declared kind;
 * (d) validation passes for the rewritten SRCH-0001 shape
 *     (`{ kind: work-bundle, id: PB-P004 }` against a corpus that holds
 *     PB-P004 as a source-group).
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'search-log-scope-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeSearchLog(contents: string): string {
  const filePath = path.join(dir, 'search-log.yml');
  writeFileSync(filePath, contents, 'utf-8');
  return filePath;
}

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    sourceId: 'PB-P001',
    kind: 'monograph',
    titles: [{ text: 'La Nouvelle France', role: 'canonical' }],
    identifiers: [],
    ...overrides,
  };
}

describe('loadSearchLog: campaign: is a hard error (INV-2, clean break)', () => {
  it('throws, naming the entry and the retired key, on a campaign: key', () => {
    const yaml = `
- id: SRCH-0001
  date: 2026-07-03
  repository: State Library of Queensland
  campaign: PB-P004
  query: "de Rays trial records, 1880s"
  coverage: "catalogue searched; 2 hits, both already held"
`;
    const filePath = writeSearchLog(yaml);
    expect(() => loadSearchLog(filePath)).toThrow(/SRCH-0001/);
    expect(() => loadSearchLog(filePath)).toThrow(/campaign/);
  });
});

describe('loadSearchLog: accepts a well-formed scope: entry', () => {
  it('parses scope: { kind, id } into a typed ScopeRef', () => {
    const yaml = `
- id: SRCH-0001
  date: 2026-07-03
  repository: State Library of Queensland
  scope:
    kind: work
    id: PB-P001
  query: "de Rays trial records, 1880s"
  coverage: "catalogue searched; 2 hits, both already held"
`;
    const filePath = writeSearchLog(yaml);
    const entries = loadSearchLog(filePath);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.scope).toEqual({ kind: 'work', id: 'PB-P001' });
  });

  it('rejects a scope: kind outside the closed vocabulary', () => {
    const yaml = `
- id: SRCH-0001
  date: 2026-07-03
  repository: State Library of Queensland
  scope:
    kind: bogus-kind
    id: PB-P001
  query: "de Rays trial records, 1880s"
  coverage: "catalogue searched"
`;
    const filePath = writeSearchLog(yaml);
    expect(() => loadSearchLog(filePath)).toThrow(/kind/);
  });
});

describe('validateSearchLogScopes: fails loud when a scope does not resolve', () => {
  it('reports a finding for { kind: work, id: <a source-group> }', () => {
    const group = makeSource({ sourceId: 'PB-P004', kind: 'source-group' });
    const ctx: ScopeResolutionContext = { sources: [group], threadIds: new Set() };
    const entries = loadSearchLog(
      writeSearchLog(`
- id: SRCH-0009
  date: 2026-07-03
  repository: Gallica / BnF
  scope:
    kind: work
    id: PB-P004
  query: "mismatched kind"
  coverage: "n/a"
`),
    );

    const findings = validateSearchLogScopes(entries, ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe('search-log-scope-unresolved');
    expect(findings[0]?.detail).toContain('SRCH-0009');
    expect(findings[0]?.detail).toContain('PB-P004');
  });

  it('throws nothing directly -- resolveScopeRef itself throws on the same mismatch', () => {
    const group = makeSource({ sourceId: 'PB-P004', kind: 'source-group' });
    const ctx: ScopeResolutionContext = { sources: [group], threadIds: new Set() };
    expect(() => resolveScopeRef({ kind: 'work', id: 'PB-P004' }, ctx)).toThrow();
  });
});

describe('validateSearchLogScopes: passes for the rewritten SRCH-0001 shape', () => {
  it('reports no finding for { kind: work-bundle, id: PB-P004 } against a corpus holding PB-P004 as a source-group', () => {
    const group = makeSource({ sourceId: 'PB-P004', kind: 'source-group' });
    const ctx: ScopeResolutionContext = { sources: [group], threadIds: new Set() };
    const entries = loadSearchLog(
      writeSearchLog(`
- id: SRCH-0001
  date: 2026-07-11
  repository: Gallica / BnF
  scope:
    kind: work-bundle
    id: PB-P004
  query: "Marquis de Rays trial + Port-Breton colony imprints"
  coverage: "5 trial/colony imprints resolved"
`),
    );

    expect(validateSearchLogScopes(entries, ctx)).toEqual([]);
  });
});
