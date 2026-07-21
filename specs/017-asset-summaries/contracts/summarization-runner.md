# Contract: SummarizationRunner (injected engine)

Mirrors `TranslationEngine` (`src/engine/types.ts`) + `createClaudeCli` (`src/claude/client.ts`)
+ `createEngine` (`src/engine/factory.ts`). Dedicated engine — MUST NOT route through the
spec-014 source-query client (FR-012).

## Interface (`src/summarize/types.ts`)

```ts
export interface StructuredSummaryFields {
  readonly topics: readonly string[];
  readonly people: readonly string[];
  readonly places: readonly string[];
  readonly dates: readonly string[];
  readonly claims: readonly string[];   // recorded, NOT asserted (Constitution I/II)
}

export interface SummaryResult {
  readonly thoroughBody: string;                 // narrative prose (markdown body)
  readonly structured: StructuredSummaryFields;  // -> thorough frontmatter
  readonly concise: string;                      // ~1-3 sentences, distilled from thorough
}

export interface SummarizationRunner {
  readonly name: string;   // provenance label, e.g. "claude-code-cli"
  // One generation flow -> thorough (structured + prose) AND concise distilled from it.
  summarize(inputText: string, model?: string): Promise<SummaryResult>;
}
```

## Behavior contract

- **One pass, two depths**: `summarize` produces the thorough (structured + prose) and derives
  the concise from that same generation — the concise MUST NOT introduce a claim absent from the
  thorough (SC-003). Enforced by the prompt shape (`src/summarize/prompt.ts`) and asserted in
  tests.
- **Fail loud**: non-zero CLI exit or empty/unparseable output → throw a descriptive error (no
  fallback, Constitution V). Never returns a fabricated/placeholder summary.
- **Structured output parse**: the runner parses the model's structured fields; a malformed
  structured block is an error, not a silent drop.
- **English output** regardless of input language (FR-002).

## Factory + config

```ts
// src/summarize/factory.ts  (mirrors engine/factory.ts)
export function createSummarizer(name: SummarizerName): SummarizerBundle; // { runner, preflight }
// v1 wires 'claude' -> createClaudeSummarizer(defaultClaudeCommandRunner()), preflight assertClaudeAvailable
```

```ts
// src/summarize/config.ts  (mirrors engine/config.ts, flag > config > default)
export const DEFAULT_SUMMARY_MODEL = 'claude-sonnet-5';
export function resolveSummaryModel(flag?: string, config?: SummaryConfig): string;
```

## Claude CLI adapter (`src/summarize/runner-claude.ts`)

`createClaudeSummarizer(runner: ClaudeCommandRunner): SummarizationRunner` — shells
`claude --print <prompt> --disable-slash-commands --tools "" --model <model>` with the input text
on stdin (mirrors `createClaudeCli`), parses the two-depth structured response. Reuses
`src/claude/exec.ts` `ClaudeCommandRunner` — NO new HTTP client, NO API-key handling (research
Decision 1). Operator may later swap in an HTTP-SDK adapter behind this same interface.

## Test seam

Tests supply a hand-written in-memory `SummarizationRunner` returning canned `SummaryResult`
(legitimate — inside test code, behind the injected interface; not a production mock). Mirror
`tests/unit/translate-page.test.ts` `fakeClaudeCli`.
