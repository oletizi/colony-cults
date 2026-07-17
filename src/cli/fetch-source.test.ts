import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runFetchSource } from '@/cli/fetch-source';
import { runFetchIssue } from '@/cli/fetch-issue';
import type { FetchCliClient, FetchDeps } from '@/cli/fetch-shared';
import { monographDir } from '@/archive/location';
import type { ParsedArgs, ParsedFlags } from '@/cli/parse';
import type {
  YearIndex,
  GallicaIssueRef,
  IssuesEnumeration,
  OaiRecordRights,
  IiifInfo,
} from '@/gallica/gallica-client';

/**
 * CLI coverage for `--pages` (spec 012, T009/T012/T013):
 * - `fetch-source --pages <spec> --dry-run` reports ONLY the selected folios
 *   and writes nothing.
 * - `fetch-source --pages <spec>` threads the parsed selection into the
 *   monograph fetch, so ONLY those folios are downloaded/written.
 * - a malformed `--pages` spec surfaces `parseFolioRange`'s fail-loud error.
 * - `--pages` on the periodical `fetch-issue` path is a usage error.
 *
 * Driven entirely against an injected fake `FetchCliClient` (no HTTP, no
 * fixtures) and temp `repoRoot`/`archiveRoot` directories -- never the real
 * archive, never Gallica. `PB-P002` is the real registered monograph source
 * (see `bibliography/sources/PB-P002.yml`), reused here exactly as the
 * existing monograph fetch tests do.
 */

const DOCUMENT_ARK = 'bpt6kFAKE00001';
const MONOGRAPH_SOURCE_ID = 'PB-P002';
const PERIODICAL_SOURCE_ID = 'PB-P001';
const PERIODICAL_ISSUE_ARK = 'bpt6k5603637g';
const DOCUMENT_PAGE_COUNT = 200;

const PUBLIC_DOMAIN_RIGHTS: OaiRecordRights = {
  rawResponse: '<oai><dc:rights>domaine public</dc:rights></oai>',
  dcRights: ['domaine public'],
};

/** A fully in-memory fake `FetchCliClient`. Records every call made. */
function fakeCliClient(pageCount = DOCUMENT_PAGE_COUNT): FetchCliClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async years(): Promise<YearIndex> {
      throw new Error('fetch-source test: unexpected call to years');
    },
    async issuesForYear(): Promise<GallicaIssueRef[]> {
      throw new Error('fetch-source test: unexpected call to issuesForYear');
    },
    async issues(): Promise<IssuesEnumeration> {
      throw new Error('fetch-source test: unexpected call to issues');
    },
    async pagination(ark: string): Promise<number> {
      calls.push(`pagination:${ark}`);
      return pageCount;
    },
    async oaiRecord(): Promise<string> {
      return PUBLIC_DOMAIN_RIGHTS.rawResponse;
    },
    async oaiRights(ark: string): Promise<OaiRecordRights> {
      calls.push(`oaiRights:${ark}`);
      return PUBLIC_DOMAIN_RIGHTS;
    },
    async iiifInfo(): Promise<IiifInfo> {
      return { width: 100, height: 100 };
    },
    async iiifImage(ark: string, page: number): Promise<Uint8Array> {
      calls.push(`iiifImage:${ark}:${page}`);
      return new Uint8Array([0xff, 0xd8, page, page, page, 0xff, 0xd9]);
    },
    async issueDate(ark: string): Promise<string> {
      calls.push(`issueDate:${ark}`);
      return '1879-07-15';
    },
  };
}

function baseFlags(overrides: Partial<ParsedFlags> = {}): ParsedFlags {
  return {
    dryRun: false,
    force: false,
    verify: false,
    ocr: false,
    objectStore: false,
    reconcileRemote: false,
    checkpoint: false,
    ...overrides,
  };
}

describe('fetch-source --pages (spec 012, T009/T012/T013)', () => {
  let repoRoot: string;
  let archiveRoot: string;
  let logs: string[];

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'cc-pages-repo-'));
    archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-pages-archive-'));
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
      clock: () => new Date('2026-07-15T00:00:00.000Z'),
      builtAt: '2026-07-15',
      log: (message: string) => {
        logs.push(message);
      },
      ocrPreflight: async () => {
        throw new Error('fetch-source test: ocrPreflight must not be called (no --ocr)');
      },
      ocrRunner: {
        run: async () => {
          throw new Error('fetch-source test: ocrRunner must not be called');
        },
      },
    };
  }

  it('--dry-run --pages 48-50 reports exactly 3 folios and writes nothing', async () => {
    const client = fakeCliClient();
    const args: ParsedArgs = {
      command: 'fetch-source',
      positional: [DOCUMENT_ARK],
      flags: baseFlags({ dryRun: true }),
      options: { sourceId: MONOGRAPH_SOURCE_ID, pages: '48-50' },
    };

    await runFetchSource(args, deps(client));

    // Only folio 48 (the first of the selection) is sampled for the estimate.
    expect(client.calls.filter((c) => c.startsWith('iiifImage:'))).toEqual([
      `iiifImage:${DOCUMENT_ARK}:48`,
    ]);

    const report = logs.join('\n');
    expect(report).toMatch(/3 page\(s\)/);
    expect(report).not.toMatch(/200 page\(s\)/);

    const dir = monographDir(MONOGRAPH_SOURCE_ID, archiveRoot);
    expect(existsSync(dir)).toBe(false);
  });

  it('--pages 48-50 fetches ONLY folios 48, 49, 50', async () => {
    const client = fakeCliClient();
    const args: ParsedArgs = {
      command: 'fetch-source',
      positional: [DOCUMENT_ARK],
      flags: baseFlags(),
      options: { sourceId: MONOGRAPH_SOURCE_ID, pages: '48-50' },
    };

    await runFetchSource(args, deps(client));

    expect(client.calls.filter((c) => c.startsWith('iiifImage:'))).toEqual([
      `iiifImage:${DOCUMENT_ARK}:48`,
      `iiifImage:${DOCUMENT_ARK}:49`,
      `iiifImage:${DOCUMENT_ARK}:50`,
    ]);

    const dir = monographDir(MONOGRAPH_SOURCE_ID, archiveRoot);
    expect(existsSync(path.join(dir, 'f048.jpg'))).toBe(true);
    expect(existsSync(path.join(dir, 'f049.jpg'))).toBe(true);
    expect(existsSync(path.join(dir, 'f050.jpg'))).toBe(true);
    expect(existsSync(path.join(dir, 'f001.jpg'))).toBe(false);
    expect(existsSync(path.join(dir, 'f051.jpg'))).toBe(false);
  });

  it('a malformed --pages spec surfaces the parser\'s fail-loud error', async () => {
    const client = fakeCliClient();
    const args: ParsedArgs = {
      command: 'fetch-source',
      positional: [DOCUMENT_ARK],
      flags: baseFlags(),
      options: { sourceId: MONOGRAPH_SOURCE_ID, pages: '50-48' },
    };

    await expect(runFetchSource(args, deps(client))).rejects.toThrow(/reversed range/i);

    const dir = monographDir(MONOGRAPH_SOURCE_ID, archiveRoot);
    expect(existsSync(dir)).toBe(false);
    expect(client.calls).toEqual([]);
  });

  it('--pages on the periodical fetch-issue path is a usage error', async () => {
    const client = fakeCliClient();
    const args: ParsedArgs = {
      command: 'fetch-issue',
      positional: [PERIODICAL_ISSUE_ARK],
      flags: baseFlags(),
      options: { sourceId: PERIODICAL_SOURCE_ID, pages: '1-2' },
    };

    await expect(runFetchIssue(args, deps(client))).rejects.toThrow(/--pages/);
    // Fails before any client call is made.
    expect(client.calls).toEqual([]);
  });
});
