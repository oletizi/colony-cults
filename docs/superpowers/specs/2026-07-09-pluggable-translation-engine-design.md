# Design: Pluggable Translation Engine (claude | codex)

**Date:** 2026-07-09
**Status:** Approved (brainstorming)
**Feature branch:** 002-source-translation (extends the source-translation feature)

## Context

The `translate` / `translate-source` CLI currently drives translation through a
single hardcoded engine: the Claude Code CLI (`claude --print`), via
`src/claude/*` (`ClaudeCli`, `ClaudeCommandRunner`, `assertClaudeAvailable`) and
the isolation/prompt hardening added during live acceptance
(`--disable-slash-commands --tools ""`, `--append-system-prompt`,
`TRANSFORMATION_SYSTEM_PROMPT`, `runFaithfulTransformation` retry guard).

The operator wants to be able to translate with **Codex** (`codex exec`,
codex-cli 0.141.0) instead, and to **switch engines at any time** — a per-run
choice, not a hard swap.

A full-source run was stopped at 50/73 issues (all committed + pushed on
`claude-code-cli` / `claude-opus-4-8`). The remaining 23 will be run on codex
once this lands.

## Goals

- A pluggable translation engine with two adapters: `claude` and `codex`.
- Engine selectable per run; default configurable.
- Model configurable per engine, with a sensible code default.
- Accurate provenance: each artifact records the engine + model actually used
  (mixed batches stay honest).
- Codex driven as an isolated, non-agentic text-transformation engine — verified
  empirically before rollout.

## Non-goals

- Re-translating the 50 completed (claude) issues.
- Adding engines beyond claude/codex.
- Changing the cleanup/translate prompt content or the retry-guard semantics
  (both are engine-agnostic and reused as-is).

## Architecture

### Engine abstraction

Generalize `ClaudeCli` into a `TranslationEngine` interface (same call shape used
today, so `cleanupPage`, `translatePage`, and `runFaithfulTransformation` change
only by type):

```ts
interface TranslationEngine {
  /** Provenance label: "claude-code-cli" | "codex-cli". */
  readonly name: string;
  run(prompt: string, sourceText: string, model?: string, systemPrompt?: string): Promise<string>;
}
```

- `src/claude/*` — existing adapter, behavior unchanged; `createClaudeCli` becomes
  (or is wrapped by) a `TranslationEngine` with `name = "claude-code-cli"`.
- `src/codex/*` — new adapter (`exec.ts` reuse of `execCommand`, `client.ts`,
  `preflight.ts`), `name = "codex-cli"`.
- `src/engine/factory.ts` — `createEngine(name)` returns `{ engine, preflight }`.
- `src/engine/config.ts` — load config + resolve engine/model.

The `TranslateIssueCtx` / `TranslateSourceCtx` field `claude: ClaudeCli` becomes
`engine: TranslationEngine`; `preflight` (already present) is the selected
engine's preflight.

### Codex adapter

`codex exec` as an isolated, non-agentic text engine:

```
codex exec "<systemPrompt folded into the instruction>" \
  -m <model> -s read-only \
  --ignore-user-config --ignore-rules --skip-git-repo-check --ephemeral \
  -o <tmpfile>
# source text piped on stdin (codex appends it as a <stdin> block)
# result = the final message read back from <tmpfile>
```

- Codex has no separate system-prompt channel in `exec`, so the codex adapter
  **prepends** `systemPrompt` to the instruction prompt (claude appends it as a
  flag). Interface is identical; only the adapter differs.
- `--ignore-user-config --ignore-rules` + `read-only` sandbox is codex's analog
  to the claude isolation flags — no AGENTS.md/skill/agent scaffolding, no shell
  side effects.
- `-o <tmpfile>` captures just the final agent message (clean output); the
  adapter creates the temp file, runs, reads it, and deletes it.

### Selection & model resolution

Optional `translate.config.json` at the repo root (absent → code defaults):

```json
{ "engine": "claude", "models": { "claude": "claude-opus-4-8", "codex": "gpt-5-codex" } }
```

- **Engine** precedence: `--engine claude|codex` flag ▸ config `engine` ▸ code
  default `claude`.
- **Model** precedence: `--model` flag ▸ config `models.<engine>` ▸ per-engine
  code default (`claude` → `claude-opus-4-8`, `codex` → `gpt-5-codex`).

`parse.ts` gains an `--engine` string option; `runTranslate` / `runTranslateSource`
resolve engine+model, build the adapter+preflight via the factory, and pass them
into the ctx.

### Provenance

`buildTranslationProvenance` takes the engine label (from `engine.name`) instead
of the hardcoded `"claude-code-cli"`, and the resolved model. Every artifact's
`.yml` records the engine + model that produced it.

### Preflight

`assertCodexAvailable(deps)` mirrors `assertClaudeAvailable`: codex on PATH +
authenticated (e.g. a lightweight `codex` availability/auth probe via the injected
runner), failing loud with install/login guidance. Selected by the factory; fires
only when a real translation runs (never on `--dry-run`).

## Verification-first rollout

Codex may have its own preamble/agentic/truncation quirks (the claude adapter
needed real-CLI hardening). Therefore, before any rollout:

1. **Empirically smoke `codex exec` on a real OCR page** (cleanup + translate),
   inspect the output for preamble/agentic leakage, truncation, and completeness.
2. **Tune the codex flag set / output capture** to what codex actually does
   (sandbox mode, `-o` vs `--json` final-message extraction, any additional
   isolation) until output is clean and complete. The `runFaithfulTransformation`
   guard already covers intermittent truncation.
3. Only then **run the remaining 23 issues on codex** (via the same detached
   driver + per-issue commit/push cadence used for the claude batch).

## Testing

- Codex adapter unit tests: fake runner (writes the `-o` file / returns canned
  final message), asserting the arg set (isolation flags, `-m`, `-o`), the folded
  system prompt, stdin source text, and error/empty handling — no real `codex`.
- Config-resolution tests: engine/model precedence (flag ▸ config ▸ default),
  absent-config defaults, unknown-engine fail-loud.
- Provenance-per-engine test: `buildTranslationProvenance` records the passed
  engine label.
- Full suite stays green; `tsc` clean; new files ≤ 300–500 lines, `@/` imports,
  no `any`/`as`/`@ts-ignore`.

## Files (anticipated)

- New: `src/engine/types.ts`, `src/engine/factory.ts`, `src/engine/config.ts`,
  `src/codex/exec.ts`, `src/codex/client.ts`, `src/codex/preflight.ts`, tests.
- Changed: `src/translate/{cleanup,translate-page,transform,issue,source,artifacts}.ts`
  (type `ClaudeCli`→`TranslationEngine`, engine label in provenance),
  `src/cli/{parse,translate}.ts` (`--engine`, resolution), `src/claude/client.ts`
  (expose a `TranslationEngine` with `name`).

## Open assumptions (to confirm in step 1)

- `codex exec -o <file>` writes exactly the final assistant message (clean).
- `--ignore-user-config --ignore-rules -s read-only` suppresses agentic
  narration/side effects for a pure text-transform prompt.
- The operator is authenticated for `codex` (`codex login`).

## Codex invocation (confirmed — Task 1 spike, 2026-07-09)

Empirically characterized against codex-cli 0.141.0 on a real 2664-char OCR page:

- **Recipe:** `codex exec "<systemPrompt folded>\n\n<instruction>" -m <model> -s read-only --ignore-user-config --ignore-rules --skip-git-repo-check --ephemeral -o <tmpfile>`, source text on stdin (codex appends it as a `<stdin>` block); read the clean final message from `<tmpfile>` (stdout carries chrome — banner, token count — the `-o` file does not).
- **Output quality:** clean (no preamble/agentic leakage), faithful, complete (ratio ~0.96 of source length), deterministic across runs. No truncation observed. The `runFaithfulTransformation` guard is retained as engine-agnostic insurance.
- **Isolation:** `--ignore-user-config --ignore-rules -s read-only --ephemeral` is codex's analog to the claude isolation flags — no config/rules/skills, no side effects.
- **Model on a ChatGPT-account login:** `gpt-5-codex` and `gpt-5` return HTTP 400 "not supported when using Codex with a ChatGPT account". **`gpt-5.5` works** and is pinnable via `-m`. Therefore the codex default model is **`gpt-5.5`** (revises the earlier `gpt-5-codex` placeholder). An unsupported pinned model 400s → the adapter throws (fail loud, no fallback). `--ignore-user-config` means codex's built-in default (`gpt-5.5`) is used when `-m` is omitted, not `~/.codex/config.toml`'s value.
