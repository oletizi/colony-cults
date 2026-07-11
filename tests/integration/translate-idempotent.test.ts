import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { translateIssue } from '@/translate/issue';
import { pageArtifactPath } from '@/translate/artifacts';
import { buildFetchedIssue, buildCtx, type FetchedIssue } from './support/translate-archive';

/**
 * Idempotency/resumability coverage for `translateIssue` (T020, FR-011/
 * FR-012, SC-008): a second run over an already-translated issue is a full
 * skip; deleting one page's intermediates causes ONLY that page to be
 * reprocessed on resume, leaving every other page's artifacts byte-for-byte
 * untouched; `force: true` always regenerates every page regardless of what
 * is already recorded. Shares the tmp-archive builder and fake engine with
 * `translate-issue.test.ts` (T019) via `./support/translate-archive`.
 */
describe('translateIssue idempotency (T020)', () => {
  let fetched: FetchedIssue;

  afterEach(() => {
    fetched?.cleanup();
  });

  it('a second run over an already-translated issue is a full skip with zero engine calls (FR-011)', async () => {
    fetched = await buildFetchedIssue();

    const first = buildCtx(fetched);
    const firstResult = await translateIssue(fetched.issueArk, first.ctx);
    expect(firstResult.outcome).toBe('translated');

    // A FRESH claude spy for the second run: any call at all is a failure.
    const second = buildCtx(fetched);
    const secondResult = await translateIssue(fetched.issueArk, second.ctx);

    expect(secondResult.outcome).toBe('skipped');
    expect(secondResult.pagesDone).toBe(3);
    expect(secondResult.pagesTotal).toBe(3);
    expect(second.preflightCalls.n).toBe(0);
    expect(second.calls).toHaveLength(0);
  });

  it('deleting one page\'s intermediates causes ONLY that page to be reprocessed on resume (FR-012/SC-008)', async () => {
    fetched = await buildFetchedIssue();

    const first = buildCtx(fetched);
    const firstResult = await translateIssue(fetched.issueArk, first.ctx);
    expect(firstResult.outcome).toBe('translated');

    // Snapshot pages 1 and 3's intermediates before the resume run, to prove
    // they are left byte-for-byte untouched (not merely "still exist").
    const page1Fr = pageArtifactPath(fetched.issueDir, 1, 'fr');
    const page1En = pageArtifactPath(fetched.issueDir, 1, 'en');
    const page3Fr = pageArtifactPath(fetched.issueDir, 3, 'fr');
    const page3En = pageArtifactPath(fetched.issueDir, 3, 'en');
    const page1FrBefore = await readFile(page1Fr, 'utf-8');
    const page1EnBefore = await readFile(page1En, 'utf-8');
    const page3FrBefore = await readFile(page3Fr, 'utf-8');
    const page3EnBefore = await readFile(page3En, 'utf-8');

    // Delete page 2's fr+en intermediates AND their companion YAMLs, so
    // `isAssetRecorded` sees page 2 as not-yet-translated.
    const page2Fr = pageArtifactPath(fetched.issueDir, 2, 'fr');
    const page2En = pageArtifactPath(fetched.issueDir, 2, 'en');
    rmSync(page2Fr);
    rmSync(`${page2Fr}.yml`);
    rmSync(page2En);
    rmSync(`${page2En}.yml`);

    const second = buildCtx(fetched);
    const secondResult = await translateIssue(fetched.issueArk, second.ctx);

    expect(secondResult.outcome).toBe('translated');
    expect(secondResult.pagesDone).toBe(3);
    expect(secondResult.pagesTotal).toBe(3);

    // Exactly one page's worth of work: one cleanup call, one translate call.
    expect(second.calls).toHaveLength(2);
    expect(second.calls.map((c) => c.pass)).toEqual(['clean', 'en']);

    // Pages 1 and 3 are untouched byte-for-byte -- they were never re-sent to
    // the engine.
    expect(await readFile(page1Fr, 'utf-8')).toBe(page1FrBefore);
    expect(await readFile(page1En, 'utf-8')).toBe(page1EnBefore);
    expect(await readFile(page3Fr, 'utf-8')).toBe(page3FrBefore);
    expect(await readFile(page3En, 'utf-8')).toBe(page3EnBefore);

    // Page 2 was regenerated.
    expect(existsSync(page2Fr)).toBe(true);
    expect(existsSync(page2En)).toBe(true);
    const page2FrText = await readFile(page2Fr, 'utf-8');
    const page2EnText = await readFile(page2En, 'utf-8');
    expect(page2FrText).toContain('CLEAN(');
    expect(page2EnText).toContain('EN(CLEAN(');
  });

  it('force:true regenerates every page even when all intermediates are already recorded (FR-011)', async () => {
    fetched = await buildFetchedIssue();

    const first = buildCtx(fetched);
    const firstResult = await translateIssue(fetched.issueArk, first.ctx);
    expect(firstResult.outcome).toBe('translated');

    const second = buildCtx(fetched, { force: true });
    const secondResult = await translateIssue(fetched.issueArk, second.ctx);

    expect(secondResult.outcome).toBe('translated');
    expect(secondResult.pagesDone).toBe(3);
    expect(secondResult.pagesTotal).toBe(3);
    // Preflight fires (force means "needs work" for every page).
    expect(second.preflightCalls.n).toBe(1);
    // Two passes (clean + en) for EVERY page, not just the ones that changed.
    expect(second.calls).toHaveLength(6);
    expect(second.calls.map((c) => c.pass).filter((p) => p === 'clean')).toHaveLength(3);
    expect(second.calls.map((c) => c.pass).filter((p) => p === 'en')).toHaveLength(3);
  });
});
