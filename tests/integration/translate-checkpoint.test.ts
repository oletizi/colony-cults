import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { translateIssue } from '@/translate/issue';
import { runTranslate, type TranslateCliDeps } from '@/cli/translate';
import { writeProvenance, type ProvenanceFields } from '@/archive/provenance';
import type { ParsedArgs } from '@/cli/parse';
import type {
  CommitCheckpointFn,
  IssueCheckpoint,
  PageStored,
} from '@/cli/archive-checkpoint';
import { buildCtx, fakeClaude, TEST_MODEL, FIXED_DATE } from './support/translate-archive';

/**
 * Coverage for translate's git-checkpoint wiring, which reuses the acquisition
 * pipeline's page-cadence hook (`buildMonographPageCheckpointHook`) +
 * `commitAndPushIssueCheckpoint`. The core fires `onPageStored` per page; the
 * CLI drives the per-N-pages commit cadence and the final end-of-document
 * flush. All git is faked -- no real commits.
 */

const MONO_SOURCE_ID = 'PB-P002';
const MONO_ARK = 'bpt6k58039518';
const MONO_SUBPATH =
  'archive/cases/port-breton/books/nouvelle-france-colonie-libre-port-breton';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function pageProvenance(): ProvenanceFields {
  return {
    id: MONO_SOURCE_ID,
    title: 'Nouvelle-France',
    type: 'page-image',
    case: 'port-breton',
    language: 'French',
    source_archive: 'Gallica / BnF',
    catalog_url: `https://gallica.bnf.fr/ark:/12148/${MONO_ARK}`,
    original_url: '',
    rights_status: 'public-domain',
    retrieved: '2026-07-10T00:00:00.000Z',
    local_path: `${MONO_SUBPATH}/f001.jpg`,
    sha256: 'deadbeef',
    size: 0,
    format: 'image/jpeg',
    ocr_status: 'searchable',
    object_store: null,
    rights_raw: '<results/>',
    notes: null,
  };
}

async function buildMonograph(): Promise<{ archiveRoot: string; dir: string }> {
  const archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-ckpt-'));
  roots.push(archiveRoot);
  const dir = path.join(archiveRoot, MONO_SUBPATH);
  mkdirSync(dir, { recursive: true });
  for (let n = 1; n <= 3; n += 1) {
    await writeProvenance(
      path.join(dir, `f${String(n).padStart(3, '0')}.yml`),
      pageProvenance(),
    );
  }
  const page = (n: number) =>
    `Page ${n} du livre avec assez de texte francais reel pour depasser le seuil.`;
  writeFileSync(path.join(dir, 'issue.txt'), [page(1), page(2), page(3)].join('\f'));
  return { archiveRoot, dir };
}

describe('translateIssue onPageStored hook', () => {
  it('fires once per page with the page ordinal and skipped flag', async () => {
    const { archiveRoot } = await buildMonograph();
    const stored: PageStored[] = [];
    const { ctx } = buildCtx(
      { archiveRoot, sourceId: MONO_SOURCE_ID },
      { onPageStored: async (p) => void stored.push(p) },
    );

    const result = await translateIssue(MONO_ARK, ctx);

    expect(result.outcome).toBe('translated');
    // One hook call per page, in order, all freshly written (not skipped).
    expect(stored.map((s) => s.page)).toEqual([1, 2, 3]);
    expect(stored.every((s) => s.skipped === false)).toBe(true);
    expect(stored.every((s) => s.pageCount === 3 && s.ark === MONO_ARK)).toBe(true);
  });

  it('fires with skipped=true for already-translated pages on a resumed run', async () => {
    const { archiveRoot } = await buildMonograph();
    // First run translates all pages.
    await translateIssue(MONO_ARK, buildCtx({ archiveRoot, sourceId: MONO_SOURCE_ID }).ctx);

    // Second run: every page is a skip, but the hook still fires (cadence must
    // advance on a resume).
    const stored: PageStored[] = [];
    const { ctx } = buildCtx(
      { archiveRoot, sourceId: MONO_SOURCE_ID },
      { onPageStored: async (p) => void stored.push(p) },
    );
    const result = await translateIssue(MONO_ARK, ctx);

    expect(result.outcome).toBe('skipped');
    expect(stored.map((s) => s.page)).toEqual([1, 2, 3]);
    expect(stored.every((s) => s.skipped === true)).toBe(true);
  });
});

describe('runTranslate --checkpoint wiring', () => {
  function deps(
    archiveRoot: string,
    checkpoint: CommitCheckpointFn,
  ): TranslateCliDeps {
    return {
      engine: fakeClaude([]),
      model: TEST_MODEL,
      archiveRoot,
      clock: () => new Date(FIXED_DATE),
      log: () => undefined,
      preflight: async () => undefined,
      delay: async () => undefined,
      checkpoint,
    };
  }

  function args(): ParsedArgs {
    return {
      command: 'translate',
      positional: [MONO_ARK],
      flags: {
        dryRun: false,
        force: false,
        verify: false,
        ocr: false,
        objectStore: false,
        reconcileRemote: false,
        checkpoint: true,
      },
      options: { sourceId: MONO_SOURCE_ID, checkpointEvery: 2 },
    };
  }

  it('commits every N pages (cadence) plus a final end-of-document flush', async () => {
    const { archiveRoot } = await buildMonograph();
    const commits: Array<{ c: IssueCheckpoint; push: boolean }> = [];
    const checkpoint: CommitCheckpointFn = async (_root, c, opts) => {
      commits.push({ c, push: opts.push });
    };

    await runTranslate(args(), deps(archiveRoot, checkpoint));

    // 3 pages, checkpoint-every=2 -> one cadence commit at page 2, then a
    // final flush for the trailing page + whole-document artifacts.
    expect(commits).toHaveLength(2);
    expect(commits[0].c.page).toBe(2); // cadence checkpoint carries the page
    expect(commits[1].c.page).toBeUndefined(); // final flush has no page
    expect(commits[1].c.written).toBe(3); // final flush reports pagesDone
    expect(commits.every((x) => x.push === true)).toBe(true);
  });

  it('does not touch git on a --dry-run', async () => {
    const { archiveRoot } = await buildMonograph();
    let called = false;
    const checkpoint: CommitCheckpointFn = async () => {
      called = true;
    };
    const dryArgs = args();
    dryArgs.flags.dryRun = true;

    await runTranslate(dryArgs, deps(archiveRoot, checkpoint));
    expect(called).toBe(false);
  });
});
