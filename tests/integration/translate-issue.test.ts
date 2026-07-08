import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { translateIssue, DEFAULT_MODEL } from '@/translate/issue';
import type { TranslateIssueCtx } from '@/translate/issue';
import type { ClaudeCli } from '@/claude/client';
import { readProvenance, writeProvenance } from '@/archive/provenance';

/**
 * Integration coverage for the CORE issue-translation orchestrator (T016/T017/
 * T019): `translateIssue` is driven against a temp archive laid out exactly as
 * `findIssueDir` expects for the registered source `PB-P001`, with a FAKE
 * `ClaudeCli` whose deterministic outputs make the two passes distinguishable
 * (`CLEAN(...)` for cleanup, `EN(...)` for translation) so the English can be
 * shown to derive from the corrected French. No real `claude`, no network.
 */

// Registered periodical layout for PB-P001 (src/archive/location.ts):
//   port-breton / newspapers / la-nouvelle-france.
const SOURCE_ID = 'PB-P001';
// Alphanumeric bare ark (passes assertValidArk); the issue dir is named
// `<date>_<bareArk>` so `findIssueDir` matches on the `_<bareArk>` suffix.
const BARE_ARK = 'bpt6k5603637g';
const ISSUE_DIR_NAME = `1875-01-15_${BARE_ARK}`;
const FIXED_DATE = '2026-07-08T00:00:00.000Z';

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

/** One recorded engine invocation: which pass, and the model it was given. */
interface EngineCall {
  pass: 'clean' | 'en';
  model: string | undefined;
}

/**
 * Fake engine: the cleanup prompt and the translation prompt are distinct, so
 * we branch on the (translation-only) marker phrase. Wrapping the input makes
 * the corrected-French -> English chain observable: page P becomes CLEAN(P),
 * then the translation pass receives CLEAN(P) and returns EN(CLEAN(P)). Every
 * call records the `model` argument so a test can prove the value sent to the
 * engine matches the value recorded in provenance.
 */
function fakeClaude(calls: EngineCall[]): ClaudeCli {
  return {
    run: async (prompt, sourceText, model) => {
      if (prompt.includes('Translate the following corrected French')) {
        calls.push({ pass: 'en', model });
        return `EN(${sourceText})`;
      }
      calls.push({ pass: 'clean', model });
      return `CLEAN(${sourceText})`;
    },
  };
}

describe('translateIssue (T016/T017/T019)', () => {
  let archiveRoot: string;
  let issueDir: string;

  beforeEach(async () => {
    archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-translate-'));
    issueDir = path.join(
      archiveRoot,
      'archive/cases/port-breton/newspapers/la-nouvelle-france',
      ISSUE_DIR_NAME,
    );
    mkdirSync(issueDir, { recursive: true });

    // Companion provenance derived from the shared fixture (public-domain).
    const base = await readProvenance(fixturePath('page-provenance.yml'));
    for (const n of [1, 2, 3]) {
      const stem = `f${String(n).padStart(3, '0')}`;
      writeFileSync(path.join(issueDir, `${stem}.jpg`), `FAKE-PAGE-${n}`);
      await writeProvenance(path.join(issueDir, `${stem}.yml`), base);
    }

    // 3-page issue.txt (two form-feeds) copied from the fixture.
    const issueText = await readFile(fixturePath('issue-sample.txt'), 'utf-8');
    writeFileSync(path.join(issueDir, 'issue.txt'), issueText);
  });

  afterEach(() => {
    rmSync(archiveRoot, { recursive: true, force: true });
  });

  function makeCtx(overrides: Partial<TranslateIssueCtx> = {}): {
    ctx: TranslateIssueCtx;
    calls: EngineCall[];
    preflightCalls: { n: number };
  } {
    const calls: EngineCall[] = [];
    const preflightCalls = { n: 0 };
    const ctx: TranslateIssueCtx = {
      claude: fakeClaude(calls),
      sourceId: SOURCE_ID,
      archiveRoot,
      clock: () => new Date(FIXED_DATE),
      force: false,
      log: () => {},
      preflight: async () => {
        preflightCalls.n += 1;
      },
      ...overrides,
    };
    return { ctx, calls, preflightCalls };
  }

  it('translates all pages, assembles fr/en artifacts, and stamps provenance', async () => {
    const { ctx, calls, preflightCalls } = makeCtx();

    const result = await translateIssue(BARE_ARK, ctx);

    expect(result.outcome).toBe('translated');
    expect(result.pagesTotal).toBe(3);
    expect(result.pagesDone).toBe(3);
    expect(result.pagesDone).toBe(result.pagesTotal);

    // Preflight ran exactly once, after the rights gate, before any claude call.
    expect(preflightCalls.n).toBe(1);
    // Two passes per page across three pages.
    expect(calls).toHaveLength(6);
    // With no --model, the engine received DEFAULT_MODEL on EVERY call -- the
    // same value recorded in provenance (no undefined/label mismatch).
    expect(calls.map((c) => c.model)).toEqual(Array(6).fill(DEFAULT_MODEL));

    // Whole-issue artifacts + companions land in the issue directory.
    const frWhole = path.join(issueDir, 'issue.fr.txt');
    const enWhole = path.join(issueDir, 'issue.en.txt');
    expect(existsSync(frWhole)).toBe(true);
    expect(existsSync(enWhole)).toBe(true);
    expect(existsSync(`${frWhole}.yml`)).toBe(true);
    expect(existsSync(`${enWhole}.yml`)).toBe(true);

    // Per-page intermediates live under translation/.
    for (const n of [1, 2, 3]) {
      const stem = `p${String(n).padStart(3, '0')}`;
      expect(existsSync(path.join(issueDir, 'translation', `${stem}.fr.txt`))).toBe(true);
      expect(existsSync(path.join(issueDir, 'translation', `${stem}.en.txt`))).toBe(true);
    }

    // English derives from the corrected French (translate saw cleanup's output).
    const enText = await readFile(enWhole, 'utf-8');
    const frText = await readFile(frWhole, 'utf-8');
    expect(enText).toContain('EN(CLEAN(');
    expect(frText).toContain('CLEAN(');
    expect(frText).not.toContain('EN(');
    // Whole-issue text preserves the 3-page (two form-feed) shape.
    expect(enText.split('\f')).toHaveLength(3);
    expect(frText.split('\f')).toHaveLength(3);

    // Provenance on a per-page and the whole-issue English artifact.
    const enYaml = await readFile(`${enWhole}.yml`, 'utf-8');
    expect(enYaml).toContain('engine: "claude-code-cli"');
    expect(enYaml).toContain(`model: "${DEFAULT_MODEL}"`);
    expect(enYaml).toContain(`retrieved: "${FIXED_DATE}"`);
    expect(enYaml).toContain('translation: "machine-assisted"');
    expect(enYaml).toContain('type: "english-translation"');
    expect(enYaml).toContain('rights_status: "public-domain"');
    // Original-language citation carried from the source page provenance.
    expect(enYaml).toContain('title: "Le Journal de Port-Breton, 15 Janvier 1875"');
    expect(enYaml).toContain('catalog_url: "https://gallica.bnf.fr/ark:/12148/bpt6k123456"');

    const frYaml = await readFile(
      path.join(issueDir, 'translation', 'p001.fr.txt.yml'),
      'utf-8',
    );
    expect(frYaml).toContain('type: "corrected-french-text"');
    expect(frYaml).toContain('translation: "machine-assisted"');
  });

  it('honours --model over the DEFAULT_MODEL in provenance AND engine calls', async () => {
    const { ctx, calls } = makeCtx({ model: 'sonnet' });
    const result = await translateIssue(BARE_ARK, ctx);
    expect(result.outcome).toBe('translated');
    // The pinned model reaches the engine on every call...
    expect(calls.map((c) => c.model)).toEqual(Array(6).fill('sonnet'));
    // ...and is the value recorded in provenance (not DEFAULT_MODEL).
    const enYaml = await readFile(
      path.join(issueDir, 'issue.en.txt.yml'),
      'utf-8',
    );
    expect(enYaml).toContain('model: "sonnet"');
  });

  it('a full-skip second run calls neither preflight nor the engine', async () => {
    // First run translates everything and fires preflight once.
    const first = makeCtx();
    const firstResult = await translateIssue(BARE_ARK, first.ctx);
    expect(firstResult.outcome).toBe('translated');
    expect(first.preflightCalls.n).toBe(1);

    // Second run: every intermediate is recorded and force is false, so the
    // whole issue is a skip -- no preflight (contract 1) and no engine call.
    const second = makeCtx();
    const secondResult = await translateIssue(BARE_ARK, second.ctx);

    expect(secondResult.outcome).toBe('skipped');
    expect(secondResult.pagesDone).toBe(3);
    expect(secondResult.pagesTotal).toBe(3);
    expect(second.preflightCalls.n).toBe(0);
    expect(second.calls).toHaveLength(0);
  });
});
