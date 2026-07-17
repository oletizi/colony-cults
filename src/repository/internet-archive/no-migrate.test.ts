/**
 * Guard test for INV-F (specs/013-archiveorg-acquisition-path, quickstart.md
 * "Do NOT": "Do not run `bib migrate` -- it rebuilds the SSOT from stale
 * inputs"): the Internet Archive acquire loop must never invoke the
 * migration path itself. `bib migrate` is an operator-run, explicit CLI
 * command (see `src/cli/bib-migrate.ts` or equivalent) -- nothing under
 * `src/repository/internet-archive/` should call into it, whether directly
 * (`runMigrate(...)`, `.migrate(...)`) or by shelling out to the `bib
 * migrate` subcommand string.
 *
 * This test reads every non-test source file under this directory from disk
 * (no import graph walking -- a plain text scan) and asserts none contains a
 * CALL-shaped reference to migrate. A bare mention of the word "migrate" in
 * a comment or doc string is fine and intentionally NOT flagged; only
 * call-shaped patterns are (`runMigrate(`, `.migrate(`, or the literal `bib
 * migrate` command string, which would only appear if this code shelled out
 * to the CLI).
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE_DIR = join(process.cwd(), 'src', 'repository', 'internet-archive');

/** Call-shaped migrate references -- a plain mention of the word "migrate" in prose is fine. */
const MIGRATE_INVOCATION_PATTERNS: readonly RegExp[] = [
  /runMigrate\s*\(/,
  /\.migrate\s*\(/,
  /bib\s+migrate/,
];

/** Every non-test `.ts` source file directly under `src/repository/internet-archive/`. */
function sourceFiles(): string[] {
  return readdirSync(SOURCE_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => join(SOURCE_DIR, name));
}

describe('Internet Archive acquire loop -- never invokes `bib migrate` (INV-F)', () => {
  it('lists at least one source file to guard (sanity: the guard is not vacuous)', () => {
    expect(sourceFiles().length).toBeGreaterThan(0);
  });

  it('contains no call-shaped migrate invocation in any non-test source file', () => {
    const offenders: string[] = [];

    for (const path of sourceFiles()) {
      const text = readFileSync(path, 'utf-8');
      for (const pattern of MIGRATE_INVOCATION_PATTERNS) {
        if (pattern.test(text)) {
          offenders.push(`${path} matches ${pattern}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
