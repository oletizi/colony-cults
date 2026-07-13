import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadScopesRegistry, threadIdSet } from '@/bibliography/scopes-registry';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'bibliography-scopes-registry-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeScopesYaml(name: string, contents: string): string {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, contents, 'utf-8');
  return filePath;
}

describe('loadScopesRegistry', () => {
  it('treats an empty list ([]) as a valid, empty registry (this build populates none)', () => {
    const filePath = writeScopesYaml('scopes.yml', '[]\n');
    expect(loadScopesRegistry(filePath)).toEqual([]);
  });

  it('treats an empty file as an empty registry', () => {
    const filePath = writeScopesYaml('scopes.yml', '');
    expect(loadScopesRegistry(filePath)).toEqual([]);
  });

  it('returns [] when the file is absent (registry is not required to exist yet)', () => {
    const filePath = path.join(dir, 'does-not-exist.yml');
    expect(loadScopesRegistry(filePath)).toEqual([]);
  });

  it('parses a well-formed entry into a typed ThreadRegistryEntry[]', () => {
    const yaml = `
- id: de-rays-trial
  name: "The de Rays trial"
  description: "Trial proceedings and coverage of the Marquis de Rays fraud trial"
`;
    const filePath = writeScopesYaml('scopes.yml', yaml);
    const registry = loadScopesRegistry(filePath);

    expect(registry).toEqual([
      {
        id: 'de-rays-trial',
        name: 'The de Rays trial',
        description: 'Trial proceedings and coverage of the Marquis de Rays fraud trial',
      },
    ]);
  });

  it('parses multiple well-formed entries', () => {
    const yaml = `
- id: de-rays-trial
  name: "The de Rays trial"
  description: "Trial proceedings and coverage of the Marquis de Rays fraud trial"
- id: colony-prospectuses
  name: "Colony prospectuses"
  description: "Promotional literature soliciting settlers and investors"
`;
    const filePath = writeScopesYaml('scopes.yml', yaml);
    expect(loadScopesRegistry(filePath)).toHaveLength(2);
  });

  it('fails loud, naming the duplicate id, when two entries share the same id (INV-5)', () => {
    const yaml = `
- id: de-rays-trial
  name: "The de Rays trial"
  description: "Trial proceedings"
- id: de-rays-trial
  name: "Duplicate"
  description: "Should not be allowed"
`;
    const filePath = writeScopesYaml('scopes.yml', yaml);
    expect(() => loadScopesRegistry(filePath)).toThrow(/de-rays-trial/);
    expect(() => loadScopesRegistry(filePath)).toThrow(/duplicate/i);
  });

  it('fails loud, naming the entry and field, when a required field is missing', () => {
    const yaml = `
- id: de-rays-trial
  name: "The de Rays trial"
`;
    const filePath = writeScopesYaml('scopes.yml', yaml);
    expect(() => loadScopesRegistry(filePath)).toThrow(/de-rays-trial/);
    expect(() => loadScopesRegistry(filePath)).toThrow(/description/);
  });

  it('fails loud, naming the entry by index, when the missing field is id itself', () => {
    const yaml = `
- name: "The de Rays trial"
  description: "Trial proceedings"
`;
    const filePath = writeScopesYaml('scopes.yml', yaml);
    expect(() => loadScopesRegistry(filePath)).toThrow(/\[0\]/);
    expect(() => loadScopesRegistry(filePath)).toThrow(/"id"/);
  });

  it('rejects an entry with an unknown key (no silent drop)', () => {
    const yaml = `
- id: de-rays-trial
  name: "The de Rays trial"
  description: "Trial proceedings"
  members: ["PB-P007"]
`;
    const filePath = writeScopesYaml('scopes.yml', yaml);
    expect(() => loadScopesRegistry(filePath)).toThrow(/members/);
  });

  it('fails loud on malformed YAML', () => {
    const filePath = writeScopesYaml('scopes.yml', ': not: valid: yaml: [');
    expect(() => loadScopesRegistry(filePath)).toThrow();
  });

  it('fails loud when the document is not a list', () => {
    const filePath = writeScopesYaml('scopes.yml', 'id: de-rays-trial\n');
    expect(() => loadScopesRegistry(filePath)).toThrow(/list/);
  });
});

describe('threadIdSet', () => {
  it('returns an empty Set for an empty registry', () => {
    expect(threadIdSet([])).toEqual(new Set());
  });

  it('returns the Set of registered thread ids', () => {
    const registry = [
      { id: 'de-rays-trial', name: 'The de Rays trial', description: 'x' },
      { id: 'colony-prospectuses', name: 'Colony prospectuses', description: 'y' },
    ];
    expect(threadIdSet(registry)).toEqual(new Set(['de-rays-trial', 'colony-prospectuses']));
  });
});
