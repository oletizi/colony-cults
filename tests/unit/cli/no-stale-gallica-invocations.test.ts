// tests/unit/cli/no-stale-gallica-invocations.test.ts
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..', '..', '..');

/**
 * The umbrella CLI is `bib`, not `gallica`. Guard tracked docs against stale
 * umbrella-`gallica` invocation strings. This is intentionally narrow: it does
 * NOT match `gallica.bnf.fr`, `gallicaArk`, `src/gallica`, or the word Gallica
 * in prose — those name Gallica itself and are correct.
 */
describe('no stale gallica umbrella invocations in docs', () => {
  it('finds zero `npm run gallica` / `gallica <verb>` invocation strings', () => {
    let hits = '';
    try {
      hits = execFileSync(
        'git',
        [
          'grep', '-nE',
          'npm run gallica|gallica (census|fetch-source|fetch-issue|ocr|restore-images|bib|<command>|<)',
          '--', '*.md',
          // Excluded: dated design/plan records of this very rename, and the
          // original TASK-4 bug report — historical narrative that correctly
          // quotes the pre-rename `gallica` invocation shape in past tense
          // ("were `gallica bib <sub>`"). Rewriting them would falsify the
          // record they exist to preserve.
          ':!docs/superpowers/plans/2026-07-20-rename-cli-bib.md',
          ':!docs/superpowers/specs/2026-07-20-rename-cli-bib-design.md',
          ':!.stack-control/backlog/tasks/task-4 - cli-bin-entry.md',
        ],
        { cwd: repoRoot, encoding: 'utf-8' },
      );
    } catch {
      hits = ''; // git grep exits 1 (non-zero) when there are no matches
    }
    expect(hits.trim()).toBe('');
  });
});
