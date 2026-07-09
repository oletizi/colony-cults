import { describe, it, expect } from 'vitest';
import { S3ObjectStore } from '@/archive/s3-object-store';
import { ObjectStoreConfig } from '@/archive/b2-config';

/**
 * Unit-level, network-free coverage for S3ObjectStore.
 *
 * A full round-trip against a live B2 bucket is out of scope here and is
 * deferred to the opt-in integration test (T022). These tests only assert
 * that the store constructs from a config without throwing and exposes the
 * ObjectStore contract (head/put/get). They never open a socket.
 */
describe('S3ObjectStore', () => {
  const dummyConfig: ObjectStoreConfig = {
    provider: 'backblaze-b2',
    bucket: 'dummy-bucket',
    endpoint: 'https://s3.us-west-000.backblazeb2.example.invalid',
    region: 'us-west-000',
    accessKeyId: 'dummy-key-id',
    secretAccessKey: 'dummy-application-key',
  };

  it('constructs from a config without throwing', () => {
    expect(() => new S3ObjectStore(dummyConfig)).not.toThrow();
  });

  it('exposes the ObjectStore head/put/get methods', () => {
    const store = new S3ObjectStore(dummyConfig);
    expect(typeof store.head).toBe('function');
    expect(typeof store.put).toBe('function');
    expect(typeof store.get).toBe('function');
  });
});
