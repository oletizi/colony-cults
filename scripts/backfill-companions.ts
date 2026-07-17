/**
 * One-time backfill: write the archive companions for every SSOT record whose
 * object-store masters were mirrored to B2 without them (the museum + Internet
 * Archive B2-direct records). Uses the SAME shared writer the adapters will call
 * on acquire, so the backfill and the going-forward path are identical.
 *
 * Run: COLONY_ARCHIVE_ROOT=... COLONY_S3_BUCKET=... COLONY_S3_ENDPOINT=... \
 *      tsx scripts/backfill-companions.ts
 */
import { loadAllSources } from '@/bibliography/load';
import { authoredToRepositoryRecord } from '@/bibliography/authored-record';
import { writeRecordCompanions } from '@/archive/write-record-companions';
import { resolveArchiveRoot } from '@/archive/location';
import { join } from 'node:path';

function reqEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') throw new Error(`backfill: env ${name} is required`);
  return v;
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const archiveRoot = resolveArchiveRoot(repoRoot);
  const objectStore = {
    provider: 'backblaze-b2',
    bucket: reqEnv('COLONY_S3_BUCKET'),
    endpoint: reqEnv('COLONY_S3_ENDPOINT'),
  };
  const now = new Date().toISOString();

  const loaded = loadAllSources(join(repoRoot, 'bibliography', 'sources'));
  let records = 0;
  let companions = 0;
  for (const entry of loaded) {
    for (const authored of entry.records) {
      const record = authoredToRepositoryRecord(entry.source.sourceId, authored);
      const hasObjectStoreMaster = (record.assets ?? []).some(
        (a) => typeof a.objectStoreKey === 'string' && a.objectStoreKey.length > 0,
      );
      if (!hasObjectStoreMaster) continue;
      const written = await writeRecordCompanions({
        source: entry.source,
        record,
        archiveRoot,
        objectStore,
        now,
      });
      if (written.length > 0) {
        records += 1;
        companions += written.length;
        console.log(`  ${entry.source.sourceId}: ${written.length} companion(s)`);
      }
    }
  }
  console.log(`\nbackfill: wrote ${companions} companion(s) across ${records} record(s) under ${archiveRoot}/archive`);
}

main().catch((err) => {
  console.error('backfill FAILED:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
