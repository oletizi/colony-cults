import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadSearchLog } from '@/bibliography/search-log';

const VALID_YAML = `
- id: SRCH-0001
  date: 2026-07-03
  repository: State Library of Queensland
  scope:
    kind: work-bundle
    id: PB-P004
  query: "de Rays trial records, 1880s"
  coverage: "catalogue searched; 2 hits, both already held"
  remainingQuestions:
    - "appeal-court records not online"
  notes: "revisit after digitisation project completes"
- id: SRCH-0002
  date: 2026-07-05
  repository: Gallica / BnF
  scope:
    kind: work-bundle
    id: PB-P004
  query: "Marquis de Rays pamphlets"
  coverage: "OAI search; 1 new candidate inventoried (PB-P007)"
`;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'bibliography-search-log-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeSearchLog(name: string, contents: string): string {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, contents, 'utf-8');
  return filePath;
}

describe('loadSearchLog', () => {
  it('parses a well-formed entries list into typed SearchLogEntry[]', () => {
    const filePath = writeSearchLog('search-log.yml', VALID_YAML);
    const entries = loadSearchLog(filePath);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      id: 'SRCH-0001',
      date: '2026-07-03',
      repository: 'State Library of Queensland',
      scope: { kind: 'work-bundle', id: 'PB-P004' },
      query: 'de Rays trial records, 1880s',
      coverage: 'catalogue searched; 2 hits, both already held',
      remainingQuestions: ['appeal-court records not online'],
      notes: 'revisit after digitisation project completes',
    });
    expect(entries[1]).toEqual({
      id: 'SRCH-0002',
      date: '2026-07-05',
      repository: 'Gallica / BnF',
      scope: { kind: 'work-bundle', id: 'PB-P004' },
      query: 'Marquis de Rays pamphlets',
      coverage: 'OAI search; 1 new candidate inventoried (PB-P007)',
    });
  });

  it('returns [] when the file is absent (search-log is not required to exist yet)', () => {
    const filePath = path.join(dir, 'does-not-exist.yml');
    expect(loadSearchLog(filePath)).toEqual([]);
  });

  it('fails loud, naming the entry, when a required field is missing', () => {
    const yaml = `
- id: SRCH-0001
  date: 2026-07-03
  repository: State Library of Queensland
  scope:
    kind: work-bundle
    id: PB-P004
  query: "de Rays trial records, 1880s"
`;
    const filePath = writeSearchLog('search-log.yml', yaml);
    expect(() => loadSearchLog(filePath)).toThrow(/SRCH-0001/);
    expect(() => loadSearchLog(filePath)).toThrow(/coverage/);
  });

  it('fails loud, naming the entry by index, when the missing field is id itself', () => {
    const yaml = `
- date: 2026-07-03
  repository: State Library of Queensland
  scope:
    kind: work-bundle
    id: PB-P004
  query: "de Rays trial records, 1880s"
  coverage: "found nothing"
`;
    const filePath = writeSearchLog('search-log.yml', yaml);
    expect(() => loadSearchLog(filePath)).toThrow(/\[0\]/);
    expect(() => loadSearchLog(filePath)).toThrow(/"id"/);
  });

  it('fails loud, naming the duplicate id, when two entries share the same id', () => {
    const yaml = `
- id: SRCH-0001
  date: 2026-07-03
  repository: State Library of Queensland
  scope:
    kind: work-bundle
    id: PB-P004
  query: "de Rays trial records, 1880s"
  coverage: "catalogue searched; nothing new"
- id: SRCH-0001
  date: 2026-07-05
  repository: Gallica / BnF
  scope:
    kind: work-bundle
    id: PB-P004
  query: "Marquis de Rays pamphlets"
  coverage: "OAI search; 1 new candidate"
`;
    const filePath = writeSearchLog('search-log.yml', yaml);
    expect(() => loadSearchLog(filePath)).toThrow(/SRCH-0001/);
    expect(() => loadSearchLog(filePath)).toThrow(/duplicate/i);
  });

  it('fails loud on malformed YAML', () => {
    const filePath = writeSearchLog('search-log.yml', ': not: valid: yaml: [');
    expect(() => loadSearchLog(filePath)).toThrow();
  });

  it('fails loud when the document is not a list', () => {
    const filePath = writeSearchLog('search-log.yml', 'id: SRCH-0001\n');
    expect(() => loadSearchLog(filePath)).toThrow(/list/);
  });

  it('treats an empty file as no entries', () => {
    const filePath = writeSearchLog('search-log.yml', '');
    expect(loadSearchLog(filePath)).toEqual([]);
  });

  it('rejects an entry with an unknown key (no silent drop)', () => {
    const yaml = `
- id: SRCH-0001
  date: 2026-07-03
  repository: State Library of Queensland
  scope:
    kind: work-bundle
    id: PB-P004
  query: "de Rays trial records, 1880s"
  coverage: "nothing new"
  bogusField: "oops"
`;
    const filePath = writeSearchLog('search-log.yml', yaml);
    expect(() => loadSearchLog(filePath)).toThrow(/bogusField/);
  });
});

describe('loadSearchLog date validation (V10)', () => {
  function entryWithDate(date: string): string {
    return `
- id: SRCH-0001
  date: ${date}
  repository: Gallica
  scope:
    kind: work-bundle
    id: PB-P004
  query: "trial records"
  coverage: "catalogue searched"
`;
  }

  it('rejects a non-zero-padded date (2026-7-1) as not ISO YYYY-MM-DD', () => {
    const filePath = writeSearchLog('search-log.yml', entryWithDate('2026-7-1'));
    expect(() => loadSearchLog(filePath)).toThrow(/not ISO YYYY-MM-DD/);
  });

  it('rejects a free-text date (yesterday)', () => {
    const filePath = writeSearchLog('search-log.yml', entryWithDate('yesterday'));
    expect(() => loadSearchLog(filePath)).toThrow(/not ISO YYYY-MM-DD/);
  });

  it('rejects an impossible calendar date (2026-02-30)', () => {
    const filePath = writeSearchLog('search-log.yml', entryWithDate('2026-02-30'));
    expect(() => loadSearchLog(filePath)).toThrow(/not a real calendar date/);
  });

  it('rejects Feb 29 in a non-leap year (2026-02-29)', () => {
    const filePath = writeSearchLog('search-log.yml', entryWithDate('2026-02-29'));
    expect(() => loadSearchLog(filePath)).toThrow(/not a real calendar date/);
  });

  it('accepts a valid leap-day (2024-02-29) and a normal ISO date', () => {
    expect(loadSearchLog(writeSearchLog('a.yml', entryWithDate('2024-02-29')))[0]?.date).toBe(
      '2024-02-29',
    );
    expect(loadSearchLog(writeSearchLog('b.yml', entryWithDate('2026-07-03')))[0]?.date).toBe(
      '2026-07-03',
    );
  });
});
