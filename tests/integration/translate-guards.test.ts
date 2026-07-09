import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { translateIssue } from '@/translate/issue';
import { pageArtifactPath } from '@/translate/artifacts';
import {
  buildFetchedIssue,
  buildCtx,
  fakeClaude,
  throwingPreflight,
  type EngineCall,
  type FetchedIssue,
} from './support/translate-archive';

/**
 * Guard-path coverage for `translateIssue` (T021): the rights gate (FR-008),
 * the engine preflight (FR-009), and a mid-run engine failure (FR-013) each
 * refuse/throw/fail WITHOUT leaving any partial or fabricated artifact on
 * disk. Shares the tmp-archive builder and fake engine with
 * `translate-issue.test.ts` (T019) via `./support/translate-archive`.
 */
describe('translateIssue guards (T021)', () => {
  let fetched: FetchedIssue;

  afterEach(() => {
    fetched?.cleanup();
  });

  /** Assert none of the whole-issue or per-page translation artifacts exist. */
  function expectNothingWritten(issueDir: string): void {
    expect(existsSync(path.join(issueDir, 'issue.fr.txt'))).toBe(false);
    expect(existsSync(path.join(issueDir, 'issue.en.txt'))).toBe(false);
    expect(existsSync(path.join(issueDir, 'issue.fr.txt.yml'))).toBe(false);
    expect(existsSync(path.join(issueDir, 'issue.en.txt.yml'))).toBe(false);
    expect(existsSync(path.join(issueDir, 'translation'))).toBe(false);
  }

  it('refuses a non-public-domain issue and writes nothing (FR-008)', async () => {
    fetched = await buildFetchedIssue({ rightsStatus: 'in-copyright' });
    const { ctx, calls, preflightCalls } = buildCtx(fetched);

    const result = await translateIssue(fetched.issueArk, ctx);

    expect(result.outcome).toBe('refused');
    expect(result.pagesDone).toBe(0);
    expect(result.pagesTotal).toBe(0);
    expect(result.message).toContain('in-copyright');
    expect(result.message).toContain('public-domain');

    // The rights gate short-circuits before preflight/engine and before any write.
    expect(preflightCalls.n).toBe(0);
    expect(calls).toHaveLength(0);
    expectNothingWritten(fetched.issueDir);
  });

  it('propagates a preflight failure (claude absent) and writes nothing (FR-009)', async () => {
    fetched = await buildFetchedIssue();
    const { ctx, calls } = buildCtx(fetched, {
      preflight: throwingPreflight('claude: command not found'),
    });

    await expect(translateIssue(fetched.issueArk, ctx)).rejects.toThrow(
      'claude: command not found',
    );

    // The throw happens before any engine call, and nothing was written.
    expect(calls).toHaveLength(0);
    expectNothingWritten(fetched.issueDir);
  });

  it('a claude engine failure returns a non-translated outcome and leaves no partial page artifact (FR-013)', async () => {
    fetched = await buildFetchedIssue();
    const calls: EngineCall[] = [];
    const engine = fakeClaude(calls, { failWith: new Error('engine exploded') });
    const { ctx } = buildCtx(fetched, { engine });

    const result = await translateIssue(fetched.issueArk, ctx);

    expect(['failed', 'incomplete']).toContain(result.outcome);
    expect(result.message).toContain('engine exploded');
    // The very first page's cleanup call fails, so no page ever completes.
    expect(result.pagesDone).toBe(0);
    expect(calls).toHaveLength(0);

    // The failed page (page 1) has neither a fr nor an en intermediate --
    // both passes must succeed before either is persisted (FR-013).
    const page1Fr = pageArtifactPath(fetched.issueDir, 1, 'fr');
    const page1En = pageArtifactPath(fetched.issueDir, 1, 'en');
    expect(existsSync(page1Fr)).toBe(false);
    expect(existsSync(page1En)).toBe(false);
    expect(existsSync(`${page1Fr}.yml`)).toBe(false);
    expect(existsSync(`${page1En}.yml`)).toBe(false);

    // No completed pages means no whole-issue assembly either.
    expect(existsSync(path.join(fetched.issueDir, 'issue.fr.txt'))).toBe(false);
    expect(existsSync(path.join(fetched.issueDir, 'issue.en.txt'))).toBe(false);
  });

  it('a claude failure on a later page leaves earlier pages persisted and marks the run incomplete (FR-013)', async () => {
    fetched = await buildFetchedIssue();
    const calls: EngineCall[] = [];
    // Fail only the cleanup pass, and only for page 2's raw text (the raw
    // fixture text for page 2 starts with "POLITIQUE RÉGIONALE").
    const engine = fakeClaude(calls, {
      failWith: new Error('engine exploded on page 2'),
      failOn: 'clean',
      failWhen: (sourceText) => sourceText.includes('POLITIQUE RÉGIONALE'),
    });
    const { ctx } = buildCtx(fetched, { engine });

    const result = await translateIssue(fetched.issueArk, ctx);

    expect(result.outcome).toBe('incomplete');
    expect(result.pagesDone).toBe(1);
    expect(result.message).toContain('engine exploded on page 2');

    // Page 1 completed and was persisted.
    const page1Fr = pageArtifactPath(fetched.issueDir, 1, 'fr');
    const page1En = pageArtifactPath(fetched.issueDir, 1, 'en');
    expect(existsSync(page1Fr)).toBe(true);
    expect(existsSync(page1En)).toBe(true);

    // Page 2 (the failed page) has neither intermediate.
    const page2Fr = pageArtifactPath(fetched.issueDir, 2, 'fr');
    const page2En = pageArtifactPath(fetched.issueDir, 2, 'en');
    expect(existsSync(page2Fr)).toBe(false);
    expect(existsSync(page2En)).toBe(false);

    // Page 3 was never attempted (the loop breaks on the first failure).
    const page3Fr = pageArtifactPath(fetched.issueDir, 3, 'fr');
    const page3En = pageArtifactPath(fetched.issueDir, 3, 'en');
    expect(existsSync(page3Fr)).toBe(false);
    expect(existsSync(page3En)).toBe(false);
  });
});
