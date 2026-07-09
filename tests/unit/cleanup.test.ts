import { describe, it, expect } from 'vitest';
import { cleanupPage } from '@/translate/cleanup';
import type { ClaudeCli } from '@/claude/client';
import { TRANSFORMATION_SYSTEM_PROMPT } from '@/claude/client';

/**
 * Unit coverage for `cleanupPage` (T014): builds a French-cleanup
 * instruction prompt and delegates to the injected `ClaudeCli`, passing the
 * raw page text as the source text (stdin) and forwarding the model. All
 * calls go through a fake `ClaudeCli` -- no real `claude` binary is invoked.
 */

interface FakeCall {
  prompt: string;
  sourceText: string;
  model: string | undefined;
  systemPrompt: string | undefined;
}

function fakeClaudeCli(canned: string): { claude: ClaudeCli; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const claude: ClaudeCli = {
    name: 'claude-code-cli',
    run: async (prompt, sourceText, model, systemPrompt) => {
      calls.push({ prompt, sourceText, model, systemPrompt });
      return canned;
    },
  };
  return { claude, calls };
}

// A canned corrected-French output long enough to clear the transform
// degenerate-output ratio guard against `rawText` (prompt-shape tests only
// assert on the request, not this value).
const CANNED_FR =
  'Ceci est un exemple de texte OCR corrigé, dépourvu de coupures de lignes.';

describe('cleanupPage (T014)', () => {
  const rawText =
    'Ceci est un exemple de tex-\nte OCR bru-\ntal avec des cou-\npures de li-\ngnes.\nContraste insuffisant';

  it('returns the fake claude client output', async () => {
    const { claude } = fakeClaudeCli('Ceci est un exemple de texte OCR brutal avec des coupures de lignes.');

    const result = await cleanupPage(claude, rawText, 'some-model');

    expect(result).toBe(
      'Ceci est un exemple de texte OCR brutal avec des coupures de lignes.',
    );
  });

  it('forwards the raw page text unchanged as sourceText and forwards the model', async () => {
    const { claude, calls } = fakeClaudeCli(CANNED_FR);

    await cleanupPage(claude, rawText, 'some-model');

    expect(calls).toHaveLength(1);
    expect(calls[0].sourceText).toBe(rawText);
    expect(calls[0].model).toBe('some-model');
  });

  it('omits the model when none is given', async () => {
    const { claude, calls } = fakeClaudeCli(CANNED_FR);

    await cleanupPage(claude, rawText);

    expect(calls[0].model).toBeUndefined();
  });

  it('builds a prompt instructing dehyphenation of line-broken words', async () => {
    const { claude, calls } = fakeClaudeCli(CANNED_FR);

    await cleanupPage(claude, rawText);

    expect(calls[0].prompt).toMatch(/dehyphenate/i);
  });

  it('builds a prompt instructing joining broken lines into natural paragraphs', async () => {
    const { claude, calls } = fakeClaudeCli(CANNED_FR);

    await cleanupPage(claude, rawText);

    expect(calls[0].prompt).toMatch(/join.*lines?/i);
  });

  it('builds a prompt instructing repair of obvious OCR scan errors', async () => {
    const { claude, calls } = fakeClaudeCli(CANNED_FR);

    await cleanupPage(claude, rawText);

    expect(calls[0].prompt).toMatch(/scan error/i);
  });

  it('builds a prompt instructing removal of OCR condition/artifact markers', async () => {
    const { claude, calls } = fakeClaudeCli(CANNED_FR);

    await cleanupPage(claude, rawText);

    expect(calls[0].prompt).toMatch(/condition marker/i);
  });

  it('builds a prompt that requires faithfulness -- no translate/summarize/add/remove', async () => {
    const { claude, calls } = fakeClaudeCli(CANNED_FR);

    await cleanupPage(claude, rawText);

    expect(calls[0].prompt).toMatch(/do not translate/i);
    expect(calls[0].prompt).toMatch(/faithful/i);
  });

  it('builds a prompt that requires outputting only the corrected French text', async () => {
    const { claude, calls } = fakeClaudeCli(CANNED_FR);

    await cleanupPage(claude, rawText);

    expect(calls[0].prompt).toMatch(/corrected french text and nothing else/i);
    expect(calls[0].prompt).toMatch(/no preamble/i);
  });

  it('appends the output-only transformation system prompt', async () => {
    const { claude, calls } = fakeClaudeCli(CANNED_FR);

    await cleanupPage(claude, rawText, 'some-model');

    expect(calls[0].systemPrompt).toBe(TRANSFORMATION_SYSTEM_PROMPT);
    expect(calls[0].systemPrompt).toMatch(/never write any preamble/i);
  });
});
