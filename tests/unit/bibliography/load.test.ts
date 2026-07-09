import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadAllSources, loadSourceFile } from '@/bibliography/load';

const VALID_YAML = `
sourceId: PB-P001
kind: periodical
case: port-breton
language: French
creator: Marquis de Rays / colonial enterprise
titles:
  - text: "La Nouvelle France : journal de la colonie libre de Port-Breton, Océanie"
    role: canonical
  - text: "La Nouvelle-France"
    role: alternate
identifiers:
  - type: issn
    value: "0000-0000"
repositoryRecords:
  - sourceArchive: "Gallica / BnF"
    status: collected
    catalogUrl: "https://gallica.bnf.fr/ark:/12148/cb328261098/date"
    retrievedAt: "2026-07-08"
    identifiers:
      - type: ark
        value: "ark:/12148/cb328261098/date"
  - sourceArchive: "State Library of Queensland"
    status: collected
    catalogUrl: "https://onesearch.slq.qld.gov.au/..."
    identifiers:
      - type: iiif-manifest
        value: "https://.../manifest.json"
`;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'bibliography-load-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeSource(name: string, contents: string): string {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, contents, 'utf-8');
  return filePath;
}

describe('loadSourceFile', () => {
  it('parses a valid SSOT YAML into the expected Source + records', () => {
    const filePath = writeSource('PB-P001.yml', VALID_YAML);
    const { source, records } = loadSourceFile(filePath);

    expect(source.sourceId).toBe('PB-P001');
    expect(source.kind).toBe('periodical');
    expect(source.case).toBe('port-breton');
    expect(source.language).toBe('French');
    expect(source.creator).toBe('Marquis de Rays / colonial enterprise');
    expect(source.titles).toHaveLength(2);
    expect(source.titles[0]).toEqual({
      text: 'La Nouvelle France : journal de la colonie libre de Port-Breton, Océanie',
      role: 'canonical',
    });
    expect(source.titles[1]).toEqual({ text: 'La Nouvelle-France', role: 'alternate' });
    expect(source.identifiers).toEqual([{ type: 'issn', value: '0000-0000' }]);

    expect(records).toHaveLength(2);
    const gallica = records.find((r) => r.sourceArchive === 'Gallica / BnF');
    expect(gallica).toBeDefined();
    expect(gallica?.status).toBe('collected');
    expect(gallica?.catalogUrl).toBe('https://gallica.bnf.fr/ark:/12148/cb328261098/date');
    expect(gallica?.retrievedAt).toBe('2026-07-08');
    expect(gallica?.identifiers).toEqual([
      { type: 'ark', value: 'ark:/12148/cb328261098/date' },
    ]);

    const slq = records.find((r) => r.sourceArchive === 'State Library of Queensland');
    expect(slq).toBeDefined();
    expect(slq?.identifiers).toEqual([
      { type: 'iiif-manifest', value: 'https://.../manifest.json' },
    ]);
  });

  it('throws on a sourceId that does not match the required pattern', () => {
    const filePath = writeSource(
      'PB-P001.yml',
      `
sourceId: NOTVALID
kind: monograph
titles:
  - text: "Whatever"
    role: canonical
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(/does not match/);
  });

  it('throws when sourceId does not equal the filename stem', () => {
    const filePath = writeSource(
      'PB-P002.yml',
      `
sourceId: PB-P001
kind: monograph
titles:
  - text: "Whatever"
    role: canonical
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(/filename stem/);
  });

  it('throws when titles is missing/empty', () => {
    const filePath = writeSource(
      'PB-P001.yml',
      `
sourceId: PB-P001
kind: monograph
titles: []
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(/titles must have at least one entry/);
  });

  it('throws on a title carrying a forbidden "authoritative" key', () => {
    const filePath = writeSource(
      'PB-P001.yml',
      `
sourceId: PB-P001
kind: monograph
titles:
  - text: "Whatever"
    role: canonical
    authoritative: true
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(/authoritative/);
  });

  it('throws on an invalid title role', () => {
    const filePath = writeSource(
      'PB-P001.yml',
      `
sourceId: PB-P001
kind: monograph
titles:
  - text: "Whatever"
    role: definitive
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(/role/);
  });

  it('throws on a duplicate (sourceId, sourceArchive)', () => {
    const filePath = writeSource(
      'PB-P001.yml',
      `
sourceId: PB-P001
kind: periodical
titles:
  - text: "Whatever"
    role: canonical
repositoryRecords:
  - sourceArchive: "Gallica / BnF"
    status: collected
  - sourceArchive: "Gallica / BnF"
    status: wanted
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(/duplicate repository record/);
  });

  it('throws on an unknown top-level key (rule 8, no silent drop)', () => {
    const filePath = writeSource(
      'PB-P001.yml',
      `
sourceId: PB-P001
kind: monograph
titles:
  - text: "Whatever"
    role: canonical
bogusField: nope
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(/unknown key "bogusField"/);
  });

  it('throws on an unknown repository record key', () => {
    const filePath = writeSource(
      'PB-P001.yml',
      `
sourceId: PB-P001
kind: periodical
titles:
  - text: "Whatever"
    role: canonical
repositoryRecords:
  - sourceArchive: "Gallica / BnF"
    status: collected
    bogusRecordField: nope
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(/unknown key "bogusRecordField"/);
  });

  it('throws when a repository record is missing status', () => {
    const filePath = writeSource(
      'PB-P001.yml',
      `
sourceId: PB-P001
kind: periodical
titles:
  - text: "Whatever"
    role: canonical
repositoryRecords:
  - sourceArchive: "Gallica / BnF"
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(/status/);
  });

  it('preserves a copy-level identifier under Source identifiers as an IdentifierLeak, not a throw', () => {
    const filePath = writeSource(
      'PB-P001.yml',
      `
sourceId: PB-P001
kind: monograph
titles:
  - text: "Whatever"
    role: canonical
identifiers:
  - type: ark
    value: "ark:/12148/whatever"
`,
    );
    const { source, identifierLeaks } = loadSourceFile(filePath);

    // Not thrown: the leaked identifier is dropped from the strictly-typed
    // Source.identifiers (it cannot type-safely hold a copy-level entry) and
    // surfaced instead as an IdentifierLeak for `bib validate` to report.
    expect(source.identifiers).toEqual([]);
    expect(identifierLeaks).toEqual([
      {
        onLevel: 'source',
        sourceId: 'PB-P001',
        type: 'ark',
        value: 'ark:/12148/whatever',
        expectedLevel: 'copy',
      },
    ]);
  });

  it('preserves a work-level identifier under a repository record as an IdentifierLeak, not a throw', () => {
    const filePath = writeSource(
      'PB-P001.yml',
      `
sourceId: PB-P001
kind: periodical
titles:
  - text: "Whatever"
    role: canonical
repositoryRecords:
  - sourceArchive: "Gallica / BnF"
    status: collected
    identifiers:
      - type: issn
        value: "0000-0000"
`,
    );
    const { records, identifierLeaks } = loadSourceFile(filePath);

    const gallica = records.find((r) => r.sourceArchive === 'Gallica / BnF');
    expect(gallica?.identifiers).toEqual([]);
    expect(identifierLeaks).toEqual([
      {
        onLevel: 'record',
        sourceId: 'PB-P001',
        sourceArchive: 'Gallica / BnF',
        type: 'issn',
        value: '0000-0000',
        expectedLevel: 'work',
      },
    ]);
  });

  it('throws on an unknown identifier type (not in either the work or copy vocab)', () => {
    const filePath = writeSource(
      'PB-P001.yml',
      `
sourceId: PB-P001
kind: monograph
titles:
  - text: "Whatever"
    role: canonical
identifiers:
  - type: doi
    value: "10.1234/whatever"
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(/unknown identifier type/);
  });

  it('throws on unreadable (missing) files', () => {
    expect(() => loadSourceFile(path.join(dir, 'PB-P999.yml'))).toThrow(/cannot read file/);
  });

  it('throws on malformed YAML', () => {
    const filePath = writeSource('PB-P001.yml', 'key: [1, 2');
    expect(() => loadSourceFile(filePath)).toThrow(/malformed YAML/);
  });

  it('throws when the parsed document is not an object', () => {
    const filePath = writeSource('PB-P001.yml', '- just\n- a\n- list\n');
    expect(() => loadSourceFile(filePath)).toThrow(/must be an object/);
  });
});

describe('loadAllSources', () => {
  it('reads every bibliography/sources/PB-*.yml file, sorted', () => {
    writeSource('PB-P002.yml', VALID_YAML.replace('PB-P001', 'PB-P002'));
    writeSource('PB-P001.yml', VALID_YAML);
    writeSource('not-a-source.yml', 'ignored: true');

    const loaded = loadAllSources(dir);
    expect(loaded.map((l) => l.source.sourceId)).toEqual(['PB-P001', 'PB-P002']);
  });

  it('propagates a malformed file with a locating error', () => {
    writeSource('PB-P001.yml', VALID_YAML);
    writeSource('PB-P002.yml', 'key: [1, 2');
    expect(() => loadAllSources(dir)).toThrow(/malformed YAML/);
  });
});
