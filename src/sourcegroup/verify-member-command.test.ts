import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadAllSources } from '@/bibliography/load';
import type { LoadedSource } from '@/bibliography/load';
import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import type { Source } from '@/model/source';
import type { ArkResolver } from '@/sourcegroup/verify-member';
import { runVerifyMember } from '@/sourcegroup/verify-member-command';
import type { LoadMembers, RunVerifyMemberInput } from '@/sourcegroup/verify-member-command';

/**
 * Tests for `runVerifyMember` (T021/T022, FR-006-009a, US2): the thin,
 * read-only `bib verify-member` command wrapper. Exercises the fail-loud
 * paths (member missing, ambiguous copy), the passing/failing-verdict exit
 * semantics (verdict is data -> always exit 0; only a tooling error is
 * non-zero), and the command's own wiring (record selection, the
 * existing-members duplicate lookup) via an injected `loadMembers` fake. A
 * final test exercises the real `loadAllSources` against real temp fixture
 * files on disk, to prove the `sourcesDir` wiring itself works end-to-end.
 */

const ARK = 'ark:/12148/bpt6k1234567';

const resolvesLive: ArkResolver = async (ark) => ({ ark });
const resolvesDead: ArkResolver = async () => null;

function source(overrides: Partial<Source> = {}): Source {
  return {
    sourceId: 'PB-P100',
    titles: [{ text: 'Le Petit Journal', role: 'canonical' }],
    kind: 'monograph',
    creator: 'Anonyme',
    identifiers: [],
    ...overrides,
  };
}

function authoredRecord(overrides: Partial<AuthoredRepositoryRecord> = {}): AuthoredRepositoryRecord {
  return {
    sourceArchive: 'Gallica / BnF',
    status: 'wanted',
    identifiers: [{ type: 'ark', value: ARK }],
    rights: { ark: ARK, status: 'public-domain', rawResponse: '<record/>', dcRights: ['public domain'] },
    ...overrides,
  };
}

function loaded(sourceOverrides: Partial<Source> = {}, records: AuthoredRepositoryRecord[] = []): LoadedSource {
  return { source: source(sourceOverrides), records, identifierLeaks: [] };
}

/** Fake `loadMembers`: ignores `sourcesDir` and returns the given fixture set. */
function fakeLoader(members: readonly LoadedSource[]): LoadMembers {
  return () => members;
}

interface Captured {
  out: string[];
  err: string[];
}

function baseInput(overrides: Partial<RunVerifyMemberInput> = {}, captured?: Captured): RunVerifyMemberInput {
  return {
    id: 'PB-P100',
    sourcesDir: '/unused',
    loadMembers: fakeLoader([loaded({}, [authoredRecord()])]),
    resolveArk: resolvesLive,
    writeOut: captured ? (line) => captured.out.push(line) : undefined,
    writeErr: captured ? (line) => captured.err.push(line) : undefined,
    ...overrides,
  };
}

describe('runVerifyMember', () => {
  it('fails loud when the member is missing', async () => {
    const captured: Captured = { out: [], err: [] };
    const result = await runVerifyMember(
      baseInput({ id: 'PB-P999', loadMembers: fakeLoader([]) }, captured),
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.verdict).toBeUndefined();
    expect(result.error).toMatch(/not found/i);
    expect(captured.err.join('\n')).toMatch(/PB-P999/);
  });

  it('fails loud when the member has an ambiguous copy and no --archive is given', async () => {
    const members = [
      loaded({}, [
        authoredRecord({ sourceArchive: 'Gallica / BnF' }),
        authoredRecord({ sourceArchive: 'State Library of Queensland' }),
      ]),
    ];
    const captured: Captured = { out: [], err: [] };
    const result = await runVerifyMember(baseInput({ loadMembers: fakeLoader(members) }, captured));

    expect(result.exitCode).not.toBe(0);
    expect(result.verdict).toBeUndefined();
    expect(result.error).toMatch(/ambiguous|--archive/i);
    expect(captured.err.join('\n')).toContain('Gallica / BnF');
  });

  it('prints a passing verdict and exits 0 for a clean member', async () => {
    const captured: Captured = { out: [], err: [] };
    const result = await runVerifyMember(baseInput({}, captured));

    expect(result.exitCode).toBe(0);
    expect(result.verdict?.result).toBe('passed');
    expect(captured.out.join('\n')).toMatch(/passed/);
    expect(captured.err).toEqual([]);
  });

  it('prints a failing verdict and STILL exits 0 -- a failing check is data, not a tooling error', async () => {
    const captured: Captured = { out: [], err: [] };
    const result = await runVerifyMember(baseInput({ resolveArk: resolvesDead }, captured));

    expect(result.exitCode).toBe(0);
    expect(result.verdict?.result).toBe('failed');
    expect(result.verdict?.checks.identifierResolved).toBe('failed');
    expect(captured.out.join('\n')).toMatch(/failed/);
    expect(captured.err).toEqual([]);
  });

  it('selects the copy named by --archive when the member has multiple copies', async () => {
    const members = [
      loaded({}, [
        authoredRecord({ sourceArchive: 'Gallica / BnF', identifiers: [{ type: 'ark', value: ARK }] }),
        authoredRecord({
          sourceArchive: 'State Library of Queensland',
          identifiers: [{ type: 'ark', value: 'ark:/other/999' }],
        }),
      ]),
    ];
    // Only the SLQ ark resolves; selecting it should fail identifierResolved,
    // proving the --archive selector -- not the first record -- was used.
    const resolveOnlySlqArk: ArkResolver = async (ark) =>
      ark === 'ark:/other/999' ? { ark } : null;

    const result = await runVerifyMember(
      baseInput({
        loadMembers: fakeLoader(members),
        archive: 'State Library of Queensland',
        resolveArk: resolveOnlySlqArk,
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.verdict?.checks.identifierResolved).toBe('passed');
  });

  it('flags hardDuplicate against another member holding the same ark at the same archive', async () => {
    const members = [
      loaded({}, [authoredRecord()]),
      loaded(
        { sourceId: 'PB-P200', titles: [{ text: 'Something Else', role: 'canonical' }] },
        [authoredRecord({ sourceArchive: 'Gallica / BnF' })],
      ),
    ];
    const result = await runVerifyMember(baseInput({ loadMembers: fakeLoader(members) }));

    expect(result.exitCode).toBe(0);
    expect(result.verdict?.checks.hardDuplicate).toBe('failed');
    expect(result.verdict?.result).toBe('failed');
  });

  it('excludes the member being verified from its own duplicate lookup (no self-collision)', async () => {
    // The SAME member holds the same ark at two different archives -- if the
    // duplicate lookup failed to exclude the member's own entries, the
    // second copy could spuriously flag against the first.
    const members = [
      loaded({}, [
        authoredRecord({ sourceArchive: 'Gallica / BnF' }),
        authoredRecord({ sourceArchive: 'State Library of Queensland' }),
      ]),
    ];
    const result = await runVerifyMember(
      baseInput({ loadMembers: fakeLoader(members), archive: 'State Library of Queensland' }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.verdict?.checks.hardDuplicate).toBe('passed');
    expect(result.verdict?.checks.possibleDuplicate).toBe('passed');
  });

  it('emits JSON when --json is set', async () => {
    const captured: Captured = { out: [], err: [] };
    const result = await runVerifyMember(baseInput({ json: true }, captured));

    expect(result.exitCode).toBe(0);
    expect(captured.out.length).toBe(1);
    const parsed: unknown = JSON.parse(captured.out[0]);
    expect(parsed).toMatchObject({ id: 'PB-P100', result: 'passed' });
  });

  it('surfaces a resolver (tooling) error verbatim and exits non-zero -- not a verdict', async () => {
    const throwingResolver: ArkResolver = async () => {
      throw new Error('network unreachable: ECONNRESET');
    };
    const captured: Captured = { out: [], err: [] };
    const result = await runVerifyMember(baseInput({ resolveArk: throwingResolver }, captured));

    expect(result.exitCode).not.toBe(0);
    expect(result.verdict).toBeUndefined();
    expect(result.error).toContain('network unreachable: ECONNRESET');
    expect(captured.out).toEqual([]);
  });

  describe('against real fixture files on disk', () => {
    let dir: string;

    afterEach(async () => {
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('loads via the real loadAllSources and prints a passing verdict', async () => {
      dir = await mkdtemp(join(tmpdir(), 'verify-member-command-'));
      const yaml = [
        'sourceId: PB-P100',
        'kind: monograph',
        'creator: Anonyme',
        'titles:',
        '  - text: Le Petit Journal',
        '    role: canonical',
        'repositoryRecords:',
        '  - sourceArchive: Gallica / BnF',
        '    status: wanted',
        '    identifiers:',
        '      - type: ark',
        `        value: ${ARK}`,
        '    rights:',
        `      ark: ${ARK}`,
        '      status: public-domain',
        '      rawResponse: "<record/>"',
        '      dcRights:',
        '        - public domain',
        '',
      ].join('\n');
      await writeFile(join(dir, 'PB-P100.yml'), yaml, 'utf8');

      const result = await runVerifyMember({
        id: 'PB-P100',
        sourcesDir: dir,
        loadMembers: (sourcesDir) => loadAllSources(sourcesDir),
        resolveArk: resolvesLive,
      });

      expect(result.exitCode).toBe(0);
      expect(result.verdict?.result).toBe('passed');
    });
  });
});
