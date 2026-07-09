import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runFetchIssue } from '@/cli/fetch-issue';
import { runFetchSource } from '@/cli/fetch-source';
import type { FetchCliClient, FetchDeps } from '@/cli/fetch-shared';
import type { IssueCheckpoint } from '@/cli/archive-checkpoint';
import type { ParsedArgs } from '@/cli/parse';
import type {
  YearIndex,
  GallicaIssueRef,
  IssuesEnumeration,
  OaiRecordRights,
  IiifInfo,
} from '@/gallica/gallica-client';

/**
 * Proves the `FetchDeps.onIssueComplete` checkpoint hook fires exactly once
 * per completed issue, with a correctly-populated `IssueCheckpoint` -- and
 * that a dry-run/verify run never touches it. Entirely fake client (no
 * network) and a SPY `onIssueComplete` (no real git) -- the fetch core stays
 * git-free; only `defaultFetchDeps` would ever wire in the real adapter
 * (`@/cli/archive-checkpoint`), which this test never constructs.
 */

const ISSUE_ARK = 'bpt6k5603637g';
const SOURCE_ID = 'PB-P001';
const PAGE_COUNT = 3;

function unexpectedCall(name: string): never {
  throw new Error(`checkpoint-hook test: unexpected call to ${name}`);
}

function fakeCliClient(): FetchCliClient {
  return {
    async years(): Promise<YearIndex> {
      return unexpectedCall('years');
    },
    async issuesForYear(): Promise<GallicaIssueRef[]> {
      return unexpectedCall('issuesForYear');
    },
    async issues(): Promise<IssuesEnumeration> {
      return unexpectedCall('issues');
    },
    async pagination(): Promise<number> {
      return PAGE_COUNT;
    },
    async oaiRecord(): Promise<string> {
      return unexpectedCall('oaiRecord');
    },
    async oaiRights(): Promise<OaiRecordRights> {
      return {
        rawResponse: '<oai><dc:rights>domaine public</dc:rights></oai>',
        dcRights: ['domaine public'],
      };
    },
    async iiifInfo(): Promise<IiifInfo> {
      return unexpectedCall('iiifInfo');
    },
    async iiifImage(): Promise<Uint8Array> {
      return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    },
    async issueDate(): Promise<string> {
      return '1879-07-15';
    },
  };
}

function baseArgs(overrides: Partial<ParsedArgs['flags']> = {}): ParsedArgs {
  return {
    command: 'fetch-issue',
    positional: [ISSUE_ARK],
    flags: {
      dryRun: false,
      force: false,
      verify: false,
      ocr: false,
      objectStore: false,
      checkpoint: false,
      ...overrides,
    },
    options: { sourceId: SOURCE_ID, slug: undefined },
  };
}

describe('FetchDeps.onIssueComplete checkpoint hook (fetch-issue)', () => {
  let repoRoot: string;
  let archiveRoot: string;
  let calls: IssueCheckpoint[];

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'cc-hook-repo-'));
    archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-hook-archive-'));
    calls = [];
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(archiveRoot, { recursive: true, force: true });
  });

  function deps(): FetchDeps {
    return {
      client: fakeCliClient(),
      repoRoot,
      archiveRoot,
      clock: () => new Date('2026-07-08T00:00:00.000Z'),
      builtAt: '2026-07-08',
      log: () => {
        /* no-op */
      },
      ocrPreflight: async () => {
        throw new Error('checkpoint-hook test: ocrPreflight must not be called');
      },
      ocrRunner: {
        run: async () => {
          throw new Error('checkpoint-hook test: ocrRunner must not be called');
        },
      },
      onIssueComplete: async (checkpoint) => {
        calls.push(checkpoint);
      },
    };
  }

  it('fires once with the correct IssueCheckpoint after a real fetch', async () => {
    await runFetchIssue(baseArgs(), deps());

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      sourceId: SOURCE_ID,
      ark: ISSUE_ARK,
      date: '1879-07-15',
      dir: path.join(
        archiveRoot,
        'archive/cases/port-breton/newspapers/la-nouvelle-france',
        `1879-07-15_${ISSUE_ARK}`,
      ),
      pageCount: PAGE_COUNT,
      written: PAGE_COUNT,
      skipped: 0,
    });
  });

  it('does not fire on --dry-run', async () => {
    await runFetchIssue(baseArgs({ dryRun: true }), deps());
    expect(calls).toHaveLength(0);
  });

  it('does not fire on --verify', async () => {
    // Nothing fetched yet, so verify finds no directory -- still must not
    // invoke the hook.
    await runFetchIssue(baseArgs({ verify: true }), deps());
    expect(calls).toHaveLength(0);
  });

  it('is never invoked when onIssueComplete is undefined (checkpointing off)', async () => {
    const d = deps();
    d.onIssueComplete = undefined;
    // Must complete without throwing even though nothing is wired.
    await expect(runFetchIssue(baseArgs(), d)).resolves.toBeUndefined();
  });
});

/**
 * Monograph branch (`fetch-source` dispatches to `runFetchSourceMonograph`
 * for a `kind: 'monograph'` source, see `src/archive/location.ts`). A
 * monograph has no per-issue date, so its checkpoint is dateless -- proves
 * the hook still fires exactly once, with `date` absent, and is skipped on
 * `--verify`/`--dry-run` just like the periodical path.
 */
const MONOGRAPH_DOCUMENT_ARK = 'bpt6kFAKE00001';
const MONOGRAPH_SOURCE_ID = 'PB-P002';

function monographArgs(overrides: Partial<ParsedArgs['flags']> = {}): ParsedArgs {
  return {
    command: 'fetch-source',
    positional: [MONOGRAPH_DOCUMENT_ARK],
    flags: {
      dryRun: false,
      force: false,
      verify: false,
      ocr: false,
      objectStore: false,
      checkpoint: false,
      ...overrides,
    },
    options: { sourceId: MONOGRAPH_SOURCE_ID, slug: undefined },
  };
}

describe('FetchDeps.onIssueComplete checkpoint hook (fetch-source monograph)', () => {
  let repoRoot: string;
  let archiveRoot: string;
  let calls: IssueCheckpoint[];

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'cc-hook-mono-repo-'));
    archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-hook-mono-archive-'));
    calls = [];
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(archiveRoot, { recursive: true, force: true });
  });

  function deps(): FetchDeps {
    return {
      client: fakeCliClient(),
      repoRoot,
      archiveRoot,
      clock: () => new Date('2026-07-08T00:00:00.000Z'),
      builtAt: '2026-07-08',
      log: () => {
        /* no-op */
      },
      ocrPreflight: async () => {
        throw new Error('checkpoint-hook test: ocrPreflight must not be called');
      },
      ocrRunner: {
        run: async () => {
          throw new Error('checkpoint-hook test: ocrRunner must not be called');
        },
      },
      onIssueComplete: async (checkpoint) => {
        calls.push(checkpoint);
      },
    };
  }

  it('fires exactly once with a dateless IssueCheckpoint after a real monograph fetch', async () => {
    await runFetchSource(monographArgs(), deps());

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      sourceId: MONOGRAPH_SOURCE_ID,
      ark: MONOGRAPH_DOCUMENT_ARK,
      dir: path.join(
        archiveRoot,
        'archive/cases/port-breton/books',
        'nouvelle-france-colonie-libre-port-breton',
      ),
      pageCount: PAGE_COUNT,
      written: PAGE_COUNT,
      skipped: 0,
    });
    expect(calls[0].date).toBeUndefined();
  });

  it('does not fire on monograph --dry-run', async () => {
    await runFetchSource(monographArgs({ dryRun: true }), deps());
    expect(calls).toHaveLength(0);
  });

  it('does not fire on monograph --verify', async () => {
    await runFetchSource(monographArgs({ verify: true }), deps());
    expect(calls).toHaveLength(0);
  });

  it('is never invoked when onIssueComplete is undefined (checkpointing off)', async () => {
    const d = deps();
    d.onIssueComplete = undefined;
    await expect(runFetchSource(monographArgs(), d)).resolves.toBeUndefined();
  });
});
