import { describe, it, expect } from 'vitest';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { S3ObjectStore } from '@/archive/s3-object-store';
import { resolveObjectStoreConfig, ObjectStoreConfig } from '@/archive/b2-config';
import { sha256OfBytes } from '@/archive/checksum';

/**
 * OPT-IN live round-trip against the real Backblaze B2 (S3-compatible)
 * object store.
 *
 * This suite talks to a real bucket over the network, so it is gated behind
 * the `COLONY_S3_IT` env var and only runs when both:
 *   1. `COLONY_S3_IT` is set (truthy), AND
 *   2. `resolveObjectStoreConfig()` successfully resolves (bucket/endpoint/
 *      region env vars set and a readable B2 credentials file present).
 *
 * In a normal `vitest run` (no `COLONY_S3_IT`), the whole describe block is
 * skipped -- not failed -- via `describe.skipIf`. When `COLONY_S3_IT` is set
 * but config resolution fails (e.g. no credentials file on this machine),
 * the test itself skips at runtime rather than throwing, since a missing
 * local credentials file is not a defect in this suite.
 *
 * When actually enabled and configured, a real network/auth failure MUST
 * fail loudly -- that is the entire point of opting in.
 */
describe.skipIf(!process.env.COLONY_S3_IT)('S3ObjectStore (live B2 integration)', () => {
  it('round-trips put/head/get against the real bucket and cleans up after itself', async () => {
    let config: ObjectStoreConfig;
    try {
      config = resolveObjectStoreConfig();
    } catch {
      // COLONY_S3_IT is set but this machine has no B2 credentials
      // configured -- skip rather than fail, since that's an environment
      // gap, not a test failure.
      return;
    }

    const store = new S3ObjectStore(config);
    const key = `archive/_it/s3-object-store/${Date.now()}-${Math.random().toString(36).slice(2)}.bin`;
    const bytes = new TextEncoder().encode(
      `colony-cults archive-object-store live integration test payload ${Date.now()}`,
    );
    const sha256 = sha256OfBytes(bytes);

    const client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    });

    try {
      await store.put(key, bytes, {
        sha256,
        contentType: 'application/octet-stream',
      });

      const head = await store.head(key);
      expect(head.exists).toBe(true);
      expect(head.sha256).toBe(sha256);
      expect(head.size).toBe(bytes.length);

      const fetched = await store.get(key);
      expect(Buffer.from(fetched)).toEqual(Buffer.from(bytes));
    } finally {
      await client.send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
      );
    }
  });
});
