import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { CanonicalModel } from '@/bibliography/model';
import {
  collectCompanionObjectKeys,
  validateUndiscoverableMasters,
} from '@/bibliography/validate-companion-coverage';
import type { AcquiredAsset } from '@/model/acquired-asset';
import type { RepositoryRecord } from '@/model/repository-record';

/**
 * The no-orphaned-master contract (`undiscoverable-master`): every SSOT
 * object-store master must be referenced by a committed archive companion, or
 * `bib validate` fails loud. Regression guard for the class of failure where a
 * B2-direct acquisition (museum spec 011, Internet Archive spec 013) mirrors
 * bytes to the store + records them in the SSOT but never writes the companions.
 */

function master(objectStoreKey: string): AcquiredAsset {
  return {
    sourceUrl: 'https://example/x',
    mediaType: 'image/png',
    objectStoreKey,
    checksum: 'deadbeef',
    byteLength: 1,
    provenancePath: objectStoreKey.replace(/\.[^./]+$/, '.yml'),
    role: 'page-master',
  };
}

function modelWith(records: RepositoryRecord[]): CanonicalModel {
  return { sources: [], repositoryRecords: records, identifierLeaks: [] };
}

describe('validateUndiscoverableMasters (the no-orphaned-master contract)', () => {
  it('FAILS LOUD for a record whose object-store master has no companion', () => {
    const record: RepositoryRecord = {
      sourceId: 'PB-P055',
      sourceArchive: 'Internet Archive',
      status: 'archived',
      assets: [master('archive/internet-archive/x/pages/1-abc.png')],
    };
    const findings = validateUndiscoverableMasters(modelWith([record]), new Set());
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('undiscoverable-master');
    expect(findings[0].sourceId).toBe('PB-P055');
    expect(findings[0].detail).toMatch(/UNDISCOVERABLE/);
  });

  it('passes when every master IS referenced by a companion key', () => {
    const key = 'archive/internet-archive/x/pages/1-abc.png';
    const record: RepositoryRecord = {
      sourceId: 'PB-P055',
      sourceArchive: 'Internet Archive',
      status: 'archived',
      assets: [master(key)],
    };
    const findings = validateUndiscoverableMasters(modelWith([record]), new Set([key]));
    expect(findings).toHaveLength(0);
  });

  it('reports partial coverage (some masters covered, some orphaned)', () => {
    const covered = 'archive/x/1-a.png';
    const orphan = 'archive/x/2-b.png';
    const record: RepositoryRecord = {
      sourceId: 'PB-P099',
      sourceArchive: 'Internet Archive',
      status: 'archived',
      assets: [master(covered), master(orphan)],
    };
    const findings = validateUndiscoverableMasters(modelWith([record]), new Set([covered]));
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toMatch(/1 of 2/);
    expect(findings[0].path).toBe(orphan);
  });

  it('ignores records with no object-store assets (e.g. Gallica manifest/issue records)', () => {
    const record: RepositoryRecord = {
      sourceId: 'PB-P001',
      sourceArchive: 'Gallica / BnF',
      status: 'archived',
    };
    expect(validateUndiscoverableMasters(modelWith([record]), new Set())).toHaveLength(0);
  });
});

describe('collectCompanionObjectKeys', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('collects object_store.key from committed companions, skipping non-companion yml', () => {
    dir = mkdtempSync(join(tmpdir(), 'companion-scan-'));
    const bookDir = join(dir, 'archive', 'cases', 'port-breton', 'books', 'x');
    mkdirSync(bookDir, { recursive: true });
    writeFileSync(
      join(bookDir, 'f001.yml'),
      [
        'id: "PB-P900"',
        'type: "page-image"',
        'source_archive: "Internet Archive"',
        'local_path: "archive/cases/port-breton/books/x/f001.png"',
        'sha256: "aaa"',
        'format: "image/png"',
        'original_url: "https://archive.org/x"',
        'object_store:',
        '  provider: "backblaze-b2"',
        '  bucket: "colony-cults"',
        '  key: "archive/internet-archive/x/pages/1-abc.png"',
        '  endpoint: "https://s3.us-west-004.backblazeb2.com"',
      ].join('\n'),
    );
    // A non-companion sidecar (no object_store block) must be skipped, not throw.
    writeFileSync(join(bookDir, 'p001.fr.txt.yml'), 'engine: codex\nmodel: x\n');

    const keys = collectCompanionObjectKeys(dir);
    expect([...keys]).toEqual(['archive/internet-archive/x/pages/1-abc.png']);
  });

  it('returns an empty set when the archive tree is absent', () => {
    dir = mkdtempSync(join(tmpdir(), 'companion-scan-empty-'));
    expect(collectCompanionObjectKeys(dir).size).toBe(0);
  });
});
