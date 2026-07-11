# Pluggable Translation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `translate` / `translate-source` run on either the Claude Code CLI or the Codex CLI, selectable per run, with per-engine configurable models and accurate provenance.

**Architecture:** Introduce a `TranslationEngine` interface with two adapters (`src/claude/*`, new `src/codex/*`). A factory + config module resolve the engine and model from `--engine`/`--model` flags ▸ `translate.config.json` ▸ code defaults. The translate pipeline and provenance are threaded with the selected engine (its `name` becomes the provenance label). Codex is driven as an isolated, non-agentic text engine (`codex exec --ignore-user-config --ignore-rules -s read-only --ephemeral -o <file>`), validated empirically before rollout.

**Tech Stack:** TypeScript (strict), tsx, vitest, Node built-ins (`node:child_process`, `node:fs/promises`, `node:os`), Claude Code CLI (`claude`), Codex CLI (`codex` 0.141.0).

## Global Constraints

- `@/` imports only for internal modules; Node built-ins (`node:*`) allowed. (CLAUDE.md)
- No `any`, no `as Type` assertions, no `@ts-ignore`/`@ts-expect-error`. (CLAUDE.md)
- No fallbacks or mock data outside test code — fail loud with descriptive errors. (CLAUDE.md)
- Files ≤ 300–500 lines; split if larger. (CLAUDE.md)
- Tests: vitest; every engine call is dependency-injected so no test invokes a real `claude`/`codex`. Run with `npx vitest run`.
- Typecheck: `npx tsc --noEmit` must be clean.
- Commit per task; do not bypass hooks; branch is `002-source-translation`.
- Default engine stays `claude`; default models: claude → `claude-opus-4-8`, codex → `gpt-5.5`.

---

## File Structure

- **New** `src/engine/types.ts` — `TranslationEngine` interface, `EngineName` type.
- **New** `src/engine/config.ts` — load `translate.config.json`, resolve engine + model.
- **New** `src/engine/factory.ts` — `createEngine(name, runner)` → `{ engine, preflight }`.
- **New** `src/codex/exec.ts` — codex-specific command shape (reuses `@/ocr/exec` `execCommand`).
- **New** `src/codex/client.ts` — `createCodexEngine` implementing `TranslationEngine`.
- **New** `src/codex/preflight.ts` — `assertCodexAvailable`.
- **Modify** `src/claude/client.ts` — expose the claude adapter as a `TranslationEngine` (add `name`).
- **Modify** `src/translate/{transform,cleanup,translate-page,issue,source,artifacts}.ts` — `ClaudeCli` → `TranslationEngine`; provenance takes engine label.
- **Modify** `src/cli/{parse,translate}.ts` — `--engine` option; resolve engine+model; build via factory.
- **Modify** tests + `tests/integration/support/translate-archive.ts` accordingly.

---

## Task 1: Characterize `codex exec` on a real page (spike — no code committed)

**Goal:** Confirm the exact codex invocation that yields clean, complete translation output, before building the adapter. Purely investigative.

**Files:** none committed (scratch scripts only).

- [ ] **Step 1: Confirm codex auth**

Run: `codex exec "reply with the single word OK and nothing else" -s read-only --ignore-user-config --ignore-rules --skip-git-repo-check --ephemeral -o /tmp/codex-probe.txt </dev/null; echo "exit $?"; cat /tmp/codex-probe.txt`
Expected: exit 0 and the file contains `OK` (or close). If it errors about auth, STOP and tell the operator to run `codex login`.

- [ ] **Step 2: Smoke a real page (translation pass)**

Use a real corrected-French page (e.g. capture one via the existing claude cleanup, or reuse `tests/fixtures/issue-sample.txt` first page). Write a scratch tsx script that runs:
`codex exec "<TRANSLATION_PROMPT text>" -m gpt-5-codex -s read-only --ignore-user-config --ignore-rules --skip-git-repo-check --ephemeral -o <tmp>` with the French on stdin, then reads `<tmp>`.
Expected: the temp file holds a full English translation, no preamble/agentic narration, length within ~50–150% of the source.

- [ ] **Step 3: Repeat 3–4× to gauge determinism**

Run the smoke several times. Record: any preamble leakage, truncation rate, and whether `-o` captures a clean final message. If preamble/agentic leakage appears, try additional isolation (e.g. `--disable <feature>`, a stronger system directive folded into the prompt); if `-o` is not clean, fall back to `--json` and extract the last `agent_message`/assistant event.

- [ ] **Step 4: Record the confirmed recipe**

Append a short "Codex invocation (confirmed)" note to `docs/superpowers/specs/2026-07-09-pluggable-translation-engine-design.md`: the exact flag list and the output-capture method (`-o` file vs `--json` last message). Tasks 3 uses this recipe. Commit the design-doc note:

```bash
git add docs/superpowers/specs/2026-07-09-pluggable-translation-engine-design.md
git commit -m "design(002): record confirmed codex exec invocation recipe"
```

> If Step 3 shows codex output is unusable even after tuning, STOP and report to the operator — do not build an adapter around a broken engine.

---

## Task 2: `TranslationEngine` interface; claude adapter implements it

**Files:**
- Create: `src/engine/types.ts`
- Modify: `src/claude/client.ts`
- Test: `tests/unit/claude-client.test.ts` (extend)

**Interfaces:**
- Produces: `interface TranslationEngine { readonly name: string; run(prompt: string, sourceText: string, model?: string, systemPrompt?: string): Promise<string> }`; `type EngineName = 'claude' | 'codex'`. `createClaudeCli(runner)` returns a value assignable to `TranslationEngine` with `name === 'claude-code-cli'`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/claude-client.test.ts`:
```ts
import type { TranslationEngine } from '@/engine/types';
it('exposes the claude provenance name and satisfies TranslationEngine', () => {
  const { runner } = fakeRunner({ stdout: 'x', stderr: '', exitCode: 0 });
  const engine: TranslationEngine = createClaudeCli(runner);
  expect(engine.name).toBe('claude-code-cli');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/claude-client.test.ts`
Expected: FAIL — `Cannot find module '@/engine/types'` / `name` missing.

- [ ] **Step 3: Create the interface**

`src/engine/types.ts`:
```ts
/** Engine selector value (CLI/config). */
export type EngineName = 'claude' | 'codex';

/**
 * A pluggable translation engine: one adapter per backend CLI. `name` is the
 * provenance label recorded in each artifact's `.yml` (e.g. "claude-code-cli",
 * "codex-cli"). `run` is one instruction+sourceText transformation call.
 */
export interface TranslationEngine {
  readonly name: string;
  run(
    prompt: string,
    sourceText: string,
    model?: string,
    systemPrompt?: string,
  ): Promise<string>;
}
```

- [ ] **Step 4: Add `name` to the claude adapter**

In `src/claude/client.ts`, change `createClaudeCli` to return a `TranslationEngine`: import the type, add `name: 'claude-code-cli'` to the returned object, keep `run` exactly as-is. Keep the existing `ClaudeCli` export as a type alias for back-compat if referenced: `export type ClaudeCli = TranslationEngine;` (re-export the interface). Return type of `createClaudeCli` becomes `TranslationEngine`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/claude-client.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/engine/types.ts src/claude/client.ts tests/unit/claude-client.test.ts
git commit -m "feat(002): TranslationEngine interface; claude adapter carries provenance name"
```

---

## Task 3: Codex adapter (`src/codex/exec.ts`, `src/codex/client.ts`)

**Files:**
- Create: `src/codex/exec.ts`, `src/codex/client.ts`
- Test: `tests/unit/codex-client.test.ts`

**Interfaces:**
- Consumes: `execCommand` from `@/ocr/exec`, `TranslationEngine` from `@/engine/types`.
- Produces: `interface CodexCommandRunner { run(command: string, args: string[], stdin?: string): Promise<ExecResult> }`; `defaultCodexCommandRunner(): CodexCommandRunner`; `createCodexEngine(runner: CodexCommandRunner, readLastMessage: (file: string) => Promise<string>): TranslationEngine` with `name === 'codex-cli'`.

> Use the flag list confirmed in Task 1. The code below assumes the design's proposed recipe (`-o <tmpfile>`); adjust the arg array + output read if Task 1 concluded `--json`.

- [ ] **Step 1: Write the failing test**

`tests/unit/codex-client.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { ExecResult } from '@/ocr/exec';
import { createCodexEngine } from '@/codex/client';

interface Call { command: string; args: string[]; stdin?: string }
function fake(result: ExecResult, fileContent: string) {
  const calls: Call[] = [];
  const runner = { run: async (command: string, args: string[], stdin?: string) => { calls.push({ command, args, stdin }); return result; } };
  const readLastMessage = async (_file: string) => fileContent;
  return { runner, readLastMessage, calls };
}

describe('createCodexEngine', () => {
  it('runs `codex exec` isolated, folds the system prompt, returns the -o message', async () => {
    const { runner, readLastMessage, calls } = fake({ stdout: '', stderr: '', exitCode: 0 }, 'English text here, plenty long.');
    const engine = createCodexEngine(runner, readLastMessage);
    expect(engine.name).toBe('codex-cli');
    const out = await engine.run('INSTRUCTION', 'Texte français', 'gpt-5-codex', 'SYSTEM RULES');
    expect(out).toBe('English text here, plenty long.');
    expect(calls[0].command).toBe('codex');
    expect(calls[0].args).toContain('exec');
    expect(calls[0].args).toContain('--ignore-user-config');
    expect(calls[0].args).toContain('--ignore-rules');
    expect(calls[0].args).toContain('read-only');
    expect(calls[0].args).toContain('--ephemeral');
    expect(calls[0].args).toContain('-m'); expect(calls[0].args).toContain('gpt-5-codex');
    const oIdx = calls[0].args.indexOf('-o'); expect(oIdx).toBeGreaterThanOrEqual(0);
    // prompt arg folds SYSTEM RULES + INSTRUCTION
    const prompt = calls[0].args.find((a) => a.includes('INSTRUCTION') && a.includes('SYSTEM RULES'));
    expect(prompt).toBeDefined();
    expect(calls[0].stdin).toBe('Texte français');
  });
  it('throws on non-zero exit', async () => {
    const { runner, readLastMessage } = fake({ stdout: '', stderr: 'boom', exitCode: 2 }, '');
    const engine = createCodexEngine(runner, readLastMessage);
    await expect(engine.run('i', 's', undefined, 'sys')).rejects.toThrow(/codex exec/);
  });
  it('throws on empty final message', async () => {
    const { runner, readLastMessage } = fake({ stdout: '', stderr: '', exitCode: 0 }, '   ');
    const engine = createCodexEngine(runner, readLastMessage);
    await expect(engine.run('i', 's', undefined, 'sys')).rejects.toThrow(/empty/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/codex-client.test.ts`
Expected: FAIL — `Cannot find module '@/codex/client'`.

- [ ] **Step 3: Implement `src/codex/exec.ts`**

```ts
import { execCommand } from '@/ocr/exec';
import type { ExecResult } from '@/ocr/exec';

/** Injectable codex command runner (mirrors ClaudeCommandRunner). */
export interface CodexCommandRunner {
  run(command: string, args: string[], stdin?: string): Promise<ExecResult>;
}

/** Real runner: delegates to the shared execCommand (stdin supported). */
export function defaultCodexCommandRunner(): CodexCommandRunner {
  return { run: (command, args, stdin) => execCommand(command, args, stdin) };
}
```

- [ ] **Step 4: Implement `src/codex/client.ts`**

```ts
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TranslationEngine } from '@/engine/types';
import type { CodexCommandRunner } from '@/codex/exec';

/**
 * Isolation flags: run codex as a non-agentic, config-free text engine (the
 * analog to the claude `--disable-slash-commands --tools ""` hardening).
 * The exact set is confirmed in Task 1.
 */
const CODEX_ISOLATION = [
  '-s', 'read-only',
  '--ignore-user-config',
  '--ignore-rules',
  '--skip-git-repo-check',
  '--ephemeral',
];

/** Read codex's `-o` last-message file, injected so tests avoid disk. */
export async function readLastMessageFile(file: string): Promise<string> {
  const text = await readFile(file, 'utf-8');
  await unlink(file).catch(() => undefined);
  return text;
}

export function createCodexEngine(
  runner: CodexCommandRunner,
  readLastMessage: (file: string) => Promise<string> = readLastMessageFile,
): TranslationEngine {
  return {
    name: 'codex-cli',
    async run(prompt, sourceText, model, systemPrompt) {
      // codex exec has no separate system channel: fold systemPrompt into the prompt.
      const folded = systemPrompt !== undefined ? `${systemPrompt}\n\n${prompt}` : prompt;
      const outFile = path.join(tmpdir(), `codex-out-${globalThis.process.pid}-${globalThis.performance.now()}.txt`);
      const args = ['exec', folded, ...CODEX_ISOLATION, '-o', outFile];
      if (model !== undefined) { args.push('-m', model); }
      const result = await runner.run('codex', args, sourceText);
      if (result.exitCode !== 0) {
        throw new Error(
          `codex exec failed (exit ${result.exitCode}): ${result.stderr.trim() || '(no stderr)'}`,
        );
      }
      const message = await readLastMessage(outFile);
      if (message.trim().length === 0) {
        throw new Error('codex exec produced empty output (no fallback substituted).');
      }
      return message;
    },
  };
}
```

> Note: `-m gpt-5-codex` ordering — the test only checks membership + `-o` presence, so appending `-m` after isolation is fine. If Task 1 chose `--json`, replace `-o outFile` + `readLastMessage` with JSONL parse of stdout for the final assistant message.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/codex-client.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/codex/exec.ts src/codex/client.ts tests/unit/codex-client.test.ts
git commit -m "feat(002): codex translation engine adapter (isolated codex exec)"
```

---

## Task 4: Codex preflight (`src/codex/preflight.ts`)

**Files:**
- Create: `src/codex/preflight.ts`
- Test: `tests/unit/codex-preflight.test.ts`

**Interfaces:**
- Produces: `interface CodexPreflightDeps { pathLookup(cmd: string): Promise<boolean>; run: CodexCommandRunner }`; `defaultCodexPreflightDeps(): CodexPreflightDeps`; `assertCodexAvailable(deps?): Promise<void>`.

- [ ] **Step 1: Write the failing test**

`tests/unit/codex-preflight.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { assertCodexAvailable } from '@/codex/preflight';

const okRunner = { run: async () => ({ stdout: 'codex-cli 0.141.0', stderr: '', exitCode: 0 }) };

describe('assertCodexAvailable', () => {
  it('resolves when codex is on PATH and runnable', async () => {
    await expect(assertCodexAvailable({ pathLookup: async () => true, run: okRunner })).resolves.toBeUndefined();
  });
  it('throws naming install/login when codex is absent', async () => {
    await expect(assertCodexAvailable({ pathLookup: async () => false, run: okRunner }))
      .rejects.toThrow(/codex/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/codex-preflight.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/codex/preflight.ts`**

Model on `src/claude/preflight.ts`:
```ts
import { defaultCodexCommandRunner } from '@/codex/exec';
import type { CodexCommandRunner } from '@/codex/exec';

export interface CodexPreflightDeps {
  pathLookup(command: string): Promise<boolean>;
  run: CodexCommandRunner;
}

export function defaultCodexPreflightDeps(): CodexPreflightDeps {
  return {
    pathLookup: async (command) => {
      const r = await defaultCodexCommandRunner().run('command', ['-v', command]);
      return r.exitCode === 0;
    },
    run: defaultCodexCommandRunner(),
  };
}

const HELP = 'install the Codex CLI and run `codex login` to authenticate';

export async function assertCodexAvailable(
  deps: CodexPreflightDeps = defaultCodexPreflightDeps(),
): Promise<void> {
  if (!(await deps.pathLookup('codex'))) {
    throw new Error(`codex CLI preflight failed -- "codex" not found on PATH. ${HELP}.`);
  }
  const probe = await deps.run.run('codex', ['--version']);
  if (probe.exitCode !== 0) {
    throw new Error(`codex CLI preflight failed -- "codex --version" exited ${probe.exitCode}. ${HELP}.`);
  }
}
```

> `pathLookup` via `command -v` mirrors how claude preflight probes PATH; keep it consistent with `src/claude/preflight.ts`'s actual mechanism (check that file and match it).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/codex-preflight.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/codex/preflight.ts tests/unit/codex-preflight.test.ts
git commit -m "feat(002): codex preflight (PATH + version probe, fail loud)"
```

---

## Task 5: Engine config + factory (`src/engine/config.ts`, `src/engine/factory.ts`)

**Files:**
- Create: `src/engine/config.ts`, `src/engine/factory.ts`
- Test: `tests/unit/engine-config.test.ts`, `tests/unit/engine-factory.test.ts`

**Interfaces:**
- Produces:
  - `interface EngineConfig { engine?: EngineName; models?: { claude?: string; codex?: string } }`
  - `DEFAULT_ENGINE: EngineName = 'claude'`; `DEFAULT_MODELS: Record<EngineName, string> = { claude: 'claude-opus-4-8', codex: 'gpt-5.5' }`
  - `resolveEngine(flag: string | undefined, config: EngineConfig): EngineName` (flag ▸ config ▸ default; unknown flag throws)
  - `resolveModel(flag: string | undefined, engine: EngineName, config: EngineConfig): string` (flag ▸ config.models[engine] ▸ DEFAULT_MODELS[engine])
  - `loadEngineConfig(repoRoot: string): Promise<EngineConfig>` (reads `translate.config.json`; absent → `{}`; malformed → throw)
  - `createEngine(name: EngineName): { engine: TranslationEngine; preflight: () => Promise<void> }`

- [ ] **Step 1: Write the failing tests (resolution)**

`tests/unit/engine-config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { resolveEngine, resolveModel, DEFAULT_MODELS } from '@/engine/config';

describe('engine/model resolution', () => {
  it('engine: flag over config over default', () => {
    expect(resolveEngine('codex', { engine: 'claude' })).toBe('codex');
    expect(resolveEngine(undefined, { engine: 'codex' })).toBe('codex');
    expect(resolveEngine(undefined, {})).toBe('claude');
  });
  it('engine: unknown flag throws', () => {
    expect(() => resolveEngine('gpt', {})).toThrow(/unknown engine/i);
  });
  it('model: flag over config over per-engine default', () => {
    expect(resolveModel('m1', 'codex', { models: { codex: 'm2' } })).toBe('m1');
    expect(resolveModel(undefined, 'codex', { models: { codex: 'm2' } })).toBe('m2');
    expect(resolveModel(undefined, 'codex', {})).toBe(DEFAULT_MODELS.codex);
    expect(resolveModel(undefined, 'claude', {})).toBe(DEFAULT_MODELS.claude);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/engine-config.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `src/engine/config.ts`**

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { EngineName } from '@/engine/types';

export interface EngineConfig {
  engine?: EngineName;
  models?: { claude?: string; codex?: string };
}

export const DEFAULT_ENGINE: EngineName = 'claude';
export const DEFAULT_MODELS: Record<EngineName, string> = {
  claude: 'claude-opus-4-8',
  codex: 'gpt-5.5',
};

const ENGINES: readonly EngineName[] = ['claude', 'codex'];
function assertEngine(value: string): EngineName {
  if ((ENGINES as readonly string[]).includes(value)) { return value as EngineName; }
  throw new Error(`unknown engine "${value}" (expected one of: ${ENGINES.join(', ')})`);
}

export function resolveEngine(flag: string | undefined, config: EngineConfig): EngineName {
  if (flag !== undefined) { return assertEngine(flag); }
  if (config.engine !== undefined) { return config.engine; }
  return DEFAULT_ENGINE;
}

export function resolveModel(flag: string | undefined, engine: EngineName, config: EngineConfig): string {
  if (flag !== undefined) { return flag; }
  const configured = config.models?.[engine];
  if (configured !== undefined) { return configured; }
  return DEFAULT_MODELS[engine];
}

export async function loadEngineConfig(repoRoot: string): Promise<EngineConfig> {
  const file = path.join(repoRoot, 'translate.config.json');
  let raw: string;
  try { raw = await readFile(file, 'utf-8'); } catch { return {}; }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`translate.config.json is malformed (expected an object): ${file}`);
  }
  return parsed as EngineConfig;
}
```

> The single `as EngineName` inside `assertEngine` is a validated narrowing after an `includes` check; if the reviewer objects, replace with an explicit `switch`. Prefer a `switch` to keep the no-`as` rule absolute:
> ```ts
> function assertEngine(v: string): EngineName {
>   switch (v) { case 'claude': return 'claude'; case 'codex': return 'codex';
>     default: throw new Error(`unknown engine "${v}" (expected one of: ${ENGINES.join(', ')})`); }
> }
> ```
> Use the `switch` form. Likewise, `parsed as EngineConfig` should be replaced by reading known fields defensively (engine via `assertEngine` when present; models fields checked as strings).

- [ ] **Step 4: Harden `loadEngineConfig` (no `as`)**

Replace `return parsed as EngineConfig;` with explicit field extraction:
```ts
  const obj: Record<string, unknown> = parsed as Record<string, unknown>; // still an as — avoid:
```
Instead write a small reader:
```ts
function readConfig(obj: object): EngineConfig {
  const cfg: EngineConfig = {};
  if ('engine' in obj && typeof (obj as { engine?: unknown }).engine === 'string') {
    cfg.engine = assertEngine(String((obj as { engine: string }).engine));
  }
  // models
  const m = 'models' in obj ? (obj as { models?: unknown }).models : undefined;
  if (typeof m === 'object' && m !== null) {
    const mm = m as Record<string, unknown>;
    cfg.models = {};
    if (typeof mm.claude === 'string') { cfg.models.claude = mm.claude; }
    if (typeof mm.codex === 'string') { cfg.models.codex = mm.codex; }
  }
  return cfg;
}
```
> The above still uses `as` for the index reads. If the reviewer enforces zero-`as`, use a tiny type-guard helper `isRecord(x): x is Record<string, unknown>` and index via that. Implement whichever passes `tsc` with the project's lint; the REQUIREMENT is: parse `engine` (validated) + `models.claude`/`models.codex` (strings), ignore unknown keys, throw on a non-object root. Add a test for a malformed root and for unknown-key tolerance.

- [ ] **Step 5: Write the failing test (factory)**

`tests/unit/engine-factory.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createEngine } from '@/engine/factory';

describe('createEngine', () => {
  it('builds the claude engine + preflight', () => {
    const { engine, preflight } = createEngine('claude');
    expect(engine.name).toBe('claude-code-cli');
    expect(typeof preflight).toBe('function');
  });
  it('builds the codex engine + preflight', () => {
    const { engine, preflight } = createEngine('codex');
    expect(engine.name).toBe('codex-cli');
    expect(typeof preflight).toBe('function');
  });
});
```

- [ ] **Step 6: Implement `src/engine/factory.ts`**

```ts
import type { EngineName, TranslationEngine } from '@/engine/types';
import { createClaudeCli } from '@/claude/client';
import { defaultClaudeCommandRunner } from '@/claude/exec';
import { assertClaudeAvailable } from '@/claude/preflight';
import { createCodexEngine } from '@/codex/client';
import { defaultCodexCommandRunner } from '@/codex/exec';
import { assertCodexAvailable } from '@/codex/preflight';

export interface EngineBundle {
  engine: TranslationEngine;
  preflight: () => Promise<void>;
}

export function createEngine(name: EngineName): EngineBundle {
  switch (name) {
    case 'claude':
      return { engine: createClaudeCli(defaultClaudeCommandRunner()), preflight: () => assertClaudeAvailable() };
    case 'codex':
      return { engine: createCodexEngine(defaultCodexCommandRunner()), preflight: () => assertCodexAvailable() };
  }
}
```

- [ ] **Step 7: Run all new tests + tsc**

Run: `npx vitest run tests/unit/engine-config.test.ts tests/unit/engine-factory.test.ts && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add src/engine/config.ts src/engine/factory.ts tests/unit/engine-config.test.ts tests/unit/engine-factory.test.ts
git commit -m "feat(002): engine config resolution + factory (engine/model precedence)"
```

---

## Task 6: Thread `TranslationEngine` through the pipeline + provenance

**Files:**
- Modify: `src/translate/transform.ts`, `src/translate/cleanup.ts`, `src/translate/translate-page.ts`, `src/translate/issue.ts`, `src/translate/source.ts`, `src/translate/artifacts.ts`
- Modify tests: `tests/unit/{cleanup,translate-page,transform,artifacts}.test.ts`, `tests/integration/support/translate-archive.ts` and any integration test asserting provenance engine
- Test: existing suite

**Interfaces:**
- Consumes: `TranslationEngine` from `@/engine/types`.
- Produces: `buildTranslationProvenance(base, kind, engineName, model, retrieved)` (new `engineName` param); `TranslateIssueCtx.engine: TranslationEngine` (replaces `claude`); ditto `TranslateSourceCtx`.

- [ ] **Step 1: Update `runFaithfulTransformation` + passes to take `TranslationEngine`**

In `src/translate/transform.ts`, change the first param type from `ClaudeCli` to `TranslationEngine` (import from `@/engine/types`). In `src/translate/cleanup.ts` and `src/translate/translate-page.ts`, change the `claude: ClaudeCli` parameter to `engine: TranslationEngine` and pass `engine` to `runFaithfulTransformation`. The `ClaudeCli` alias still resolves, so this is largely a rename; run `npx tsc --noEmit` and fix references.

- [ ] **Step 2: Update the tests for the passes (they already inject a fake with `run`)**

The existing fakes in `cleanup.test.ts` / `translate-page.test.ts` / `transform.test.ts` implement `{ run }`; add `name: 'fake'` to each fake object so it satisfies `TranslationEngine`. Update any `ClaudeCli` type import to `TranslationEngine`.

- [ ] **Step 3: `buildTranslationProvenance` records the engine label**

In `src/translate/artifacts.ts`, change the signature to `buildTranslationProvenance(base, kind, engineName: string, model: string, retrieved: string)` and set `engine: engineName` (replacing the hardcoded `'claude-code-cli'`). Update `tests/unit/artifacts.test.ts`: pass an explicit `engineName` (e.g. `'codex-cli'`) and assert `result.engine === 'codex-cli'`.

- [ ] **Step 4: Update `translateIssue` ctx + call site**

In `src/translate/issue.ts`: rename `TranslateIssueCtx.claude` → `engine: TranslationEngine`; where it resolves the model constant, keep the injected `model`; replace `DEFAULT_MODEL` usage so the *caller* supplies the resolved model (the CLI now resolves per engine) — keep a fallback default only if `ctx.model` is undefined, using the value the CLI passes. Update the `cleanupPage`/`translatePage` calls to pass `ctx.engine`. Pass `ctx.engine.name` to `buildTranslationProvenance` (via the `persist` helper). Update its unit/integration usages.

- [ ] **Step 5: Update `translateSource` ctx**

In `src/translate/source.ts`: rename `TranslateSourceCtx.claude` → `engine: TranslationEngine`; forward `engine` into each `TranslateIssueCtx`.

- [ ] **Step 6: Update the integration harness**

In `tests/integration/support/translate-archive.ts`: rename the fake field `claude` → `engine` and give the fake `ClaudeCli`-shaped object a `name: 'fake-engine'`. Update `buildCtx`/`buildSourceCtx` to set `engine`. Update every integration test that referenced `ctx.claude` or asserted `engine: 'claude-code-cli'` in provenance to use `'fake-engine'` (or the injected name).

- [ ] **Step 7: Run the full suite + tsc**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green, clean. Fix any missed rename.

- [ ] **Step 8: Commit**

```bash
git add src/translate tests/unit tests/integration
git commit -m "refactor(002): thread TranslationEngine through pipeline; provenance records engine label"
```

---

## Task 7: CLI wiring (`--engine`, resolution, factory)

**Files:**
- Modify: `src/cli/parse.ts`, `src/cli/translate.ts`
- Test: `tests/unit/parse.test.ts`, `tests/integration/translate-source-cli.test.ts`

**Interfaces:**
- Consumes: `resolveEngine`, `resolveModel`, `loadEngineConfig` (`@/engine/config`), `createEngine` (`@/engine/factory`).
- Produces: `ParsedOptions.engine?: string`; `runTranslate`/`runTranslateSource` build the engine via the factory using resolved engine+model.

- [ ] **Step 1: Add `--engine` to the parser (failing test)**

In `tests/unit/parse.test.ts` add:
```ts
it('parses --engine into options', () => {
  const a = parse(['translate', 'ark', '--engine', 'codex']);
  expect(a.options.engine).toBe('codex');
});
```
Run: `npx vitest run tests/unit/parse.test.ts` → FAIL.

- [ ] **Step 2: Implement the parser change**

In `src/cli/parse.ts`: add `engine: { type: 'string' }` to the `parseArgs` options; add `engine?: string` to `ParsedOptions`; return `engine: values.engine`.
Run: `npx vitest run tests/unit/parse.test.ts` → PASS.

- [ ] **Step 3: Resolve engine+model in the CLI deps**

In `src/cli/translate.ts`: change `defaultTranslateCliDeps()` to accept the resolved engine bundle. Concretely, add an async builder:
```ts
export async function buildTranslateCliDeps(args: ParsedArgs): Promise<TranslateCliDeps> {
  const repoRoot = process.cwd();
  const config = await loadEngineConfig(repoRoot);
  const engineName = resolveEngine(args.options.engine, config);
  const model = resolveModel(args.options.model, engineName, config);
  const { engine, preflight } = createEngine(engineName);
  return { archiveRoot: resolveArchiveRoot(repoRoot), clock: () => new Date(), log: (m) => console.log(m), preflight, engine, model, delay: () => new Promise((r) => setTimeout(r, PACE_MS)) };
}
```
Update `TranslateCliDeps` to carry `engine: TranslationEngine` and `model: string` (replacing `claude`). `runTranslate`/`runTranslateSource` use `deps.model` when building the ctx (instead of `args.options.model` directly), and set `ctx.engine = deps.engine`. Keep `runTranslate(args, deps?)` signature but default `deps` by awaiting `buildTranslateCliDeps(args)` (make the default explicit inside the body when `deps` is omitted, since a default param can't be async):
```ts
export async function runTranslate(args: ParsedArgs, deps?: TranslateCliDeps): Promise<void> {
  const d = deps ?? await buildTranslateCliDeps(args);
  ...
}
```

- [ ] **Step 4: Update the bin dispatch**

`src/translate-index.ts` calls `runTranslate(args)` / `runTranslateSource(args)` — unchanged (they now self-resolve deps). Verify.

- [ ] **Step 5: Update CLI integration test**

In `tests/integration/translate-source-cli.test.ts`, the tests pass explicit `deps`; add `engine` + `model` to the constructed deps (the fake engine object with `name`), drop `claude`. Add one test that omitting deps + passing `--engine codex` selects the codex engine — but since that would hit real codex, instead unit-test the resolution path: assert `buildTranslateCliDeps({...,options:{engine:'codex'}})`'s returned `engine.name === 'codex-cli'` (no real call is made by construction).

- [ ] **Step 6: Run full suite + tsc + smoke**

Run: `npx vitest run && npx tsc --noEmit`
Then smoke: `npx tsx src/translate-index.ts --help` still works; `npx tsx src/translate-index.ts translate ARK --engine bogus` fails loud with "unknown engine".
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/cli/parse.ts src/cli/translate.ts tests/unit/parse.test.ts tests/integration/translate-source-cli.test.ts
git commit -m "feat(002): --engine flag + config-driven engine/model resolution in the CLI"
```

---

## Task 8: End-to-end codex verification + run the remaining 23 issues

**Files:** none (operational); optional `translate.config.json`.

- [ ] **Step 1: Real single-issue codex smoke**

Pick one untranslated issue. Run `translateIssue` (or the CLI with `--engine codex`) against the real archive with the real codex engine on ONE issue. Verify: `issue.fr.txt`/`issue.en.txt` land, English is faithful + complete, provenance `.yml` records `engine: codex-cli` + the resolved model, no preamble/agentic leakage across its pages. If leakage/truncation appears, revisit the codex adapter flags (Task 3) before proceeding.

- [ ] **Step 2: (Optional) set the config default to codex**

If the operator wants codex as the default without passing the flag each time, write `translate.config.json`:
```json
{ "engine": "codex", "models": { "codex": "gpt-5.5" } }
```
Otherwise pass `--engine codex` to the driver.

- [ ] **Step 3: Launch the remaining issues on codex**

Reuse the detached driver + per-issue committer pattern (build `TranslateSourceCtx` with the codex engine). `translateSource` skips the 50 already-translated (claude) issues and does the remaining 23 on codex. Commit + push per completed issue.

- [ ] **Step 4: Verify durability**

Confirm each new issue commits + pushes; mixed provenance is expected and correct (claude issues stay `claude-code-cli`, codex issues `codex-cli`).

---

## Self-Review

- **Spec coverage:** engine abstraction (Task 2), codex adapter (Task 3), preflight (Task 4), config+selection (Task 5), provenance per engine (Task 6, Step 3), CLI `--engine`+resolution (Task 7), verification-first rollout (Tasks 1 + 8), testing (each task). All spec sections mapped.
- **Placeholder scan:** no TBD/TODO; each code step carries full code. The two `as`-avoidance notes (Task 5) give explicit `switch`/guard replacements — implement the zero-`as` form.
- **Type consistency:** `TranslationEngine`/`EngineName` (Task 2) used consistently in Tasks 3/5/6/7; `createEngine`→`{engine,preflight}` (Task 5) consumed in Task 7; `buildTranslationProvenance` gains `engineName` (Task 6) — update all call sites in the same task.
- **Known assumption:** Task 3's exact codex flags/output-capture come from Task 1's empirical finding; if Task 1 chose `--json`, adjust Task 3's arg array + message extraction (noted inline).
