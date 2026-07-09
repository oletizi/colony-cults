import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { migrate } from '@/bibliography/migrate';
import { writeProvenance } from '@/archive/provenance';
import type { ProvenanceFields } from '@/archive/provenance';

/**
 * US1 slice (T012): the PB-P001 two-copy restoration, driven end-to-end
 * through `migrate` (folds the five legacy representations + derives the
 * roll-up in one call -- see `src/bibliography/migrate.ts`). Hermetic: every
 * fixture lives under a throwaway temp repoRoot/archiveRoot; nothing touches
 * the real archive object store.
 *
 * Central assertions (SC-001/SC-005 + the spec.md L110 edge case):
 *  1. PB-P001 folds into EXACTLY TWO repositoryRecords -- Gallica / BnF
 *     (copy-level ark + a derived manifest with assetCount > 0 from fixture
 *     provenance) and State Library of Queensland (authored-only: its
 *     onesearch catalogUrl survives, no manifest).
 *  2. A second, unchanged roll-up does not drop the SLQ record.
 *  3. A second SAME-ARCHIVE (Gallica) roll-up -- more provenance files
 *     appearing for an archive already present -- updates the existing
 *     Gallica record's manifest IN PLACE; the count of distinct
 *     `(sourceId, sourceArchive)` keys for PB-P001 stays stable at 2 (no
 *     duplicate record is added).
 */

const GALLICA_CATALOG = 'https://gallica.bnf.fr/ark:/12148/cb328261098/date';
const GALLICA_ARK = 'ark:/12148/cb328261098/date';
const SLQ_CATALOG =
  'https://onesearch.slq.qld.gov.au/permalink/61SLQ_INST/bumb4u/alma99183978086302061';

const SOURCES_CSV = [
  'id,case,title,creator,year,type,language,status,access,public_domain,notes',
  'PB-P001,port-breton,"La Nouvelle France",Marquis de Rays / colonial enterprise,1879-1882,primary periodical,French,to collect,digital archive,likely,"Recruitment and propaganda newspaper for the colony."',
  '',
].join('\n');

const TRACKER_CSV = [
  'id,title,priority,status,next_action,vendor_or_archive,url_or_reference,notes',
  'PB-P001,"La Nouvelle France",high,in progress,"Preserve Gallica run",State Library of Queensland / BnF Gallica,https://github.com/oletizi/colony-cults/issues/1,"SLQ title record id is slq_alma99183978086302061 with call number RBS 919.5 004."',
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
function seedRepo(): string {
  const repo = tempDir('bib-repo-');
  mkdirSync(path.join(repo, 'bibliography'), { recursive: true });
  writeFileSync(path.join(repo, 'bibliography', 'sources.csv'), SOURCES_CSV);
  writeFileSync(path.join(repo, 'bibliography', 'acquisition-tracker.csv'), TRACKER_CSV);
  return repo;
}

/** Seed a fixture archive root with the register + PB-P001 stub (no provenance yet). */
function seedArchiveBase(): string {
  const arch = tempDir('bib-arch-');
  const meta = path.join(arch, 'archive', 'cases', 'port-breton', 'metadata');
  mkdirSync(meta, { recursive: true });
  writeFileSync(path.join(meta, 'acquisition-register.csv'), REGISTER_CSV);
  writeFileSync(path.join(meta, 'PB-P001.yml'), STUB_YML);
  return arch;
}

function fixtureProvenance(localPath: string): ProvenanceFields {
  return {
    id: 'PB-P001',
    title: 'La Nouvelle France',
    type: 'page-image',
    case: 'port-breton',
    language: 'French',
    source_archive: 'Gallica / BnF',
    catalog_url: GALLICA_CATALOG,
    original_url: 'https://gallica.bnf.fr/iiif/ark:/12148/cb328261098/f1/full/full/0/native.jpg',
    rights_status: 'public-domain',
    retrieved: '2026-07-08',
    local_path: localPath,
    sha256: 'a'.repeat(64),
    format: 'image/jpeg',
    ocr_status: 'none',
    size: 12345,
    object_store: null,
    rights_raw: '<OAIRecord/>',
    notes: null,
  };
}

/**
 * Write one companion provenance `.yml` per given asset name, under the
 * la-nouvelle-france archive path (`archive/location.ts`'s registered layout
 * for PB-P001) so `gatherProvenance` finds a real, non-empty roll-up.
 */
async function writeGallicaProvenance(archiveRoot: string, assetNames: string[]): Promise<void> {
  const issueDir = path.join(
    archiveRoot,
    'archive',
    'cases',
    'port-breton',
    'newspapers',
    'la-nouvelle-france',
    '1879-07-15_bpt6k1',
  );
  for (const name of assetNames) {
    const localPath = `archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k1/${name}.jpg`;
    await writeProvenance(path.join(issueDir, `${name}.yml`), fixtureProvenance(localPath));
  }
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('bibliography integration (US1: PB-P001 two-copy restoration)', () => {
  it('folds PB-P001 into EXACTLY TWO repositoryRecords -- Gallica (ark + manifest) and SLQ (authored-only) (SC-001/SC-005)', async () => {
    const repo = seedRepo();
    const arch = seedArchiveBase();
    await writeGallicaProvenance(arch, ['f001', 'f002']);

    const result = await migrate({ repoRoot: repo, archiveRoot: arch, write: true });
    const records = result.model.repositoryRecords.filter((r) => r.sourceId === 'PB-P001');

    expect(records).toHaveLength(2);
    expect(records.map((r) => r.sourceArchive).sort()).toEqual([
      'Gallica / BnF',
      'State Library of Queensland',
    ]);

    const gallica = records.find((r) => r.sourceArchive === 'Gallica / BnF');
    expect(gallica).toBeDefined();
    expect(gallica?.identifiers).toEqual([{ type: 'ark', value: GALLICA_ARK }]);
    expect(gallica?.manifest).toBeDefined();
    expect(gallica?.manifest?.assetCount).toBeGreaterThan(0);
    expect(gallica?.manifest?.assetCount).toBe(2);

    const slq = records.find((r) => r.sourceArchive === 'State Library of Queensland');
    expect(slq).toBeDefined();
    expect(slq?.catalogUrl).toBe(SLQ_CATALOG);
    expect(slq?.manifest).toBeUndefined();
  });

  it('a second (unchanged) roll-up does NOT drop the SLQ record', async () => {
    const repo = seedRepo();
    const arch = seedArchiveBase();
    await writeGallicaProvenance(arch, ['f001', 'f002']);

    await migrate({ repoRoot: repo, archiveRoot: arch, write: true });
    const second = await migrate({ repoRoot: repo, archiveRoot: arch, write: true });

    const records = second.model.repositoryRecords.filter((r) => r.sourceId === 'PB-P001');
    expect(records).toHaveLength(2);
    expect(records.some((r) => r.sourceArchive === 'State Library of Queensland')).toBe(true);
  });

  it('a second SAME-ARCHIVE (Gallica) roll-up updates the existing record in place -- no duplicate key', async () => {
    const repo = seedRepo();
    const arch = seedArchiveBase();
    await writeGallicaProvenance(arch, ['f001', 'f002']);

    const first = await migrate({ repoRoot: repo, archiveRoot: arch, write: true });
    const firstGallica = first.model.repositoryRecords.filter(
      (r) => r.sourceId === 'PB-P001' && r.sourceArchive === 'Gallica / BnF',
    );
    expect(firstGallica).toHaveLength(1);
    expect(firstGallica[0].manifest?.assetCount).toBe(2);

    // A second roll-up fetches one more page for the SAME archive.
    await writeGallicaProvenance(arch, ['f003']);
    const second = await migrate({ repoRoot: repo, archiveRoot: arch, write: true });

    const secondGallica = second.model.repositoryRecords.filter(
      (r) => r.sourceId === 'PB-P001' && r.sourceArchive === 'Gallica / BnF',
    );
    // Updated in place -- still exactly one record for the key, not two.
    expect(secondGallica).toHaveLength(1);
    expect(secondGallica[0].manifest?.assetCount).toBe(3);

    // The count of distinct (sourceId, sourceArchive) keys for PB-P001 stays
    // stable at 2 (Gallica + SLQ) -- the roll-up never manufactures a
    // duplicate.
    const keys = new Set(
      second.model.repositoryRecords
        .filter((r) => r.sourceId === 'PB-P001')
        .map((r) => `${r.sourceId}::${r.sourceArchive}`),
    );
    expect(keys.size).toBe(2);
  });
});
