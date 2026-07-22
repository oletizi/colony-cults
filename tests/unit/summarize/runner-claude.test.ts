import { describe, it, expect } from 'vitest';
import { createClaudeSummarizer } from '@/summarize/runner-claude';
import type { ClaudeCommandRunner } from '@/claude/exec';
import type { ExecResult } from '@/ocr/exec';
import type { SummarizationRunner, SummaryResult } from '@/summarize/types';
import { SUMMARY_SYSTEM_PROMPT, buildSummaryPrompt } from '@/summarize/prompt';

/**
 * Unit coverage for the Claude summarization adapter (T009/T010): ONE
 * `claude --print` invocation per `summarize()` call, driving the CLI as an
 * isolated engine and parsing the fenced JSON envelope back into a
 * `SummaryResult`. All calls go through an injected fake `ClaudeCommandRunner`
 * (test-only, NOT a production mock) -- no real `claude` binary is invoked.
 */

interface FakeCall {
  command: string;
  args: string[];
  stdin?: string;
}

function fakeRunner(result: ExecResult): {
  runner: ClaudeCommandRunner;
  calls: FakeCall[];
} {
  const calls: FakeCall[] = [];
  const runner: ClaudeCommandRunner = {
    run: async (command, args, stdin) => {
      calls.push({ command, args, stdin });
      return result;
    },
  };
  return { runner, calls };
}

/** Build a valid fenced-JSON envelope from an arbitrary payload object. */
function fence(payload: unknown): string {
  return '```json\n' + JSON.stringify(payload, null, 2) + '\n```';
}

const VALID_PAYLOAD = {
  thoroughBody:
    'The article, printed on the front page, describes a public meeting held ' +
    'to discuss the harbour works.\n\nA second section reports the resolutions passed.',
  structured: {
    topics: ['harbour works', 'public meeting'],
    people: ['J. Smith', 'Mayor Brown'],
    places: ['Wellington'],
    dates: ['1885-06-12'],
    claims: ['The article reports that the harbour works were approved.'],
  },
  concise:
    'A front-page article reports a public meeting in Wellington on 1885-06-12 ' +
    'about the harbour works, at which resolutions were passed.',
};

function runnerFor(payload: unknown): {
  summarizer: SummarizationRunner;
  calls: FakeCall[];
} {
  const { runner, calls } = fakeRunner({
    stdout: fence(payload),
    stderr: '',
    exitCode: 0,
  });
  return { summarizer: createClaudeSummarizer(runner), calls };
}

/**
 * A fake runner that returns a SEQUENCE of results, one per successive call
 * (clamping to the last entry once exhausted). Used to exercise the bounded
 * malformed-envelope retry loop: e.g. a bad envelope on attempt 1 followed by
 * a good one on attempt 2.
 */
function sequenceRunner(results: ExecResult[]): {
  runner: ClaudeCommandRunner;
  calls: FakeCall[];
} {
  const calls: FakeCall[] = [];
  const runner: ClaudeCommandRunner = {
    run: async (command, args, stdin) => {
      calls.push({ command, args, stdin });
      const idx = Math.min(calls.length - 1, results.length - 1);
      return results[idx];
    },
  };
  return { runner, calls };
}

/** A malformed envelope (unparseable JSON inside the fence). */
const MALFORMED_RESULT: ExecResult = {
  stdout: '```json\n{ not valid json ,,, }\n```',
  stderr: '',
  exitCode: 0,
};

/** A well-formed, valid envelope. */
const VALID_RESULT: ExecResult = {
  stdout: fence(VALID_PAYLOAD),
  stderr: '',
  exitCode: 0,
};

describe('createClaudeSummarizer (T009/T010)', () => {
  it('parses a valid envelope into a SummaryResult with fields mapped 1:1', async () => {
    const { summarizer } = runnerFor(VALID_PAYLOAD);

    const result: SummaryResult = await summarizer.summarize('source text');

    expect(result.thoroughBody).toBe(VALID_PAYLOAD.thoroughBody);
    expect(result.concise).toBe(VALID_PAYLOAD.concise);
    expect(result.structured.topics).toEqual(VALID_PAYLOAD.structured.topics);
    expect(result.structured.people).toEqual(VALID_PAYLOAD.structured.people);
    expect(result.structured.places).toEqual(VALID_PAYLOAD.structured.places);
    expect(result.structured.dates).toEqual(VALID_PAYLOAD.structured.dates);
    expect(result.structured.claims).toEqual(VALID_PAYLOAD.structured.claims);
  });

  it('accepts empty structured arrays', async () => {
    const payload = {
      thoroughBody: 'A short notice with no named entities.',
      structured: { topics: ['notice'], people: [], places: [], dates: [], claims: [] },
      concise: 'A short notice.',
    };
    const { summarizer } = runnerFor(payload);

    const result = await summarizer.summarize('source text');

    expect(result.structured.people).toEqual([]);
    expect(result.structured.dates).toEqual([]);
  });

  it('exposes the claude provenance name and satisfies SummarizationRunner', () => {
    const { summarizer } = runnerFor(VALID_PAYLOAD);
    const engine: SummarizationRunner = summarizer;
    expect(engine.name).toBe('claude-code-cli');
  });

  it('invokes claude --print with the fixed instruction as the argument and the source text on stdin', async () => {
    const { summarizer, calls } = runnerFor(VALID_PAYLOAD);

    await summarizer.summarize('bonjour le monde');

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('claude');
    expect(calls[0].args).toContain('--print');
    // The instruction argument is the FIXED build output -- it does NOT embed
    // the source text (the source text rides stdin, see the ARG_MAX test).
    expect(calls[0].args).toContain(buildSummaryPrompt());
    expect(calls[0].stdin).toBe('bonjour le monde');
    // The source text must not have leaked into the argument vector.
    for (const arg of calls[0].args) {
      expect(arg).not.toContain('bonjour le monde');
    }
  });

  it('streams a LARGE source text on stdin and keeps the args bounded (ARG_MAX / E2BIG guard)', async () => {
    const { summarizer, calls } = runnerFor(VALID_PAYLOAD);

    // A few hundred KB of source text -- representative of a real whole-issue
    // finding-aid (French OCR + English translation combined). Folded into a
    // CLI argument this would exceed the OS ARG_MAX limit and fail exec with
    // E2BIG; on stdin it flows unbounded.
    const largeInput = 'A'.repeat(400_000);

    await summarizer.summarize(largeInput);

    expect(calls).toHaveLength(1);
    // The large payload arrives on the stdin parameter, in full...
    expect(calls[0].stdin).toBe(largeInput);
    expect(calls[0].stdin?.length).toBe(400_000);
    // ...and NOT in the args array. No single argument carries the payload,
    // and the whole argument vector stays small and bounded regardless of how
    // large the source document is.
    for (const arg of calls[0].args) {
      expect(arg).not.toContain(largeInput);
    }
    const totalArgsBytes = calls[0].args.reduce((sum, arg) => sum + arg.length, 0);
    expect(totalArgsBytes).toBeLessThan(20_000);
  });

  it('isolates the engine: disables skills and agentic tools', async () => {
    const { summarizer, calls } = runnerFor(VALID_PAYLOAD);

    await summarizer.summarize('source');

    expect(calls[0].args).toContain('--disable-slash-commands');
    const toolsIdx = calls[0].args.indexOf('--tools');
    expect(toolsIdx).toBeGreaterThanOrEqual(0);
    expect(calls[0].args[toolsIdx + 1]).toBe('');
  });

  it('appends the summary system prompt via --append-system-prompt', async () => {
    const { summarizer, calls } = runnerFor(VALID_PAYLOAD);

    await summarizer.summarize('source');

    const idx = calls[0].args.indexOf('--append-system-prompt');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(calls[0].args[idx + 1]).toBe(SUMMARY_SYSTEM_PROMPT);
  });

  it('includes --model and the model name when a model is given', async () => {
    const { summarizer, calls } = runnerFor(VALID_PAYLOAD);

    await summarizer.summarize('source', 'claude-opus-4');

    const idx = calls[0].args.indexOf('--model');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(calls[0].args[idx + 1]).toBe('claude-opus-4');
  });

  it('omits --model when no model is given', async () => {
    const { summarizer, calls } = runnerFor(VALID_PAYLOAD);

    await summarizer.summarize('source');

    expect(calls[0].args).not.toContain('--model');
  });

  it('throws a descriptive error on a non-zero exit code, including stderr', async () => {
    const { runner } = fakeRunner({
      stdout: '',
      stderr: 'authentication expired',
      exitCode: 1,
    });
    const summarizer = createClaudeSummarizer(runner);

    await expect(summarizer.summarize('source')).rejects.toThrow(/authentication expired/);
    await expect(summarizer.summarize('source')).rejects.toThrow(/claude/);
    await expect(summarizer.summarize('source')).rejects.toThrow(/1/);
  });

  it('throws a descriptive error on empty stdout', async () => {
    const { runner } = fakeRunner({ stdout: '', stderr: '', exitCode: 0 });
    const summarizer = createClaudeSummarizer(runner);

    await expect(summarizer.summarize('source')).rejects.toThrow(
      /empty|no output|produced nothing/i,
    );
  });

  it('throws a descriptive error on whitespace-only stdout', async () => {
    const { runner } = fakeRunner({ stdout: '   \n\t  ', stderr: '', exitCode: 0 });
    const summarizer = createClaudeSummarizer(runner);

    await expect(summarizer.summarize('source')).rejects.toThrow(
      /empty|no output|produced nothing/i,
    );
  });

  it('throws when there is no json fence', async () => {
    const { runner } = fakeRunner({
      stdout: JSON.stringify(VALID_PAYLOAD),
      stderr: '',
      exitCode: 0,
    });
    const summarizer = createClaudeSummarizer(runner);

    await expect(summarizer.summarize('source')).rejects.toThrow(/malformed|fence|json/i);
  });

  it('throws when there is more than one json fence', async () => {
    const { runner } = fakeRunner({
      stdout: fence(VALID_PAYLOAD) + '\n' + fence(VALID_PAYLOAD),
      stderr: '',
      exitCode: 0,
    });
    const summarizer = createClaudeSummarizer(runner);

    await expect(summarizer.summarize('source')).rejects.toThrow(/malformed|fence|one/i);
  });

  it('throws when the fenced content is not parseable JSON', async () => {
    const { runner } = fakeRunner({
      stdout: '```json\n{ not valid json ,,, }\n```',
      stderr: '',
      exitCode: 0,
    });
    const summarizer = createClaudeSummarizer(runner);

    await expect(summarizer.summarize('source')).rejects.toThrow(/malformed|parse|json/i);
  });

  it('throws when a top-level key is missing', async () => {
    const payload = {
      thoroughBody: VALID_PAYLOAD.thoroughBody,
      structured: VALID_PAYLOAD.structured,
      // concise omitted
    };
    const { summarizer } = runnerFor(payload);

    await expect(summarizer.summarize('source')).rejects.toThrow(/concise|missing|key/i);
  });

  it('throws when there is an unexpected extra top-level key', async () => {
    const payload = { ...VALID_PAYLOAD, extra: 'nope' };
    const { summarizer } = runnerFor(payload);

    await expect(summarizer.summarize('source')).rejects.toThrow(/extra|unexpected|key/i);
  });

  it('throws when a structured key is missing', async () => {
    const payload = {
      thoroughBody: VALID_PAYLOAD.thoroughBody,
      structured: { topics: [], people: [], places: [], dates: [] },
      concise: VALID_PAYLOAD.concise,
    };
    const { summarizer } = runnerFor(payload);

    await expect(summarizer.summarize('source')).rejects.toThrow(/claims|missing|key|structured/i);
  });

  it('throws when a structured field is not an array', async () => {
    const payload = {
      thoroughBody: VALID_PAYLOAD.thoroughBody,
      structured: { ...VALID_PAYLOAD.structured, topics: 'harbour works' },
      concise: VALID_PAYLOAD.concise,
    };
    const { summarizer } = runnerFor(payload);

    await expect(summarizer.summarize('source')).rejects.toThrow(/topics|array|structured/i);
  });

  it('throws when a structured field is a null instead of an array', async () => {
    const payload = {
      thoroughBody: VALID_PAYLOAD.thoroughBody,
      structured: { ...VALID_PAYLOAD.structured, people: null },
      concise: VALID_PAYLOAD.concise,
    };
    const { summarizer } = runnerFor(payload);

    await expect(summarizer.summarize('source')).rejects.toThrow(/people|array|null|structured/i);
  });

  it('throws when a structured array contains a non-string entry', async () => {
    const payload = {
      thoroughBody: VALID_PAYLOAD.thoroughBody,
      structured: { ...VALID_PAYLOAD.structured, dates: ['1885', 1885] },
      concise: VALID_PAYLOAD.concise,
    };
    const { summarizer } = runnerFor(payload);

    await expect(summarizer.summarize('source')).rejects.toThrow(/dates|string|array/i);
  });

  it('throws when thoroughBody is an empty string', async () => {
    const payload = { ...VALID_PAYLOAD, thoroughBody: '' };
    const { summarizer } = runnerFor(payload);

    await expect(summarizer.summarize('source')).rejects.toThrow(/thoroughBody|empty/i);
  });

  it('throws when concise is an empty string', async () => {
    const payload = { ...VALID_PAYLOAD, concise: '   ' };
    const { summarizer } = runnerFor(payload);

    await expect(summarizer.summarize('source')).rejects.toThrow(/concise|empty/i);
  });

  it('throws when thoroughBody is not a string', async () => {
    const payload = { ...VALID_PAYLOAD, thoroughBody: 42 };
    const { summarizer } = runnerFor(payload);

    await expect(summarizer.summarize('source')).rejects.toThrow(/thoroughBody|string/i);
  });

  it('throws when the parsed value is not an object', async () => {
    const { runner } = fakeRunner({
      stdout: fence(['not', 'an', 'object']),
      stderr: '',
      exitCode: 0,
    });
    const summarizer = createClaudeSummarizer(runner);

    await expect(summarizer.summarize('source')).rejects.toThrow(/object|malformed/i);
  });

  it('throws when structured is not an object', async () => {
    const payload = {
      thoroughBody: VALID_PAYLOAD.thoroughBody,
      structured: 'nope',
      concise: VALID_PAYLOAD.concise,
    };
    const { summarizer } = runnerFor(payload);

    await expect(summarizer.summarize('source')).rejects.toThrow(/structured|object/i);
  });
});

describe('createClaudeSummarizer malformed-envelope retry (spec 017)', () => {
  it('retries once when attempt 1 is a malformed envelope and attempt 2 is valid', async () => {
    // Stochastic LLM quirk (missing fence / truncation): a fresh generation
    // usually succeeds. The runner is invoked again and the good result wins.
    const { runner, calls } = sequenceRunner([MALFORMED_RESULT, VALID_RESULT]);
    const summarizer = createClaudeSummarizer(runner);

    const result: SummaryResult = await summarizer.summarize('source text');

    expect(result.thoroughBody).toBe(VALID_PAYLOAD.thoroughBody);
    expect(result.concise).toBe(VALID_PAYLOAD.concise);
    // Exactly two claude invocations: the failed attempt plus the retry.
    expect(calls).toHaveLength(2);
  });

  it('throws the last descriptive error after all attempts are malformed (called 3 times)', async () => {
    const { runner, calls } = sequenceRunner([
      MALFORMED_RESULT,
      MALFORMED_RESULT,
      MALFORMED_RESULT,
    ]);
    const summarizer = createClaudeSummarizer(runner);

    await expect(summarizer.summarize('source text')).rejects.toThrow(
      /malformed|parse|json/i,
    );
    // Bounded at MAX_ENVELOPE_ATTEMPTS (3) -- no unbounded retry.
    expect(calls).toHaveLength(3);
  });

  it('does not retry when attempt 1 is already valid (called once)', async () => {
    const { runner, calls } = sequenceRunner([VALID_RESULT]);
    const summarizer = createClaudeSummarizer(runner);

    const result = await summarizer.summarize('source text');

    expect(result.thoroughBody).toBe(VALID_PAYLOAD.thoroughBody);
    // No needless retry on the happy path.
    expect(calls).toHaveLength(1);
  });

  it('fails loud immediately on a non-zero exit (non-envelope error, no retry)', async () => {
    // A persistent claude/exec failure must surface at once -- it is NOT a
    // stochastic envelope deviation, so the retry loop must not swallow it.
    const failing: ExecResult = {
      stdout: '',
      stderr: 'authentication expired',
      exitCode: 1,
    };
    const { runner, calls } = sequenceRunner([failing, VALID_RESULT]);
    const summarizer = createClaudeSummarizer(runner);

    await expect(summarizer.summarize('source text')).rejects.toThrow(
      /authentication expired/,
    );
    // Failed hard on the first attempt -- did not retry into the valid result.
    expect(calls).toHaveLength(1);
  });
});
