import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadAllSources } from '@/bibliography/load';
import { listCorpusManifests } from '@/corpus/manifest';
import { deriveSourceFilenamePolicy } from '@/corpus/policies';
import {
  committedSourceFilenamePolicy,
  unionSourceFilenamePolicy,
} from '@/corpus/source-filename-bootstrap';
import { buildSourceFilenamePolicy } from '@/corpus/source-filename-policy';

/**
 * THE INV-16 PROOF (T023, specs/018-corpus-config-seam FR-018, SC-003/SC-004).
 *
 * `loadAllSources` used to filter every directory entry through a hardcoded
 * `^PB-[A-Z]?\d{3}\.yml$`. Its failure mode was SILENCE: a second corpus's
 * `SYN-001.yml` did not match, so enumeration returned zero Sources with NO
 * error, and any check built on that list passed vacuously. These tests pin
 * both halves of the fix: a synthetic corpus's Sources ARE enumerated, and
 * Port Breton's enumeration is unchanged against the REAL committed SSOT.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const REAL_SOURCES_DIR = path.join(REPO_ROOT, 'bibliography', 'sources');
const REAL_CORPORA_ROOT = path.join(REPO_ROOT, 'corpora');

/** The committed Port Breton policy: `PB-P###` + `PB-S###`. */
function portBretonPolicy() {
  const manifests = listCorpusManifests(REAL_CORPORA_ROOT);
  const portBreton = manifests.find((manifest) => manifest.id === 'port-breton');
  if (portBreton === undefined) {
    throw new Error('corpora/port-breton.yml is missing -- this test reads the real manifest');
  }
  return deriveSourceFilenamePolicy({ corporaRoot: REAL_CORPORA_ROOT, manifest: portBreton });
}

function sourceYaml(sourceId: string, title: string): string {
  return [
    `sourceId: ${sourceId}`,
    'kind: monograph',
    'titles:',
    `  - text: "${title}"`,
    '    role: canonical',
    '',
  ].join('\n');
}

function seedDir(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'source-filename-policy-'));
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), body, 'utf-8');
  }
  return dir;
}

describe('loadAllSources with an injected SourceFilenamePolicy', () => {
  it('ENUMERATES a second corpus\'s SYN-001.yml under a synthetic policy (INV-16)', () => {
    const dir = seedDir({
      'SYN-001.yml': sourceYaml('SYN-001', 'A synthetic corpus source'),
      'SYN-002.yml': sourceYaml('SYN-002', 'Another synthetic corpus source'),
    });

    const loaded = loadAllSources(
      dir,
      buildSourceFilenamePolicy([{ prefix: 'SYN-', padWidth: 3 }]),
    );

    // The retired hardcoded pattern returned [] here -- silently, with no error.
    expect(loaded.map((entry) => entry.source.sourceId)).toEqual(['SYN-001', 'SYN-002']);
  });

  it('enumerates BOTH PB-P### and PB-S### under Port Breton\'s two policies', () => {
    const dir = seedDir({
      'PB-P001.yml': sourceYaml('PB-P001', 'A primary source'),
      'PB-S001.yml': sourceYaml('PB-S001', 'A hand-authored secondary work'),
    });

    const loaded = loadAllSources(dir, portBretonPolicy());

    expect(loaded.map((entry) => entry.source.sourceId)).toEqual(['PB-P001', 'PB-S001']);
  });

  it('EXCLUDES a file matching no shape of the injected policy', () => {
    const dir = seedDir({
      'PB-P001.yml': sourceYaml('PB-P001', 'A primary source'),
      // Right corpus family, wrong shape (4 digits) -- excluded, as under the
      // retired anchored pattern.
      'PB-P0001.yml': sourceYaml('PB-P0001', 'Overflowed pad'),
      // A different corpus's Source: not Port Breton's, so not enumerated here.
      'SYN-001.yml': sourceYaml('SYN-001', 'A synthetic corpus source'),
      'not-a-source.yml': 'ignored: true\n',
      'README.md': 'not yaml at all\n',
    });

    const loaded = loadAllSources(dir, portBretonPolicy());

    expect(loaded.map((entry) => entry.source.sourceId)).toEqual(['PB-P001']);
  });

  it('is scoped by the INJECTED policy, not by what is on disk', () => {
    const dir = seedDir({
      'PB-P001.yml': sourceYaml('PB-P001', 'A primary source'),
      'SYN-001.yml': sourceYaml('SYN-001', 'A synthetic corpus source'),
    });

    const bothCorpora = buildSourceFilenamePolicy([
      { prefix: 'PB-P', padWidth: 3 },
      { prefix: 'SYN-', padWidth: 3 },
    ]);

    expect(loadAllSources(dir, bothCorpora).map((entry) => entry.source.sourceId)).toEqual([
      'PB-P001',
      'SYN-001',
    ]);
  });
});

describe('behavior preservation against the REAL committed SSOT (FR-010)', () => {
  it('enumerates exactly the 94 Port Breton records: 92 PB-P### + 2 PB-S###', () => {
    const loaded = loadAllSources(REAL_SOURCES_DIR, portBretonPolicy());
    const ids = loaded.map((entry) => entry.source.sourceId);

    expect(ids.filter((id) => id.startsWith('PB-P'))).toHaveLength(92);
    expect(ids.filter((id) => id.startsWith('PB-S'))).toHaveLength(2);
    expect(ids).toHaveLength(94);
    // The retired pattern's own result, pinned: nothing else in the directory
    // was ever enumerated.
    expect(ids.every((id) => /^PB-[A-Z]?\d{3}$/.test(id))).toBe(true);
  });

  it('the committed union and the selected-corpus policy agree on the real SSOT', () => {
    const union = unionSourceFilenamePolicy(listCorpusManifests(REAL_CORPORA_ROOT));

    expect(loadAllSources(REAL_SOURCES_DIR, union)).toHaveLength(94);
    expect(loadAllSources(REAL_SOURCES_DIR, committedSourceFilenamePolicy())).toHaveLength(94);
  });
});

describe('the policy is REQUIRED, never defaulted (FR-018, Principle V)', () => {
  it('is a compile-time error to call loadAllSources without a policy', () => {
    // @ts-expect-error -- the second parameter is REQUIRED and has no default.
    // If a default is ever reintroduced, this line stops erroring and the
    // `@ts-expect-error` itself becomes the failure: the silent fallback
    // cannot come back unnoticed.
    const call = () => loadAllSources(REAL_SOURCES_DIR);

    expect(typeof call).toBe('function');
  });
});
