import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { S3ObjectStore } from '@/archive/s3-object-store';
import { resolveObjectStoreConfig, ObjectStoreConfig } from '@/archive/b2-config';
import { sha256OfBytes } from '@/archive/checksum';
import { storeAsset, companionYamlPath } from '@/archive/store';
import { readProvenance, type ProvenanceFields } from '@/archive/provenance';

/**
 * OPT-IN integration test proving SC-002: an archive master is restorable
 * from GIT-TRACKED PROVENANCE ALONE. Given only the companion YAML (never
 * the archive-writer's in-memory state), this resolves the object key and
 * sha256 from the provenance record, fetches the master from the real B2
 * bucket, and proves byte/sha256 identity.
 *
 * Gated exactly like `tests/integration/s3-object-store.test.ts` (T022):
 * skipped -- not failed -- in a normal `vitest run` via `describe.skipIf`,
 * and only actually exercised when `COLONY_S3_IT` is set AND
 * `resolveObjectStoreConfig()` succeeds (bucket/endpoint/region env vars set
 * and a readable B2 credentials file present). Talks to a real bucket, so a
 * network/auth failure once enabled MUST fail loudly -- that is the point of
 * opting in.
 */
describe.skipIf(!process.env.COLONY_S3_IT)(
  'restore from provenance (live B2 integration, SC-002)',
  () => {
    it('restores a master from B2 using only the git-tracked companion YAML', async () => {
      let config: ObjectStoreConfig;
      try {
        config = resolveObjectStoreConfig();
      } catch {
        // COLONY_S3_IT is set but this machine has no B2 credentials
        // configured -- an environment gap, not a test failure.
        return;
      }

      const store = new S3ObjectStore(config);
      const archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-restore-it-'));
      const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const targetPath = path.join(
        archiveRoot,
        'archive',
        '_it',
        'restore',
        uniq,
        'f001.jpg',
      );

      const originalBytes = new TextEncoder().encode(
        `colony-cults archive-object-store restore-from-provenance payload ${uniq}`,
      );

      const provenanceFields: ProvenanceFields = {
        id: 'PB-P001',
        title: 'La Nouvelle France',
        type: 'page-image',
        case: 'port-breton',
        language: 'French',
        source_archive: 'Gallica / BnF',
        catalog_url: 'https://gallica.bnf.fr/ark:/12148/bpt6k5603637g',
        original_url:
          'https://gallica.bnf.fr/iiif/ark:/12148/bpt6k5603637g/f1/full/full/0/native.jpg',
        rights_status: 'public-domain',
        retrieved: '2026-07-08T00:00:00.000Z',
        local_path: 'overwritten-by-store',
        sha256: 'overwritten-by-store',
        size: 0,
        format: 'image/jpeg',
        ocr_status: 'none',
        object_store: null,
        rights_raw: '<results/>',
        notes: null,
      };

      const client = new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
        forcePathStyle: true,
      });

      let uploadedKey: string | undefined;
      try {
        await storeAsset(originalBytes, targetPath, provenanceFields, archiveRoot, {
          objectStore: store,
          objectStoreCoords: {
            provider: config.provider,
            bucket: config.bucket,
            endpoint: config.endpoint,
          },
        });

        // Simulate "provenance only": forget everything except the
        // git-tracked companion YAML, and re-derive the object location and
        // expected checksum purely from what it records.
        const restoredProvenance = await readProvenance(companionYamlPath(targetPath));
        const objectStoreLocation = restoredProvenance.object_store;
        if (objectStoreLocation === null) {
          throw new Error(
            'restore-from-provenance: companion YAML recorded object_store: null ' +
              '-- storeAsset should have populated it when an object store was configured',
          );
        }
        uploadedKey = objectStoreLocation.key;

        const fetchedBytes = await store.get(objectStoreLocation.key);
        const fetchedSha256 = sha256OfBytes(fetchedBytes);

        expect(fetchedSha256).toBe(restoredProvenance.sha256);
        expect(Buffer.from(fetchedBytes)).toEqual(Buffer.from(originalBytes));
      } finally {
        if (uploadedKey !== undefined) {
          await client.send(
            new DeleteObjectCommand({ Bucket: config.bucket, Key: uploadedKey }),
          );
        }
        rmSync(archiveRoot, { recursive: true, force: true });
      }
    });
  },
);
