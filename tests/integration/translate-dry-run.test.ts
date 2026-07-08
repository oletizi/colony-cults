import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { translateIssue } from '@/translate/issue';
import { translateSource } from '@/translate/source';
import {
  buildFetchedIssue,
  buildFetchedSource,
  buildCtx,
  buildSourceCtx,
  type FetchedIssue,
  type FetchedSource,
} from './support/translate-archive';

/**
 * Integration coverage for T029 (US3, FR-010/FR-009/SC-007): `--dry-run`
 * classifies intended per-issue work (would-translate / would-skip /
 * would-refuse) plus each issue's rights status, WITHOUT ever calling
 * `ctx.preflight()`, WITHOUT any `ClaudeCli` call, and WITHOUT writing a
 * single byte to the archive -- proven here by a recursive path->sha256
 * snapshot of the archive directory tree taken immediately before and after
 * the dry-run call.
 */

/**
 * Recursive path (relative to `root`) -> sha256 content digest of every FILE
 * under `root`, sorted by path. Two snapshots being deep-equal proves the
 * archive is byte-identical (same files, same bytes, none added/removed) --
 * the strongest available proof that a run wrote nothing (FR-010/SC-007).
 */
function snapshotTree(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const digest = createHash('sha256').update(readFileSync(full)).digest('hex');
      snapshot[path.relative(root, full)] = digest;
    }
  };
  walk(root);
  return snapshot;
}

describe('translate --dry-run (T029, FR-010/FR-009/SC-007)', () => {
  describe('translateIssue', () => {
    let issue: FetchedIssue;

    afterEach(() => {
      issue.cleanup();
    });

    it('a public-domain, untranslated issue: would-translate, zero preflight/engine calls, zero writes', async () => {
      issue = await buildFetchedIssue();
      const before = snapshotTree(issue.archiveRoot);

      const { ctx, calls, preflightCalls } = buildCtx(issue, { dryRun: true });

      const result = await translateIssue(issue.issueArk, ctx);

      expect(result.outcome).toBe('translated');
      expect(result.pagesTotal).toBeGreaterThan(0);
      expect(result.pagesDone).toBe(0);
      expect(result.message).toMatch(/public-domain/);

      // Never preflighted, never called the engine (FR-009).
      expect(preflightCalls.n).toBe(0);
      expect(calls).toHaveLength(0);

      // Byte-identical archive: no issue.fr.txt/issue.en.txt, no translation/.
      const after = snapshotTree(issue.archiveRoot);
      expect(after).toEqual(before);
    });

    it('a non-public-domain issue: would-refuse, zero writes, does not throw', async () => {
      issue = await buildFetchedIssue({ rightsStatus: 'in-copyright' });
      const before = snapshotTree(issue.archiveRoot);

      const { ctx, calls, preflightCalls } = buildCtx(issue, { dryRun: true });

      const result = await translateIssue(issue.issueArk, ctx);

      expect(result.outcome).toBe('refused');
      expect(result.pagesDone).toBe(0);
      expect(result.pagesTotal).toBeGreaterThan(0);
      expect(result.message).toMatch(/in-copyright/);

      expect(preflightCalls.n).toBe(0);
      expect(calls).toHaveLength(0);

      const after = snapshotTree(issue.archiveRoot);
      expect(after).toEqual(before);
    });
  });

  describe('translateSource', () => {
    let source: FetchedSource;

    afterEach(() => {
      source.cleanup();
    });

    it('mixed source: per-issue would-translate/would-skip/would-refuse, zero writes from the dry-run itself, no abort', async () => {
      // 3 issues: [0] will be REALLY translated first (so dry-run sees it as
      // already-done -> would-skip); [1] stays untouched -> would-translate;
      // [2] is non-public-domain -> would-refuse.
      source = await buildFetchedSource({
        count: 3,
        rights: [undefined, undefined, 'in-copyright'],
      });

      // Real pre-translation of issue 0 only, via translateIssue directly (not
      // translateSource) so issues 1/2 are left untouched.
      const { ctx: realCtx } = buildCtx(source);
      const preResult = await translateIssue(source.issueArks[0], realCtx);
      expect(preResult.outcome).toBe('translated');

      // Baseline snapshot AFTER the real pre-translation, BEFORE the dry-run.
      const before = snapshotTree(source.archiveRoot);

      const { ctx, calls, preflightCalls, delayCalls } = buildSourceCtx(source, {
        dryRun: true,
      });

      const report = await translateSource(source.sourceId, ctx);

      expect(report.issues).toHaveLength(3);
      expect(report.issues[0].ark).toBe(source.issueArks[0]);
      expect(report.issues[0].outcome).toBe('skipped');
      expect(report.issues[1].ark).toBe(source.issueArks[1]);
      expect(report.issues[1].outcome).toBe('translated');
      expect(report.issues[2].ark).toBe(source.issueArks[2]);
      expect(report.issues[2].outcome).toBe('refused');
      expect(report.abortedOnConsecutiveFailures).toBe(false);

      // Zero engine/preflight/pacing calls from the dry-run itself.
      expect(preflightCalls.n).toBe(0);
      expect(calls).toHaveLength(0);
      expect(delayCalls.n).toBe(0);

      // The dry-run wrote nothing on top of the pre-existing baseline.
      const after = snapshotTree(source.archiveRoot);
      expect(after).toEqual(before);
    });
  });
});
