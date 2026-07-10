import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveObjectStoreConfig } from '@/archive/b2-config';

/**
 * resolveObjectStoreConfig assembles the ObjectStoreConfig used to construct
 * the B2-backed ObjectStore: non-secret fields (bucket/endpoint/region) come
 * from env vars, and credentials (accessKeyId/secretAccessKey) are parsed out
 * of a Backblaze-style credentials file whose `applicationKey:` line is
 * TAB-delimited rather than space-delimited.
 */
describe('resolveObjectStoreConfig', () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  function writeCredentialsFile(contents: string): string {
    tmpDir = mkdtempSync(join(tmpdir(), 'b2-config-test-'));
    const filePath = join(tmpDir, 'b2-credentials.txt');
    writeFileSync(filePath, contents, 'utf8');
    return filePath;
  }

  function baseEnv(credentialsPath: string): NodeJS.ProcessEnv {
    return {
      COLONY_S3_BUCKET: 'colony-cults-archive',
      COLONY_S3_ENDPOINT: 'https://s3.us-west-002.backblazeb2.com',
      COLONY_S3_REGION: 'us-west-002',
      COLONY_B2_CREDENTIALS: credentialsPath,
    };
  }

  it('parses keyID/applicationKey out of a credentials file whose applicationKey line uses a real TAB after the colon', () => {
    // NOTE: the literal tab character below (between "applicationKey:" and
    // the secret) is load-bearing -- it proves the parser strips tabs, not
    // just spaces, from the value.
    const credentialsPath = writeCredentialsFile(
      'keyID: 0012abcdef34560000000001\n' +
        'keyName: colony-cults-archive-writer\n' +
        'applicationKey:\tK002superSecretApplicationKeyValue\n',
    );

    const config = resolveObjectStoreConfig(baseEnv(credentialsPath));

    expect(config.provider).toBe('backblaze-b2');
    expect(config.bucket).toBe('colony-cults-archive');
    expect(config.endpoint).toBe('https://s3.us-west-002.backblazeb2.com');
    expect(config.region).toBe('us-west-002');
    expect(config.accessKeyId).toBe('0012abcdef34560000000001');
    expect(config.secretAccessKey).toBe('K002superSecretApplicationKeyValue');
  });

  it('throws when a required non-secret env var (e.g. bucket) is missing', () => {
    const credentialsPath = writeCredentialsFile(
      'keyID: 0012abcdef34560000000001\n' +
        'keyName: colony-cults-archive-writer\n' +
        'applicationKey:\tK002superSecretApplicationKeyValue\n',
    );
    const env = baseEnv(credentialsPath);
    delete env.COLONY_S3_BUCKET;

    expect(() => resolveObjectStoreConfig(env)).toThrow(/COLONY_S3_BUCKET/);
  });

  it('throws when the credentials file is missing', () => {
    const env = baseEnv('/nonexistent/path/does-not-exist/b2-credentials.txt');

    expect(() => resolveObjectStoreConfig(env)).toThrow();
  });

  it('throws (naming keyID) when only keyID is absent', () => {
    // applicationKey present, keyID absent — proves the keyID branch on its own,
    // so a parser that accepted a present-applicationKey/absent-keyID file would fail.
    const credentialsPath = writeCredentialsFile(
      'keyName: colony-cults-archive-writer\n' +
        'applicationKey:\tK002superSecretApplicationKeyValue\n',
    );

    expect(() => resolveObjectStoreConfig(baseEnv(credentialsPath))).toThrow(
      /keyID/,
    );
  });

  it('throws (naming applicationKey) when only applicationKey is absent', () => {
    // keyID present, applicationKey absent — proves the applicationKey branch on
    // its own, so a parser that emitted an undefined/empty secretAccessKey for a
    // present-keyID/absent-applicationKey file would fail here rather than only at
    // a downstream B2 auth rejection.
    const credentialsPath = writeCredentialsFile(
      'keyID: 0012abcdef34560000000001\n' +
        'keyName: colony-cults-archive-writer\n',
    );

    expect(() => resolveObjectStoreConfig(baseEnv(credentialsPath))).toThrow(
      /applicationKey/,
    );
  });
});
