import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { translateIssue } from '@/translate/issue';
import {
  buildFetchedIssue,
  buildCtx,
  FIXED_DATE,
  TEST_MODEL,
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
    // With no --model override, the engine received the ctx's resolved model
    // on EVERY call -- the same value recorded in provenance (no
    // undefined/label mismatch).
    expect(calls.map((c) => c.model)).toEqual(Array(6).fill(TEST_MODEL));

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
    expect(enYaml).toContain(`model: "${TEST_MODEL}"`);
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

  it('honours --model over the ctx default in provenance AND engine calls', async () => {
    const { ctx, calls } = buildCtx(fetched, { model: 'sonnet' });
    const result = await translateIssue(fetched.issueArk, ctx);
    expect(result.outcome).toBe('translated');
    // The pinned model reaches the engine on every call...
    expect(calls.map((c) => c.model)).toEqual(Array(6).fill('sonnet'));
    // ...and is the value recorded in provenance (not the ctx default).
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

  it('records a blank / scan-artifact page as empty and still completes the issue', async () => {
    // Overwrite issue.txt so the third page is an unscannable blank page whose
    // OCR is only a scan-condition marker + shelfmark (a real Gallica artifact,
    // e.g. "Contraste insuffisant"). It has nothing to translate.
    const real1 =
      'Ceci est une vraie page de journal avec suffisamment de contenu textuel a traduire pour depasser le seuil.';
    const real2 =
      'Une deuxieme page reelle contenant assez de mots pour etre traitee normalement par le moteur de traduction.';
    const blank = 'Contraste insuffisant\nNF Z 43-120-14';
    writeFileSync(
      path.join(fetched.issueDir, 'issue.txt'),
      `${real1}\f${real2}\f${blank}`,
    );

    const { ctx, calls } = buildCtx(fetched);
    const result = await translateIssue(fetched.issueArk, ctx);

    // The issue COMPLETES -- a blank page is reported, not a failure.
    expect(result.outcome).toBe('translated');
    expect(result.pagesDone).toBe(3);
    expect(result.pagesTotal).toBe(3);
    // The engine ran for the 2 real pages only (cleanup + translate = 4 calls);
    // the blank page never reaches the engine.
    expect(calls).toHaveLength(4);
    // The blank page's artifacts exist but are empty (reported, not fabricated).
    const blankFr = path.join(fetched.issueDir, 'translation', 'p003.fr.txt');
    const blankEn = path.join(fetched.issueDir, 'translation', 'p003.en.txt');
    expect(existsSync(blankFr)).toBe(true);
    expect(existsSync(blankEn)).toBe(true);
    expect((await readFile(blankFr, 'utf-8')).trim()).toBe('');
    expect((await readFile(blankEn, 'utf-8')).trim()).toBe('');
    // ...and are EXPLICITLY labeled untranslatable, not machine-assisted, so a
    // consumer can tell the intentional empty from a missing/corrupt one.
    const blankEnYaml = await readFile(`${blankEn}.yml`, 'utf-8');
    expect(blankEnYaml).toContain('translation: "untranslatable"');
    // A real page on the same issue stays machine-assisted.
    const realEnYaml = await readFile(
      path.join(fetched.issueDir, 'translation', 'p001.en.txt.yml'),
      'utf-8',
    );
    expect(realEnYaml).toContain('translation: "machine-assisted"');
  });

  it('records an OCR-garbage illustration/plate page as blank (word-content, not raw alnum)', async () => {
    // A map/plate page whose OCR is dense NON-WORD noise: dozens of stray
    // letters (clearing any raw-alnum threshold) but no real words. The engine
    // returns empty for such a page; measuring word-content keeps it from ever
    // reaching the engine (regression guard for PB-P055 page 299).
    const real1 =
      'Ceci est une vraie page de journal avec suffisamment de contenu textuel a traduire pour depasser le seuil.';
    const real2 =
      'Une deuxieme page reelle contenant assez de mots pour etre traitee normalement par le moteur de traduction.';
    const plate = '31 œo<zœ..oz«ä. « LNVL IND l: .Ëm.r. 31 3HAVH % ANV mŒm ŒDO& PŒO& ZOPuŒŒ — —- .-';
    writeFileSync(
      path.join(fetched.issueDir, 'issue.txt'),
      `${real1}\f${real2}\f${plate}`,
    );

    const { ctx, calls } = buildCtx(fetched);
    const result = await translateIssue(fetched.issueArk, ctx);

    expect(result.outcome).toBe('translated');
    expect(result.pagesDone).toBe(3);
    // Only the 2 real pages reach the engine (2 passes each = 4 calls); the
    // garbage plate is recorded blank, never sent (so no empty-output failure).
    expect(calls).toHaveLength(4);
    const plateEn = path.join(fetched.issueDir, 'translation', 'p003.en.txt');
    expect(existsSync(plateEn)).toBe(true);
    expect((await readFile(plateEn, 'utf-8')).trim()).toBe('');
  });

  it('translates when the object-store migration removed local images (f###.yml only, no f###.jpg)', async () => {
    // The migration moves page images to external storage and removes the
    // local .jpg, keeping the f###.yml companions. BOTH the rights gate and the
    // base-provenance path must read the persistent companion, not the image.
    for (const name of readdirSync(fetched.issueDir)) {
      if (/^f\d{3}\.jpg$/.test(name)) {
        rmSync(path.join(fetched.issueDir, name));
      }
    }

    const { ctx, calls } = buildCtx(fetched);
    const result = await translateIssue(fetched.issueArk, ctx);

    expect(result.outcome).toBe('translated');
    expect(result.pagesDone).toBe(3);
    expect(calls.length).toBeGreaterThan(0);
    // Provenance still carries the citation read from the f###.yml companion.
    const enYml = await readFile(
      path.join(fetched.issueDir, 'issue.en.txt.yml'),
      'utf-8',
    );
    expect(enYml).toMatch(/^rights_status: "public-domain"$/m);
  });
});
