import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Source } from '@/model/source';
import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import { serializeSource } from '@/bibliography/migrate-serialize';
import {
  parseAcquireArgs,
  parseApprovedRange,
  parseReconcileArgs,
  registerMemberArchiveLayout,
} from '@/cli/bib-sourcegroup';
import { sourceLayout } from '@/archive/location';

/**
 * Tests for `registerMemberArchiveLayout` (the gap-fix wiring): before `bib
 * acquire` drives the shipped fetcher -- which resolves a source's archive
 * layout deep inside via the synchronous, sourceId-only `sourceLayout` --
 * this function must have already registered a derived layout for a
 * source-group member that was never hand-added to the static registry.
 *
 * Also covers `parseAcquireArgs` (the `--checkpoint`/`--checkpoint-every`
 * forwarding gap-fix): asserted directly rather than through the full
 * `runAcquireCli`, since that always injects the real, unmocked, network-
 * backed `runFetchSource`.
 */

function group(overrides: Partial<Source> = {}): Source {
  return {
    sourceId: 'PB-S900',
    titles: [{ text: 'A Source Group', role: 'canonical' }],
    kind: 'source-group',
    identifiers: [],
    ...overrides,
  };
}

function member(overrides: Partial<Source> = {}): Source {
  return {
    sourceId: 'PB-P900',
    titles: [{ text: 'Le Petit Journal de Test', role: 'canonical' }],
    kind: 'monograph',
    partOf: 'PB-S900',
    status: 'approved-for-acquisition',
    identifiers: [],
    ...overrides,
  };
}

function record(overrides: Partial<AuthoredRepositoryRecord> = {}): AuthoredRepositoryRecord {
  return {
    sourceArchive: 'Gallica / BnF',
    status: 'to-collect',
    identifiers: [{ type: 'ark', value: 'ark:/12148/bpt6k0000001' }],
    ...overrides,
  };
}

async function seedSourcesDir(
  entries: { source: Source; records?: AuthoredRepositoryRecord[] }[],
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bib-sourcegroup-'));
  for (const entry of entries) {
    await writeFile(
      join(dir, `${entry.source.sourceId}.yml`),
      serializeSource({ source: entry.source, records: entry.records ?? [] }),
      'utf-8',
    );
  }
  return dir;
}

describe('registerMemberArchiveLayout', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('registers a runtime layout for a new member, resolvable by sourceLayout, using the group\'s case', async () => {
    dir = await seedSourcesDir([
      { source: group({ sourceId: 'PB-S901', case: 'port-breton' }) },
      { source: member({ sourceId: 'PB-P920', partOf: 'PB-S901' }), records: [record()] },
    ]);

    registerMemberArchiveLayout(dir, 'PB-P920');

    const layout = sourceLayout('PB-P920');
    expect(layout.case).toBe('port-breton');
    expect(layout.type).toBe('books');
    expect(layout.kind).toBe('monograph');
    expect(layout.slug).toBe('le-petit-journal-de-test');
  });

  it('prefers the member\'s own case over the group\'s when both are present', async () => {
    dir = await seedSourcesDir([
      { source: group({ sourceId: 'PB-S902', case: 'port-breton' }) },
      {
        source: member({ sourceId: 'PB-P921', partOf: 'PB-S902', case: 'a-different-case' }),
        records: [record()],
      },
    ]);

    registerMemberArchiveLayout(dir, 'PB-P921');

    expect(sourceLayout('PB-P921').case).toBe('a-different-case');
  });

  it('registers a periodical member under "newspapers"', async () => {
    dir = await seedSourcesDir([
      { source: group({ sourceId: 'PB-S903', case: 'port-breton' }) },
      {
        source: member({ sourceId: 'PB-P922', partOf: 'PB-S903', kind: 'periodical' }),
        records: [record()],
      },
    ]);

    registerMemberArchiveLayout(dir, 'PB-P922');

    const layout = sourceLayout('PB-P922');
    expect(layout.type).toBe('newspapers');
    expect(layout.kind).toBe('periodical');
  });

  it('fails loud when the sourceId does not resolve to any Source', async () => {
    dir = await seedSourcesDir([{ source: group({ sourceId: 'PB-S904', case: 'port-breton' }) }]);

    expect(() => registerMemberArchiveLayout(dir, 'PB-P999')).toThrow(/unknown sourceId/i);
  });

  it('fails loud when the member\'s partOf group does not resolve to any Source', async () => {
    dir = await seedSourcesDir([
      { source: member({ sourceId: 'PB-P923', partOf: 'PB-S999' }), records: [record()] },
    ]);

    expect(() => registerMemberArchiveLayout(dir, 'PB-P923')).toThrow(/PB-S999/);
  });

  it('fails loud when neither the member nor its group carries a case', async () => {
    dir = await seedSourcesDir([
      { source: group({ sourceId: 'PB-S905', case: undefined }) },
      {
        source: member({ sourceId: 'PB-P924', partOf: 'PB-S905', case: undefined }),
        records: [record()],
      },
    ]);

    expect(() => registerMemberArchiveLayout(dir, 'PB-P924')).toThrow(/case/i);
  });

  it('is idempotent across repeated invocations (e.g. a retried acquire) for the same member', async () => {
    dir = await seedSourcesDir([
      { source: group({ sourceId: 'PB-S906', case: 'port-breton' }) },
      { source: member({ sourceId: 'PB-P925', partOf: 'PB-S906' }), records: [record()] },
    ]);

    registerMemberArchiveLayout(dir, 'PB-P925');
    expect(() => registerMemberArchiveLayout(dir, 'PB-P925')).not.toThrow();
  });
});

describe('parseAcquireArgs', () => {
  it('defaults checkpoint to false and checkpointEvery to undefined when neither flag is given', () => {
    const parsed = parseAcquireArgs(['PB-P100']);
    expect(parsed.id).toBe('PB-P100');
    expect(parsed.checkpoint).toBe(false);
    expect(parsed.checkpointEvery).toBeUndefined();
  });

  it('parses --checkpoint and --checkpoint-every <N> into typed flags', () => {
    const parsed = parseAcquireArgs(['PB-P100', '--checkpoint', '--checkpoint-every', '25']);
    expect(parsed.checkpoint).toBe(true);
    expect(parsed.checkpointEvery).toBe(25);
  });

  it('still forwards --archive/--object-store/--dry-run alongside --checkpoint', () => {
    const parsed = parseAcquireArgs([
      'PB-P100',
      '--archive',
      'Gallica / BnF',
      '--object-store',
      '--dry-run',
      '--checkpoint',
    ]);
    expect(parsed.archive).toBe('Gallica / BnF');
    expect(parsed.objectStore).toBe(true);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.checkpoint).toBe(true);
  });

  it('fails loud when --checkpoint-every is not a positive integer', () => {
    expect(() => parseAcquireArgs(['PB-P100', '--checkpoint-every', '0'])).toThrow(
      /checkpoint-every/i,
    );
    expect(() => parseAcquireArgs(['PB-P100', '--checkpoint-every', 'abc'])).toThrow(
      /checkpoint-every/i,
    );
  });

  it('defaults approvedRange/reject/notes when none of the IA quality-gate flags are given', () => {
    const parsed = parseAcquireArgs(['PB-P100']);
    expect(parsed.approvedRange).toBeUndefined();
    expect(parsed.reject).toBe(false);
    expect(parsed.notes).toBeUndefined();
  });

  it('parses --approved-range, --reject, and --notes (the IA two-phase quality-gate flags)', () => {
    const parsed = parseAcquireArgs([
      'PB-P100',
      '--approved-range',
      '4-368',
      '--reject',
      '--notes',
      'scan too dark past leaf 300',
    ]);
    expect(parsed.approvedRange).toEqual({ start: 4, end: 368 });
    expect(parsed.reject).toBe(true);
    expect(parsed.notes).toBe('scan too dark past leaf 300');
  });
});

describe('parseApprovedRange', () => {
  it('returns undefined when the flag is absent', () => {
    expect(parseApprovedRange(undefined)).toBeUndefined();
  });

  it('parses "4-368" into { start: 4, end: 368 }', () => {
    expect(parseApprovedRange('4-368')).toEqual({ start: 4, end: 368 });
  });

  it('fails loud on a non-range string', () => {
    expect(() => parseApprovedRange('x')).toThrow(/--approved-range/);
  });

  it('fails loud when end < start', () => {
    expect(() => parseApprovedRange('5-2')).toThrow(/--approved-range/);
  });

  it('fails loud on an empty string', () => {
    expect(() => parseApprovedRange('')).toThrow(/--approved-range/);
  });
});

describe('parseReconcileArgs', () => {
  it('parses the sole positional as the id, leaving optional selectors undefined', () => {
    const parsed = parseReconcileArgs(['PB-P007']);
    expect(parsed.id).toBe('PB-P007');
    expect(parsed.archive).toBeUndefined();
    expect(parsed.archiveRoot).toBeUndefined();
  });

  it('parses --archive and --archive-root into typed fields', () => {
    const parsed = parseReconcileArgs([
      'PB-P007',
      '--archive',
      'Gallica / BnF',
      '--archive-root',
      '/tmp/archive',
    ]);
    expect(parsed.id).toBe('PB-P007');
    expect(parsed.archive).toBe('Gallica / BnF');
    expect(parsed.archiveRoot).toBe('/tmp/archive');
  });

  it('leaves id undefined when no positional is given (handler reports the missing arg)', () => {
    const parsed = parseReconcileArgs([]);
    expect(parsed.id).toBeUndefined();
  });

  it('fails loud on an unknown flag (strict parsing, no silent ignore)', () => {
    expect(() => parseReconcileArgs(['PB-P007', '--object-store'])).toThrow();
  });
});
