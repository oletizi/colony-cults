import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readIssueRights } from '@/translate/rights';

const FIXTURES = path.resolve(__dirname, '../fixtures');

/**
 * Lays out a temp archive root the way `findIssueDir`/`sourceLayout` expect
 * for source `PB-P001` (case: port-breton, type: newspapers, slug:
 * la-nouvelle-france -- see `src/archive/location.ts`):
 *   <archiveRoot>/archive/cases/port-breton/newspapers/la-nouvelle-france/<date>_<ark>/
 */
async function makeIssueDir(archiveRoot: string, ark: string): Promise<string> {
  const issueDir = path.join(
    archiveRoot,
    'archive',
    'cases',
    'port-breton',
    'newspapers',
    'la-nouvelle-france',
    `2025-01-15_${ark}`,
  );
  await mkdir(issueDir, { recursive: true });
  return issueDir;
}

describe('readIssueRights (T008, offline rights + citation lookup)', () => {
  let archiveRoot: string;

  beforeEach(async () => {
    archiveRoot = await mkdtemp(path.join(tmpdir(), 'source-translation-rights-'));
  });

  afterEach(async () => {
    await rm(archiveRoot, { recursive: true, force: true });
  });

  it('reads rights_status + citation from the first page provenance YAML', async () => {
    const ark = 'bpt6k123456';
    const issueDir = await makeIssueDir(archiveRoot, ark);

    // Page image + its companion YAML, named the way the fetcher names them
    // (fNNN.jpg -> fNNN.yml, see src/archive/store.ts companionYamlPath).
    await writeFile(path.join(issueDir, 'f001.jpg'), Buffer.from([0]));
    const provenanceText = await readFile(
      path.join(FIXTURES, 'page-provenance.yml'),
      'utf-8',
    );
    await writeFile(path.join(issueDir, 'f001.yml'), provenanceText);

    const rights = await readIssueRights('PB-P001', ark, archiveRoot);

    expect(rights.rights_status).toBe('public-domain');
    expect(rights.citation.title).toBe('Le Journal de Port-Breton, 15 Janvier 1875');
    expect(rights.citation.catalog_url).toBe(
      'https://gallica.bnf.fr/ark:/12148/bpt6k123456',
    );
    expect(rights.citation.language).toBe('French');
  });

  it('reads rights after the object-store migration removed the local image (f###.yml present, f###.jpg absent)', async () => {
    const ark = 'bpt6k777888';
    const issueDir = await makeIssueDir(archiveRoot, ark);

    // Object-store-migrated issue: the page image has been moved to external
    // storage and its local .jpg removed, but the f###.yml companion remains.
    const provenanceText = await readFile(
      path.join(FIXTURES, 'page-provenance.yml'),
      'utf-8',
    );
    await writeFile(path.join(issueDir, 'f001.yml'), provenanceText);
    // Note: NO f001.jpg written.

    const rights = await readIssueRights('PB-P001', ark, archiveRoot);

    expect(rights.rights_status).toBe('public-domain');
    expect(rights.citation.title).toBe('Le Journal de Port-Breton, 15 Janvier 1875');
  });

  it('picks the FIRST page in page order when multiple pages are present', async () => {
    const ark = 'bpt6k654321';
    const issueDir = await makeIssueDir(archiveRoot, ark);

    const provenanceText = await readFile(
      path.join(FIXTURES, 'page-provenance.yml'),
      'utf-8',
    );
    // f002's provenance is deliberately different so a wrong "last/any file"
    // selection would be caught.
    const secondPageText = provenanceText.replace(
      'public-domain',
      'in-copyright',
    );

    await writeFile(path.join(issueDir, 'f001.jpg'), Buffer.from([0]));
    await writeFile(path.join(issueDir, 'f001.yml'), provenanceText);
    await writeFile(path.join(issueDir, 'f002.jpg'), Buffer.from([0]));
    await writeFile(path.join(issueDir, 'f002.yml'), secondPageText);

    const rights = await readIssueRights('PB-P001', ark, archiveRoot);

    expect(rights.rights_status).toBe('public-domain');
  });

  it('THROWS a descriptive error when the issue dir has no page provenance', async () => {
    const ark = 'bpt6k999999';
    await makeIssueDir(archiveRoot, ark);
    // No f###.jpg / companion YAML written at all.

    await expect(readIssueRights('PB-P001', ark, archiveRoot)).rejects.toThrow(
      /no page images|readIssueRights/i,
    );
  });

  it('THROWS a descriptive error when a page image exists but its companion YAML does not', async () => {
    const ark = 'bpt6k888888';
    const issueDir = await makeIssueDir(archiveRoot, ark);
    await writeFile(path.join(issueDir, 'f001.jpg'), Buffer.from([0]));
    // No f001.yml written.

    await expect(readIssueRights('PB-P001', ark, archiveRoot)).rejects.toThrow(
      /provenance/i,
    );
  });

  it('THROWS when the issue has never been fetched at all', async () => {
    await expect(
      readIssueRights('PB-P001', 'bpt6k000000', archiveRoot),
    ).rejects.toThrow(/no fetched issue/i);
  });
});
