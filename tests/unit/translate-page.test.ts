import { describe, it, expect } from 'vitest';
import { translatePage } from '@/translate/translate-page';
import type { TranslationEngine } from '@/engine/types';
import { TRANSFORMATION_SYSTEM_PROMPT } from '@/claude/client';

/**
 * Unit coverage for `translatePage` (T015): turns one page of CORRECTED
 * French into readable English via the injected `ClaudeCli`. All calls go
 * through a fake `ClaudeCli` -- no real `claude` binary is invoked.
 */

interface FakeCall {
  prompt: string;
  sourceText: string;
  model?: string;
  systemPrompt?: string;
}

function fakeClaudeCli(canned: string): { cli: TranslationEngine; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const cli: TranslationEngine = {
    name: 'claude-code-cli',
    run: async (prompt, sourceText, model, systemPrompt) => {
      calls.push({ prompt, sourceText, model, systemPrompt });
      return canned;
    },
  };
  return { cli, calls };
}

describe('translatePage (T015)', () => {
  it('returns the fake Claude client canned English output', async () => {
    const { cli } = fakeClaudeCli('This is the English translation.');
    const frenchText = 'Ceci est le texte français corrigé.';

    const result = await translatePage(cli, frenchText, 'some-model');

    expect(result).toBe('This is the English translation.');
  });

  it('sends the corrected French unchanged as sourceText and forwards the model', async () => {
    const { cli, calls } = fakeClaudeCli('English output');
    const frenchText = 'Ceci est le texte français corrigé.';

    await translatePage(cli, frenchText, 'some-model');

    expect(calls).toHaveLength(1);
    expect(calls[0].sourceText).toBe(frenchText);
    expect(calls[0].model).toBe('some-model');
  });

  it('omits the model when none is given', async () => {
    const { cli, calls } = fakeClaudeCli('English output');

    await translatePage(cli, 'Texte français');

    expect(calls[0].model).toBeUndefined();
  });

  it('builds a prompt directing translation to readable English', async () => {
    const { cli, calls } = fakeClaudeCli('English output');

    await translatePage(cli, 'Texte français', 'some-model');

    expect(calls[0].prompt).toMatch(/english/i);
    expect(calls[0].prompt).toMatch(/translat/i);
  });

  it('builds a prompt requiring faithfulness and forbidding summarization', async () => {
    const { cli, calls } = fakeClaudeCli('English output');

    await translatePage(cli, 'Texte français', 'some-model');

    expect(calls[0].prompt).toMatch(/faithful/i);
    expect(calls[0].prompt).toMatch(/do not summarize|not summarize/i);
    expect(calls[0].prompt).toMatch(/add|omit/i);
  });

  it('builds a prompt requiring output-only (no preamble or commentary)', async () => {
    const { cli, calls } = fakeClaudeCli('English output');

    await translatePage(cli, 'Texte français', 'some-model');

    expect(calls[0].prompt).toMatch(/english translation and nothing else/i);
    expect(calls[0].prompt).toMatch(/no preamble|no commentary|without (any )?(preamble|commentary)/i);
  });

  it('appends the output-only transformation system prompt', async () => {
    const { cli, calls } = fakeClaudeCli('English output');

    await translatePage(cli, 'Texte français', 'some-model');

    expect(calls[0].systemPrompt).toBe(TRANSFORMATION_SYSTEM_PROMPT);
    expect(calls[0].systemPrompt).toMatch(/never write any preamble/i);
  });
});
