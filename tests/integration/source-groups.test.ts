import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runFetchSource } from '@/cli/fetch-source';
import type { FetchDeps, FetchCliClient } from '@/cli/fetch-shared';
import type { ParsedArgs } from '@/cli/parse';
import type {
  YearIndex,
  GallicaIssueRef,
  IssuesEnumeration,
  OaiRecordRights,
  IiifInfo,
} from '@/gallica/gallica-client';

/**
 * RED test for the source-groups fetch guardrail (T004).
 *
 * When `runFetchSource` is invoked on a source whose canonical `kind` is
 * `source-group`, it MUST throw an informative error BEFORE consulting
 * `sourceLayout` (which would throw a generic "no archive layout registered"
 * message).
 *
 * The test arranges a temp bibliography/sources/ with:
 * - PB-P004: a source-group (no archival object, no layout)
 * - PB-P005: an ordinary monograph (has a layout, but will fail later for other reasons)
 *
 * Assertions:
 * 1. Fetching PB-P004 (source-group) throws with a message naming the ID and
 *    mentioning "Source Group" / "discover and inventory".
 * 2. The error is NOT the generic "no archive layout registered" message.
 * 3. Fetching PB-P005 (monograph) throws the sourceLayout error (positive control).
 */

const SOURCE_GROUP_ID = 'PB-P004';
const MONOGRAPH_ID = 'PB-P005';
const DOCUMENT_ARK = 'bpt6kTEST00001';

const SOURCE_GROUP_YAML = `
sourceId: ${SOURCE_GROUP_ID}
kind: source-group
case: port-breton
titles:
  - text: "French trial and legal proceedings relating to the Marquis de Rays"
    role: canonical
`;

const MONOGRAPH_YAML = `
sourceId: ${MONOGRAPH_ID}
kind: monograph
case: port-breton
titles:
  - text: "Test Monograph"
    role: canonical
`;

function unexpectedCall(name: string): never {
  throw new Error(`source-groups test: unexpected call to ${name}`);
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
      return unexpectedCall('pagination');
    },
    async oaiRecord(): Promise<string> {
      return unexpectedCall('oaiRecord');
    },
    async oaiRights(): Promise<OaiRecordRights> {
      return unexpectedCall('oaiRights');
    },
    async iiifInfo(): Promise<IiifInfo> {
      return unexpectedCall('iiifInfo');
    },
    async iiifImage(): Promise<Uint8Array> {
      return unexpectedCall('iiifImage');
    },
    async issueDate(): Promise<string> {
      return unexpectedCall('issueDate');
    },
  };
}

describe('fetch-source guardrail for source-groups (T004)', () => {
  let repoRoot: string;
  let archiveRoot: string;
  let sourcesDir: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'cc-sg-repo-'));
    archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-sg-archive-'));
    sourcesDir = path.join(repoRoot, 'bibliography', 'sources');
    mkdirSync(sourcesDir, { recursive: true });

    // Write fixture sources
    writeFileSync(path.join(sourcesDir, `${SOURCE_GROUP_ID}.yml`), SOURCE_GROUP_YAML.trim());
    writeFileSync(path.join(sourcesDir, `${MONOGRAPH_ID}.yml`), MONOGRAPH_YAML.trim());
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(archiveRoot, { recursive: true, force: true });
  });

  function baseDeps(): FetchDeps {
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
        throw new Error('source-groups test: ocrPreflight must not be called');
      },
      ocrRunner: {
        run: async () => {
          throw new Error('source-groups test: ocrRunner must not be called');
        },
      },
    };
  }

  function argsFor(sourceId: string): ParsedArgs {
    return {
      command: 'fetch-source',
      positional: [DOCUMENT_ARK],
      flags: {
        dryRun: false,
        force: false,
        verify: false,
        ocr: false,
        enhanceContrast: false,
        objectStore: false,
        reconcileRemote: false,
        checkpoint: false,
      },
      options: { sourceId, slug: undefined, archiveRoot: undefined, checkpointEvery: undefined },
    };
  }

  it('throws an informative error when fetching a source-group (guardrail)', async () => {
    let thrownError: unknown;
    try {
      await runFetchSource(argsFor(SOURCE_GROUP_ID), baseDeps());
    } catch (e) {
      thrownError = e;
    }

    expect(thrownError).toBeDefined();
    const message = thrownError instanceof Error ? thrownError.message : String(thrownError);

    // The error message MUST:
    // 1. Name the source ID
    // 2. Mention "Source Group" (or similar wording indicating it's a group)
    // 3. Direct user to discover/inventory members
    expect(message).toContain(SOURCE_GROUP_ID);
    expect(message).toMatch(/[Ss]ource [Gg]roup|group members|discover.*inventory/);
  });

  it('does NOT throw the generic "no archive layout registered" message for a source-group', async () => {
    let thrownError: unknown;
    try {
      await runFetchSource(argsFor(SOURCE_GROUP_ID), baseDeps());
    } catch (e) {
      thrownError = e;
    }

    expect(thrownError).toBeDefined();
    const message = thrownError instanceof Error ? thrownError.message : String(thrownError);

    // The error message must NOT be the generic sourceLayout error
    expect(message).not.toMatch(/no archive layout registered/i);
  });

  it('throws a sourceLayout error (not the source-group guardrail) for an unregistered monograph', async () => {
    // PB-P005 is a monograph but is not registered in archive/location.ts,
    // so it should fail with the sourceLayout error, not the source-group error.
    let thrownError: unknown;
    try {
      await runFetchSource(argsFor(MONOGRAPH_ID), baseDeps());
    } catch (e) {
      thrownError = e;
    }

    expect(thrownError).toBeDefined();
    const message = thrownError instanceof Error ? thrownError.message : String(thrownError);

    // This SHOULD be the sourceLayout error since PB-P005 is not in the registry
    expect(message).toMatch(/no archive layout registered/i);
    // It should NOT be the source-group message
    expect(message).not.toMatch(/[Ss]ource [Gg]roup|group members/);
  });
});
