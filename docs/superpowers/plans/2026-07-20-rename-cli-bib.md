# Rename CLI `gallica` → `bib` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the umbrella CLI from `gallica` to `bib` and flatten its command tree so the code matches the already-written docs, shipping a genuinely runnable bin (closing TASK-4).

**Architecture:** Extract the top-level routing out of `src/index.ts` into a testable `runCli(argv)` in `src/cli/dispatch.ts` that flat-routes every verb: bibliography SSOT subactions (`query-source`, `acquire`, …) go to the existing `runBibliography`, and Gallica mirroring verbs (`census`, `fetch-source`, …) go to the existing `parse` + `HANDLERS` path. `src/index.ts` becomes a thin shebang wrapper. An esbuild bundle turns both TS entry points into runnable `dist/*.js` bins with no runtime `tsx` dependency.

**Tech Stack:** TypeScript (ESM, `@/` path alias, `moduleResolution: Bundler`), tsx (dev run), vitest, esbuild (new devDep, for the runnable bin).

## Global Constraints

- Use the `@/` import pattern for all TypeScript imports (verbatim).
- No `any`, no `as Type`, no `@ts-ignore` — never bypass typing.
- No fallbacks / mock data outside tests — throw fail-loud errors instead.
- Files stay 300–500 lines max; keep new files focused.
- Commit each task the moment it is green; never bypass hooks (there are none).
- `gallica` is renamed ONLY as the umbrella identity. Leave every Gallica-accurate name untouched: `src/gallica/**`, the Gallica `SourceConfig`, `gallicaArk` model fields, `gallica.bnf.fr` URLs, OAI `setSpec` fixtures, and the fact that `bib census`/`bib fetch-source` operate on Gallica periodicals.

---

### Task 1: Flatten dispatch into a testable `runCli`

**Files:**
- Create: `src/cli/dispatch.ts`
- Modify: `src/cli/bibliography.ts` (export the subaction predicate)
- Modify: `src/index.ts` (become a thin wrapper)
- Test: `tests/unit/cli/dispatch.test.ts`

**Interfaces:**
- Consumes: `runBibliography(argv: string[]): Promise<number>` (`@/cli/bibliography`); `parse(argv: string[]): ParsedArgs` and `type Command` (`@/cli/parse`); `describeError(error: unknown): string` (`@/bibliography/load-primitives`); the existing `HANDLERS` map (moved into dispatch.ts).
- Produces: `runCli(argv: string[]): Promise<number>` and `HELP_TEXT: string` from `@/cli/dispatch`; `isBibSubaction(value: string): boolean` from `@/cli/bibliography`.

- [ ] **Step 1: Export the subaction predicate from bibliography.ts**

In `src/cli/bibliography.ts`, change the existing private `isSubaction` (around line 38) to an exported predicate and keep the type guard. Add above it nothing else; just export:

```typescript
// was: function isSubaction(value: string): value is Subaction {
export function isBibSubaction(value: string): value is Subaction {
  return (SUBACTIONS as readonly string[]).includes(value);
}
```

Then update the one internal caller in `runBibliography` (around line 471) from `!isSubaction(subaction)` to `!isBibSubaction(subaction)`.

- [ ] **Step 2: Write the failing dispatch test**

```typescript
// tests/unit/cli/dispatch.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '@/cli/dispatch';

describe('runCli flat dispatch', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('prints bib help (not gallica) on --help and on no args', async () => {
    expect(await runCli(['--help'])).toBe(0);
    const help = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(help).toContain('bib');
    expect(help).toContain('query-source');
    expect(help).toContain('census');
    expect(help).not.toContain('gallica <command>');
    logSpy.mockClear();
    expect(await runCli([])).toBe(0);
    expect(logSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('bib');
  });

  it('routes a bibliography SSOT verb to runBibliography (usage error, no side effects)', async () => {
    // `query-source` with no source-id is a deterministic usage error (exit 2),
    // parsed before any browser is constructed — proves it hit the bib path.
    const code = await runCli(['query-source']);
    expect(code).toBe(2);
    expect(errorSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('source-id');
  });

  it('routes a Gallica mirroring verb to the parse+HANDLERS path', async () => {
    // `census` with no periodicalArk throws in parse -> caught -> exit 1.
    const code = await runCli(['census']);
    expect(code).toBe(1);
    expect(errorSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('census');
  });

  it('fails loud (exit 2) on an unknown verb', async () => {
    const code = await runCli(['no-such-verb']);
    expect(code).toBe(2);
    expect(errorSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('no-such-verb');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/cli/dispatch.test.ts`
Expected: FAIL — cannot resolve `@/cli/dispatch` (module does not exist yet).

- [ ] **Step 4: Create `src/cli/dispatch.ts`**

Move `HANDLERS`, `HELP_TEXT`, `readPackageVersion`, `wantsHelp`, `wantsVersion` out of `src/index.ts` into this new module, rewrite the help text for `bib`, and add flat routing. Full file:

```typescript
import { readFileSync } from 'node:fs';
import { parse } from '@/cli/parse';
import type { Command, ParsedArgs } from '@/cli/parse';
import { runBibliography, isBibSubaction } from '@/cli/bibliography';
import { runCensus } from '@/cli/census';
import { runFetchIssue, runFetchSource } from '@/cli/fetch';
import { runOcr } from '@/cli/ocr';
import { runRestoreImages } from '@/cli/restore-images';
import { describeError } from '@/bibliography/load-primitives';

/** A command handler: given the parsed invocation, performs the command. */
type Handler = (args: ParsedArgs) => Promise<void>;

// Partial: the shared `Command` union also carries `translate` /
// `translate-source`, which belong to the separate `translate` bin
// (src/translate-index.ts). This bin does not wire them and reports a
// helpful pointer instead.
const HANDLERS: Partial<Record<Command, Handler>> = {
  census: (args) => runCensus(args),
  'fetch-issue': (args) => runFetchIssue(args),
  'fetch-source': (args) => runFetchSource(args),
  ocr: (args) => runOcr(args),
  'restore-images': (args) => runRestoreImages(args),
};

/** Read this package's version from package.json (no hardcoded duplicate). */
export function readPackageVersion(): string {
  const url = new URL('../package.json', import.meta.url);
  const raw = readFileSync(url, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'version' in parsed &&
    typeof parsed.version === 'string' &&
    parsed.version.length > 0
  ) {
    return parsed.version;
  }
  throw new Error(`bib: could not read a valid "version" from ${url.pathname}`);
}

export const HELP_TEXT = `bib - Corpus bibliography SSOT + acquisition CLI

Usage:
  bib <command> [args] [options]

Bibliography / acquisition:
  query-source <source-id> --query <text>   Governed source query (persist-first)
  acquire <id>                              Acquire a source into the held corpus
  coverage                                  Corpus coverage report
  discover                                  Discovery over configured sources
  migrate | show | validate | regenerate    Bibliography SSOT verbs
  inventory | verify-member | promote | exclude-member | reconcile | rights-assess

Gallica mirroring:
  census <periodicalArk>        Build/refresh a Gallica per-source census
  fetch-issue <issueArk>        Fetch one issue's page images (private archive)
  fetch-source <periodicalArk>  Fetch a Gallica source's census (or --pages range)
  ocr <issueArk>                OCR already-fetched images for an issue
  restore-images <issueArk>     Pull page images from the public B2 cache

Options:
  --help, -h             Show this help message
  --version, -v          Show version
  --dry-run              Report intended actions; write nothing
  --force                Re-fetch/regenerate assets that already exist
  --verify               Re-hash existing assets against recorded checksums
  --ocr                  Opt into OCR during a fetch
  --archive-root <path>  Override the private-archive root (else COLONY_ARCHIVE_ROOT)
  --object-store         Opt into the object-store (B2) backend for masters
`;

function wantsHelp(argv: string[]): boolean {
  return argv.length === 0 || argv.includes('--help') || argv.includes('-h');
}

function wantsVersion(argv: string[]): boolean {
  return argv.includes('--version') || argv.includes('-v');
}

/**
 * Flat top-level dispatch for the `bib` CLI. Every verb is a sibling:
 * bibliography SSOT subactions route to `runBibliography`; the Gallica
 * mirroring verbs route to the `parse` + `HANDLERS` path. Returns a process
 * exit code and never throws, so `src/index.ts` stays a thin wrapper.
 */
export async function runCli(argv: string[]): Promise<number> {
  if (wantsHelp(argv)) {
    console.log(HELP_TEXT);
    return 0;
  }
  if (wantsVersion(argv)) {
    console.log(readPackageVersion());
    return 0;
  }

  const verb = argv[0];
  if (verb !== undefined && isBibSubaction(verb)) {
    return runBibliography(argv);
  }

  try {
    const parsed = parse(argv);
    const handler = HANDLERS[parsed.command];
    if (handler === undefined) {
      console.error(
        `bib: "${parsed.command}" is handled by the separate "translate" bin, not here`,
      );
      return 2;
    }
    await handler(parsed);
    return 0;
  } catch (error) {
    console.error(`bib: ${describeError(error)}`);
    return 2;
  }
}
```

Note: the catch returns `2` (usage/parse errors dominate this path — unknown verb, missing positional). This is a deliberate, documented change from the old blanket exit `1`; the dispatch test asserts it.

- [ ] **Step 5: Rewrite `src/index.ts` as a thin wrapper**

Replace the entire file with:

```typescript
#!/usr/bin/env node
import { runCli } from '@/cli/dispatch';

runCli(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`bib: ${message}`);
    process.exitCode = 1;
  });
```

- [ ] **Step 6: Run the dispatch test — verify it passes**

Run: `npx vitest run tests/unit/cli/dispatch.test.ts`
Expected: PASS (4 tests). If an assertion's substring differs from the real error text, adjust the assertion to the actual stable substring (e.g. the exact "source-id"/"census" wording) — do not weaken the routing check.

- [ ] **Step 7: Run the full suite — catch collateral breakage**

Run: `npx vitest run && npm run typecheck`
Expected: PASS. If any test spawned `src/index.ts` and asserted the old `gallica:` prefix or gallica help, update it to `bib`. (Survey at plan time found none, but confirm.)

- [ ] **Step 8: Commit**

```bash
git add src/cli/dispatch.ts src/index.ts src/cli/bibliography.ts tests/unit/cli/dispatch.test.ts
git commit -F - <<'MSG'
refactor(cli): flatten dispatch into runCli, rename umbrella to bib

Extract top-level routing into a testable src/cli/dispatch.ts. Every verb is a
flat sibling of `bib`: SSOT subactions -> runBibliography, Gallica mirroring
verbs -> parse+HANDLERS. src/index.ts is now a thin shebang wrapper. Help and
error text say `bib`. `gallica` survives only where it names Gallica itself.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DqHyEAFVEYKKHNikEnban6
MSG
```

---

### Task 2: Runnable bin via esbuild + package rename

**Files:**
- Modify: `package.json` (name, bin, scripts, devDependency)
- Modify: `.gitignore` (ignore `dist/`)
- Test: `tests/integration/built-bin.test.ts`

**Interfaces:**
- Consumes: `runCli` via the built `dist/index.js`.
- Produces: runnable bins `dist/index.js` (`bib`) and `dist/translate-index.js` (`translate`), built by `npm run build`.

- [ ] **Step 1: Add esbuild**

Run: `npm install --save-dev esbuild`
Expected: `esbuild` appears under `devDependencies`.

- [ ] **Step 2: Write the failing built-bin test**

```typescript
// tests/integration/built-bin.test.ts
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..', '..');
const distIndex = path.join(repoRoot, 'dist', 'index.js');

describe('built bib bin runs under plain node (no tsx)', () => {
  beforeAll(() => {
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'pipe' });
  }, 120_000);

  it('emits dist/index.js with a node shebang', () => {
    expect(existsSync(distIndex)).toBe(true);
    const first = execFileSync('head', ['-1', distIndex], { encoding: 'utf-8' });
    expect(first.trim()).toBe('#!/usr/bin/env node');
  });

  it('runs `node dist/index.js --help` and prints bib help', () => {
    const out = execFileSync('node', [distIndex, '--help'], { encoding: 'utf-8' });
    expect(out).toContain('bib');
    expect(out).toContain('query-source');
  });

  it('runs `node dist/index.js --version` and prints a version', () => {
    const out = execFileSync('node', [distIndex, '--version'], { encoding: 'utf-8' });
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/integration/built-bin.test.ts`
Expected: FAIL — `npm run build` script does not exist yet (or `dist/index.js` missing).

- [ ] **Step 4: Edit `package.json` — name, bin, scripts, prepare**

Apply these changes (leave every other field untouched):

```json
{
  "name": "bib",
  "bin": {
    "bib": "dist/index.js",
    "translate": "dist/translate-index.js"
  },
  "scripts": {
    "build": "esbuild src/index.ts src/translate-index.ts --bundle --platform=node --format=esm --packages=external --outdir=dist --banner:js='#!/usr/bin/env node'",
    "prepare": "npm run build",
    "bib": "tsx src/index.ts",
    "translate": "tsx src/translate-index.ts"
  }
}
```

Notes: `--packages=external` keeps `node_modules` deps (Playwright, AWS SDK…) as runtime imports satisfied by the package's runtime `dependencies` — only first-party `src/**` is bundled with `@/` aliases resolved. The old `"gallica": "tsx src/index.ts"` script is renamed to `"bib"`. Keep `translate` script as-is.

- [ ] **Step 5: Ignore the build output**

Add to `.gitignore` (if not already present):

```
dist/
```

- [ ] **Step 6: Run the built-bin test — verify it passes**

Run: `npx vitest run tests/integration/built-bin.test.ts`
Expected: PASS (3 tests). `node dist/index.js` runs with no `tsx` on the path — the TASK-4 fix.

- [ ] **Step 7: Sanity-run the built bin by hand**

Run: `node dist/index.js --version && node dist/index.js query-source 2>&1 | head -2`
Expected: prints the version, then the `bib query-source` usage error (`--source-id`/`source-id` required) — proving a real verb routes through the compiled bin.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .gitignore tests/integration/built-bin.test.ts
git commit -F - <<'MSG'
build(cli): runnable bib/translate bins via esbuild bundle (closes TASK-4)

Bundle both TS entry points to dist/*.js (ESM, node_modules external, shebang
banner) so a linked/installed bin runs under plain node with no tsx. Rename
package gallica-fetcher -> bib; bin gallica -> bib. `prepare` builds on install.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DqHyEAFVEYKKHNikEnban6
MSG
```

---

### Task 3: Docs / scripts sweep + TASK-4 rescope

**Files:**
- Modify: `README.md` and any quickstart/doc with a stale `gallica <verb>` / `npm run gallica` invocation
- Modify: `.stack-control/backlog/tasks/task-4 - cli-bin-entry.md` (mark resolved)
- Test: `tests/unit/cli/no-stale-gallica-invocations.test.ts` (guard)

**Interfaces:**
- Consumes: nothing new.
- Produces: a committed guard test asserting no stale umbrella-`gallica` invocations remain in tracked docs.

- [ ] **Step 1: Enumerate the stale invocations**

Run: `grep -rn "npm run gallica\|gallica census\|gallica fetch-source\|gallica fetch-issue\|gallica ocr\|gallica restore-images\|gallica bib\|gallica <command>\|gallica <" --include="*.md" . | grep -v node_modules`
Expected: ~35 hits, chiefly in `README.md` and a few `specs/*/quickstart.md`. These are the invocation strings to rewrite (NOT `gallica.bnf.fr`, `gallicaArk`, `src/gallica`, or "Gallica" prose — those stay).

- [ ] **Step 2: Write the failing guard test**

```typescript
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
        ],
        { cwd: repoRoot, encoding: 'utf-8' },
      );
    } catch {
      hits = ''; // git grep exits 1 (non-zero) when there are no matches
    }
    expect(hits.trim()).toBe('');
  });
});
```

- [ ] **Step 3: Run the guard test — verify it fails**

Run: `npx vitest run tests/unit/cli/no-stale-gallica-invocations.test.ts`
Expected: FAIL — lists the ~35 stale invocation lines.

- [ ] **Step 4: Rewrite each stale invocation**

For every hit from Step 1/3, replace the umbrella command with `bib`:
- `npm run gallica -- <verb> …` → `npm run bib -- <verb> …`
- `gallica census <ark>` → `bib census <ark>`
- `gallica fetch-source …` → `bib fetch-source …` (and `fetch-issue`, `ocr`, `restore-images` likewise)
- `gallica bib <sub> …` → `bib <sub> …` (drop the old double-nesting)
- Any `gallica <command> <ark>` usage header → `bib <command> [args]`

Use the Edit tool per file (do not use `sed`). Leave `gallica.bnf.fr`, `gallicaArk`, `src/gallica`, and "Gallica" prose exactly as-is.

- [ ] **Step 5: Run the guard test — verify it passes**

Run: `npx vitest run tests/unit/cli/no-stale-gallica-invocations.test.ts`
Expected: PASS.

- [ ] **Step 6: Rescope TASK-4**

Edit `.stack-control/backlog/tasks/task-4 - cli-bin-entry.md`: set `status: Done` and append to the Description a resolution note:

```
Resolved by feature/rename-cli-bib (2026-07-20): bin renamed gallica -> bib and
now points at an esbuild bundle (dist/index.js) with a node shebang, so a
linked/installed bin runs under plain node with no tsx. `prepare` builds on
install. Verified by tests/integration/built-bin.test.ts.
```

- [ ] **Step 7: Full suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: PASS across the whole suite.

- [ ] **Step 8: Commit**

```bash
git add README.md specs docs tests/unit/cli/no-stale-gallica-invocations.test.ts ".stack-control/backlog/tasks/task-4 - cli-bin-entry.md"
git commit -F - <<'MSG'
docs(cli): rewrite stale `gallica <verb>` invocations to `bib`; close TASK-4

Sweep tracked docs so every umbrella invocation reads `bib <verb>` (Gallica-
accurate names untouched). Add a guard test against regressions. Mark TASK-4
(cli-bin-entry) resolved.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DqHyEAFVEYKKHNikEnban6
MSG
```

---

## Self-Review

**Spec coverage** (design §1–5):
- §1 Bin + package → Task 2 (name, bin, both entries).
- §2 Flatten → Task 1 (`runCli` flat routing, help lists both verb groups).
- §3 Runnable bin / TASK-4 → Task 2 (esbuild, prepare, node-run test) + Task 3 Step 6 (rescope).
- §4 Docs/skills → Task 3 (sweep + guard). The 473 `bib <verb>` docs and the fetching-online-sources skill / CLAUDE.md need no change (already `bib`).
- §5 Tests → each task is TDD; Task 1 Step 7 covers collateral breakage.

**Placeholder scan:** none — every code/step shows real content.

**Type consistency:** `runCli(argv: string[]): Promise<number>`, `isBibSubaction(value: string): value is Subaction`, `HELP_TEXT: string`, `readPackageVersion(): string` are named identically wherever referenced. `HANDLERS`/`parse`/`Command` reused from existing modules unchanged.

**Known deliberate behavior changes** (called out so review doesn't flag them as bugs): (a) no-arg invocation now prints help + exit 0 (was: parse error); (b) the Gallica-path catch returns exit 2 (was: 1) — the dispatch test pins it.

## Execution Handoff

(Filled in after user review — see below.)
