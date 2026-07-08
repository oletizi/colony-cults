import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { translateIssue, DEFAULT_MODEL } from '@/translate/issue';
import {
  buildFetchedIssue,
  buildCtx,
  FIXED_DATE,
  type FetchedIssue,
} from './support/translate-archive';

/**
 * Integration coverage for the CORE issue-translation orchestrator (T016/T017/
 * T019): `translateIssue` is driven against a temp archive laid out exactly as
 * `findIssueDir` expects for the registered source `PB-P001`, with a FAKE
 * `ClaudeCli` whose deterministic outputs make the two passes distinguishable
 * (`CLEAN(...)` for cleanup, `EN(...)` for translation) so the English can be
 * shown to derive from the corrected French. No real `claude`, no network.
 *
 * The tmp-archive setup, fake engine, and injected clock/preflight are shared
 * with `translate-idempotent.test.ts` (T020) and `translate-guards.test.ts`
 * (T021) via `./support/translate-archive`.
 */
describe('translateIssue (T016/T017/T019)', () => {
  let fetched: FetchedIssue;

  beforeEach(async () => {
    fetched = await buildFetchedIssue();
  });

  afterEach(() => {
    fetched.cleanup();
  });

  it('translates all pages, assembles fr/en artifacts, and stamps provenance', async () => {
    const { ctx, calls, preflightCalls } = buildCtx(fetched);

    const result = await translateIssue(fetched.issueArk, ctx);

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
    const frWhole = path.join(fetched.issueDir, 'issue.fr.txt');
    const enWhole = path.join(fetched.issueDir, 'issue.en.txt');
    expect(existsSync(frWhole)).toBe(true);
    expect(existsSync(enWhole)).toBe(true);
    expect(existsSync(`${frWhole}.yml`)).toBe(true);
    expect(existsSync(`${enWhole}.yml`)).toBe(true);

    // Per-page intermediates live under translation/.
    for (const n of [1, 2, 3]) {
      const stem = `p${String(n).padStart(3, '0')}`;
      expect(existsSync(path.join(fetched.issueDir, 'translation', `${stem}.fr.txt`))).toBe(true);
      expect(existsSync(path.join(fetched.issueDir, 'translation', `${stem}.en.txt`))).toBe(true);
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
      path.join(fetched.issueDir, 'translation', 'p001.fr.txt.yml'),
      'utf-8',
    );
    expect(frYaml).toContain('type: "corrected-french-text"');
    expect(frYaml).toContain('translation: "machine-assisted"');
  });

  it('honours --model over the DEFAULT_MODEL in provenance AND engine calls', async () => {
    const { ctx, calls } = buildCtx(fetched, { model: 'sonnet' });
    const result = await translateIssue(fetched.issueArk, ctx);
    expect(result.outcome).toBe('translated');
    // The pinned model reaches the engine on every call...
    expect(calls.map((c) => c.model)).toEqual(Array(6).fill('sonnet'));
    // ...and is the value recorded in provenance (not DEFAULT_MODEL).
    const enYaml = await readFile(
      path.join(fetched.issueDir, 'issue.en.txt.yml'),
      'utf-8',
    );
    expect(enYaml).toContain('model: "sonnet"');
  });

  it('a full-skip second run calls neither preflight nor the engine', async () => {
    // First run translates everything and fires preflight once.
    const first = buildCtx(fetched);
    const firstResult = await translateIssue(fetched.issueArk, first.ctx);
    expect(firstResult.outcome).toBe('translated');
    expect(first.preflightCalls.n).toBe(1);

    // Second run: every intermediate is recorded and force is false, so the
    // whole issue is a skip -- no preflight (contract 1) and no engine call.
    const second = buildCtx(fetched);
    const secondResult = await translateIssue(fetched.issueArk, second.ctx);

    expect(secondResult.outcome).toBe('skipped');
    expect(secondResult.pagesDone).toBe(3);
    expect(secondResult.pagesTotal).toBe(3);
    expect(second.preflightCalls.n).toBe(0);
    expect(second.calls).toHaveLength(0);
  });
});
