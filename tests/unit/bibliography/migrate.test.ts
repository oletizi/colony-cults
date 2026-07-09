import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { migrate } from '@/bibliography/migrate';
import { loadSourceFile } from '@/bibliography/load';

/**
 * Unit tests for the five-representation -> SSOT migration (T013). Every
 * fixture is seeded into a throwaway temp dir; NONE of these tests touch the
 * real archive object store. The central assertion is SC-005: PB-P001 must
 * fold into TWO distinct Repository Records (Gallica / BnF + the restored
 * State Library of Queensland copy).
 */

const GALLICA_CATALOG = 'https://gallica.bnf.fr/ark:/12148/cb328261098/date';
const GALLICA_ARK = 'ark:/12148/cb328261098/date';
const SLQ_CATALOG =
  'https://onesearch.slq.qld.gov.au/permalink/61SLQ_INST/bumb4u/alma99183978086302061';
const CENSUS = 'data/census/PB-P001-la-nouvelle-france.json';

const SOURCES_CSV = [
  'id,case,title,creator,year,type,language,status,access,public_domain,notes',
  'PB-P001,port-breton,"La Nouvelle France",Marquis de Rays / colonial enterprise,1879-1882,primary periodical,French,to collect,digital archive,likely,"Recruitment and propaganda newspaper for the colony."',
  'PB-P002,port-breton,"Nouvelle-France: Colonie libre",Paul de Groote,1879,primary promotional book,French,wanted,digital,likely,"Promotional account."',
  '',
].join('\n');

const TRACKER_CSV = [
  'id,title,priority,status,next_action,vendor_or_archive,url_or_reference,notes',
  'PB-P001,"La Nouvelle France",high,in progress,"Preserve Gallica run",State Library of Queensland / BnF Gallica,https://github.com/oletizi/colony-cults/issues/1,"SLQ title record id is slq_alma99183978086302061 with call number RBS 919.5 004."',
  'PB-P002,"Nouvelle-France",high,wanted,"Find a scan",Gallica / Google Books,,"Promotional primary source."',
  '',
].join('\n');

const REGISTER_CSV = [
  'id,title,type,rights_status,mirror_status,source_archive,source_url,local_path,notes',
  `PB-P001,"La Nouvelle France",newspaper,public-domain-likely,pending,State Library of Queensland,${SLQ_CATALOG},archive/cases/port-breton/newspapers/la-nouvelle-france/,"Digitized journal."`,
  '',
].join('\n');

const STUB_YML = [
  'id: PB-P001',
  'title: "La Nouvelle France"',
  'type: newspaper',
  'case: port-breton',
  'language: French',
  'source_archive: Bibliotheque nationale de France (Gallica)',
  `catalog_url: "${GALLICA_CATALOG}"`,
  'rights_status: public-domain',
  'mirror_status: in-progress',
  'local_path: archive/cases/port-breton/newspapers/la-nouvelle-france/',
  'notes: |',
  '  Digitized journal mirrored from Gallica.',
  '',
].join('\n');

const created: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

/** Seed a repo root with the two PUBLIC representations (sources + tracker). */
function seedRepo(tracker: string = TRACKER_CSV): string {
  const repo = tempDir('migrate-repo-');
  mkdirSync(path.join(repo, 'bibliography'), { recursive: true });
  writeFileSync(path.join(repo, 'bibliography', 'sources.csv'), SOURCES_CSV);
  writeFileSync(path.join(repo, 'bibliography', 'acquisition-tracker.csv'), tracker);
  return repo;
}

/** Seed a fixture archive root with the register + PB-P001 stub. */
function seedArchive(): string {
  const arch = tempDir('migrate-arch-');
  const meta = path.join(arch, 'archive', 'cases', 'port-breton', 'metadata');
  mkdirSync(meta, { recursive: true });
  writeFileSync(path.join(meta, 'acquisition-register.csv'), REGISTER_CSV);
  writeFileSync(path.join(meta, 'PB-P001.yml'), STUB_YML);
  return arch;
}

function sourcePath(repo: string, id: string): string {
  return path.join(repo, 'bibliography', 'sources', `${id}.yml`);
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('migrate', () => {
  it('folds PB-P001 into EXACTLY TWO distinct repository records (SC-001/SC-005)', async () => {
    const repo = seedRepo();
    const arch = seedArchive();

    const result = await migrate({ repoRoot: repo, archiveRoot: arch, write: true });

    expect(result.written).toContain(sourcePath(repo, 'PB-P001'));

    const loaded = loadSourceFile(sourcePath(repo, 'PB-P001'));
    expect(loaded.records).toHaveLength(2);

    const archives = loaded.records.map((r) => r.sourceArchive).sort();
    expect(archives).toEqual(['Gallica / BnF', 'State Library of Queensland']);
  });

  it('restores the lost SLQ copy with the real onesearch catalogUrl + SLQ ids in notes', async () => {
    const repo = seedRepo();
    const arch = seedArchive();
    await migrate({ repoRoot: repo, archiveRoot: arch, write: true });

    const loaded = loadSourceFile(sourcePath(repo, 'PB-P001'));
    const slq = loaded.records.find((r) => r.sourceArchive === 'State Library of Queensland');
    expect(slq).toBeDefined();
    expect(slq?.status).toBe('to-collect');
    expect(slq?.catalogUrl).toBe(SLQ_CATALOG);

    // Copy-level SLQ ids are captured in the Source notes (the model has no
    // record-level notes field), per the migration mapping.
    expect(loaded.source.notes).toContain('slq_alma99183978086302061');
    expect(loaded.source.notes).toContain('RBS 919.5 004');
  });

  it('maps the Gallica copy from the stub (mirror_status in-progress -> collecting) with ark + census', async () => {
    const repo = seedRepo();
    const arch = seedArchive();
    await migrate({ repoRoot: repo, archiveRoot: arch, write: true });

    const loaded = loadSourceFile(sourcePath(repo, 'PB-P001'));
    const gallica = loaded.records.find((r) => r.sourceArchive === 'Gallica / BnF');
    expect(gallica).toBeDefined();
    expect(gallica?.status).toBe('collecting');
    expect(gallica?.catalogUrl).toBe(GALLICA_CATALOG);
    expect(gallica?.identifiers).toEqual([{ type: 'ark', value: GALLICA_ARK }]);
    expect(gallica?.census).toBe(CENSUS);
  });

  it('is idempotent: a second run writes byte-identical PB-P001.yml', async () => {
    const repo = seedRepo();
    const arch = seedArchive();

    await migrate({ repoRoot: repo, archiveRoot: arch, write: true });
    const first = readFileSync(sourcePath(repo, 'PB-P001'), 'utf-8');

    await migrate({ repoRoot: repo, archiveRoot: arch, write: true });
    const second = readFileSync(sourcePath(repo, 'PB-P001'), 'utf-8');

    expect(second).toBe(first);
  });

  it('yields ZERO repository records for a wanted source with no acquired copy', async () => {
    const repo = seedRepo();
    const arch = seedArchive();
    await migrate({ repoRoot: repo, archiveRoot: arch, write: true });

    const loaded = loadSourceFile(sourcePath(repo, 'PB-P002'));
    expect(loaded.records).toEqual([]);
    expect(loaded.source.kind).toBe('monograph');
  });

  it('throws on an unmappable status (no silent default)', async () => {
    const badTracker = [
      'id,title,priority,status,next_action,vendor_or_archive,url_or_reference,notes',
      'PB-P001,"La Nouvelle France",high,frobnicate,"x",Gallica / BnF,,""',
      '',
    ].join('\n');
    const repo = seedRepo(badTracker);

    await expect(migrate({ repoRoot: repo, write: false })).rejects.toThrow(/status/i);
  });

  it('folds the public representations when the archive root is ABSENT', async () => {
    const repo = seedRepo();
    const missingArchive = path.join(repo, 'no-such-archive');

    const result = await migrate({
      repoRoot: repo,
      archiveRoot: missingArchive,
      write: true,
    });

    const loaded = loadSourceFile(sourcePath(repo, 'PB-P001'));
    // The two archives are still recoverable from the tracker's combined
    // vendor label + notes alone (public reps 1-2).
    const archives = loaded.records.map((r) => r.sourceArchive).sort();
    expect(archives).toContain('Gallica / BnF');
    expect(archives).toContain('State Library of Queensland');
    expect(loaded.source.notes).toContain('slq_alma99183978086302061');

    // The model was still built (public reps only, no archive enrichment).
    expect(result.model.sources.map((s) => s.sourceId).sort()).toEqual(['PB-P001', 'PB-P002']);
  });
});
