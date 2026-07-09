import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runFetchIssue, type FetchCliClient, type FetchDeps } from '@/cli/fetch';
import type { ParsedArgs } from '@/cli/parse';
import type {
  YearIndex,
  GallicaIssueRef,
  IssuesEnumeration,
  OaiRecordRights,
  IiifInfo,
} from '@/gallica/gallica-client';

/**
 * Unit coverage for SC-006 (T037): `fetch-issue --dry-run` must write NOTHING
 * to the filesystem -- no page image, no companion YAML, no integrity
 * manifest, no census file, not even the archive/census directories
 * themselves. Driven entirely against an injected FAKE client (no HTTP, no
 * fixtures) and temp `repoRoot`/`archiveRoot` directories that start (and, per
 * this test, must remain) empty. No network.
 */

const ISSUE_ARK = 'bpt6k5603637g';
const SOURCE_ID = 'PB-P001';

/** Throws (fail loud) -- a dry-run must never need this capability. */
function unexpectedCall(name: string): never {
  throw new Error(
    `dry-run test: unexpected call to ${name} -- a dry-run must not need it`,
  );
}

/** A fully in-memory fake `FetchCliClient`. Records every call made. */
function fakeCliClient(): FetchCliClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async years(): Promise<YearIndex> {
      return unexpectedCall('years');
    },
    async issuesForYear(): Promise<GallicaIssueRef[]> {
      return unexpectedCall('issuesForYear');
    },
    async issues(): Promise<IssuesEnumeration> {
      return unexpectedCall('issues');
    },
    async pagination(ark: string): Promise<number> {
      calls.push(`pagination:${ark}`);
      return 5;
    },
    async oaiRecord(): Promise<string> {
      return unexpectedCall('oaiRecord');
    },
    async oaiRights(ark: string): Promise<OaiRecordRights> {
      calls.push(`oaiRights:${ark}`);
      return {
        rawResponse: '<oai><dc:rights>domaine public</dc:rights></oai>',
        dcRights: ['domaine public'],
      };
    },
    async iiifInfo(): Promise<IiifInfo> {
      return unexpectedCall('iiifInfo');
    },
    async iiifImage(ark: string, page: number): Promise<Uint8Array> {
      // estimateIssue samples page 1 to size the dry-run estimate: reading is
      // fine (no write), so this is expected to be called exactly once.
      calls.push(`iiifImage:${ark}:${page}`);
      return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    },
    async issueDate(ark: string): Promise<string> {
      calls.push(`issueDate:${ark}`);
      return '1879-07-15';
    },
  };
}

function baseArgs(): ParsedArgs {
  return {
    command: 'fetch-issue',
    positional: [ISSUE_ARK],
    flags: { dryRun: true, force: false, verify: false, ocr: false, objectStore: false },
    options: { sourceId: SOURCE_ID, slug: undefined },
  };
}

/** Recursively list every path under `root` (empty when `root` is untouched). */
function listAllEntries(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const entries: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, name.name);
      entries.push(full);
      if (name.isDirectory()) {
        walk(full);
      }
    }
  };
  walk(root);
  return entries;
}

describe('fetch-issue --dry-run writes nothing (T037, SC-006)', () => {
  let repoRoot: string;
  let archiveRoot: string;
  let logs: string[];

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'cc-dryrun-repo-'));
    archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-dryrun-archive-'));
    logs = [];
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(archiveRoot, { recursive: true, force: true });
  });

  function deps(client: FetchCliClient): FetchDeps {
    return {
      client,
      repoRoot,
      archiveRoot,
      clock: () => new Date('2026-07-08T00:00:00.000Z'),
      builtAt: '2026-07-08',
      log: (message: string) => {
        logs.push(message);
      },
      ocrPreflight: async () => {
        throw new Error('dry-run test: ocrPreflight must not be called (no --ocr)');
      },
      ocrRunner: {
        run: async () => {
          throw new Error('dry-run test: ocrRunner must not be called in dry-run');
        },
      },
    };
  }

  it('creates zero files/dirs under the archive root', async () => {
    const client = fakeCliClient();
    await runFetchIssue(baseArgs(), deps(client));

    expect(listAllEntries(archiveRoot)).toEqual([]);
    expect(
      existsSync(path.join(archiveRoot, 'manifests', 'MANIFEST.sha256')),
    ).toBe(false);
  });

  it('creates zero files/dirs under the repo root (no census write)', async () => {
    const client = fakeCliClient();
    await runFetchIssue(baseArgs(), deps(client));

    expect(listAllEntries(repoRoot)).toEqual([]);
    expect(existsSync(path.join(repoRoot, 'data'))).toBe(false);
  });

  it('still reports rights status + target path + estimate, and never downloads/writes an image', async () => {
    const client = fakeCliClient();
    await runFetchIssue(baseArgs(), deps(client));

    // Reads (rights lookup, size sample) are allowed; nothing is stored.
    expect(client.calls).toContain(`oaiRights:${ISSUE_ARK}`);
    expect(client.calls).toContain(`pagination:${ISSUE_ARK}`);
    expect(client.calls).toContain(`iiifImage:${ISSUE_ARK}:1`);
    // Only page 1 is sampled for the estimate -- pages 2..5 are never fetched.
    expect(client.calls.filter((c) => c.startsWith('iiifImage:'))).toHaveLength(1);

    const report = logs.join('\n');
    expect(report).toMatch(/rights=public-domain/);
    expect(report).toMatch(/5 page\(s\)/);
    expect(report).toContain(
      path.join(archiveRoot, 'archive/cases/port-breton/newspapers/la-nouvelle-france'),
    );
  });

  it('writes nothing even when rights are refused (non-public-domain)', async () => {
    const client = fakeCliClient();
    client.oaiRights = async (ark: string) => {
      client.calls.push(`oaiRights:${ark}`);
      return {
        rawResponse: '<oai><dc:rights>copyrighted</dc:rights></oai>',
        dcRights: ['copyrighted'],
      };
    };

    await runFetchIssue(baseArgs(), deps(client));

    expect(listAllEntries(archiveRoot)).toEqual([]);
    expect(listAllEntries(repoRoot)).toEqual([]);
    // A refused item is never sampled for size.
    expect(client.calls.some((c) => c.startsWith('iiifImage:'))).toBe(false);
  });
});
