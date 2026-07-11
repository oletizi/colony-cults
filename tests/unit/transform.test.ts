import { describe, it, expect } from 'vitest';
import type { TranslationEngine } from '@/engine/types';
import {
  runFaithfulTransformation,
  translatableLength,
  DEGENERATE_MIN_RATIO,
  MAX_TRANSFORM_ATTEMPTS,
} from '@/translate/transform';

/**
 * Unit coverage for the degenerate-output retry guard (real-CLI hardening):
 * the live `claude` intermittently returns a tiny fragment instead of the
 * full transform; the guard retries and fails loud rather than emitting the
 * truncated result. All calls go through a fake `ClaudeCli`.
 */

interface FakeCall {
  prompt: string;
  sourceText: string;
  model: string | undefined;
  systemPrompt: string | undefined;
}

/** Fake that returns each queued output in turn (last one repeats). */
function fakeClaudeCli(outputs: string[]): {
  claude: TranslationEngine;
  calls: FakeCall[];
} {
  const calls: FakeCall[] = [];
  const claude: TranslationEngine = {
    name: 'claude-code-cli',
    run: async (prompt, sourceText, model, systemPrompt) => {
      calls.push({ prompt, sourceText, model, systemPrompt });
      const i = Math.min(calls.length - 1, outputs.length - 1);
      return outputs[i];
    },
  };
  return { claude, calls };
}

const SOURCE = 'x'.repeat(1000); // 1000-char source; threshold = 250 at 0.25
const FULL = 'y'.repeat(950); // ~source length -> well above threshold
const TINY = 'fragment'; // 8 chars -> far below threshold

describe('runFaithfulTransformation', () => {
  it('returns the output on the first non-degenerate attempt (single call)', async () => {
    const { claude, calls } = fakeClaudeCli([FULL]);

    const out = await runFaithfulTransformation(
      claude,
      'instruction',
      SOURCE,
      'some-model',
      'system',
    );

    expect(out).toBe(FULL);
    expect(calls).toHaveLength(1);
  });

  it('retries a degenerate result and returns the first full one', async () => {
    const { claude, calls } = fakeClaudeCli([TINY, TINY, FULL]);

    const out = await runFaithfulTransformation(
      claude,
      'instruction',
      SOURCE,
      undefined,
      'system',
    );

    expect(out).toBe(FULL);
    expect(calls).toHaveLength(3);
  });

  it('throws loud after MAX_TRANSFORM_ATTEMPTS if every result is degenerate', async () => {
    const { claude, calls } = fakeClaudeCli([TINY]);

    await expect(
      runFaithfulTransformation(claude, 'instruction', SOURCE, undefined, 'system'),
    ).rejects.toThrow(/degenerate\/truncated result after 3 attempts/i);
    expect(calls).toHaveLength(MAX_TRANSFORM_ATTEMPTS);
  });

  it('forwards instruction, sourceText, model, and systemPrompt to the client', async () => {
    const { claude, calls } = fakeClaudeCli([FULL]);

    await runFaithfulTransformation(
      claude,
      'the-instruction',
      SOURCE,
      'the-model',
      'the-system',
    );

    expect(calls[0].prompt).toBe('the-instruction');
    expect(calls[0].sourceText).toBe(SOURCE);
    expect(calls[0].model).toBe('the-model');
    expect(calls[0].systemPrompt).toBe('the-system');
  });

  it('accepts a short output when the source is itself short (ratio, not absolute)', async () => {
    // A genuinely terse page: short source -> short output keeps ratio ~1.
    const shortSource = 'Page blanche.';
    const shortOutput = 'Blank page.';
    const { claude, calls } = fakeClaudeCli([shortOutput]);

    const out = await runFaithfulTransformation(
      claude,
      'instruction',
      shortSource,
      undefined,
      'system',
    );

    expect(out).toBe(shortOutput);
    expect(calls).toHaveLength(1);
  });

  it('accepts a short caption for an OCR-noise-heavy plate page (translatable, not raw, length)', async () => {
    // A real illustration/plate page (e.g. an engraved autograph): its OCR is
    // ~190 raw chars, but almost all of it is scattered single-/double-char
    // noise -- only the caption is real words. A faithful transform is the
    // short caption. Under a RAW-length threshold (190*0.25=47) this 28-char
    // output would be wrongly rejected as truncated; under the translatable-
    // length threshold it passes.
    // ~160 chars of pure OCR noise (no >=3-letter run) + a 4-word caption.
    const noise = '. '.repeat(80);
    const plateSource = `${noise}Breton Autographe notaire Chambaud`;
    const caption = 'Autograph of the notary Chambaud';
    // Guard the premise: raw length WOULD reject (raw >> caption/ratio), but
    // the translatable-length threshold accepts the faithful caption.
    expect(plateSource.length).toBeGreaterThan(caption.length / DEGENERATE_MIN_RATIO);
    expect(translatableLength(caption)).toBeGreaterThanOrEqual(
      Math.floor(translatableLength(plateSource) * DEGENERATE_MIN_RATIO),
    );

    const { claude, calls } = fakeClaudeCli([caption]);
    const out = await runFaithfulTransformation(
      claude,
      'instruction',
      plateSource,
      undefined,
      'system',
    );

    expect(out).toBe(caption);
    expect(calls).toHaveLength(1);
  });

  it('still catches a truncated fragment of a genuine dense text page', async () => {
    // A dense page (all real words) truncated to a fragment is STILL caught --
    // the fix must not weaken real truncation detection.
    const denseSource = ('mot '.repeat(400)).trim(); // ~1600 translatable chars
    const fragment = 'Chapitre premier.'; // a tiny real fragment
    const { claude } = fakeClaudeCli([fragment]);

    await expect(
      runFaithfulTransformation(claude, 'instruction', denseSource, undefined, 'system'),
    ).rejects.toThrow(/degenerate\/truncated/i);
  });

  it('honors an overridden minRatio/maxAttempts', async () => {
    const { claude, calls } = fakeClaudeCli([TINY, FULL]);

    const out = await runFaithfulTransformation(
      claude,
      'instruction',
      SOURCE,
      undefined,
      'system',
      { minRatio: DEGENERATE_MIN_RATIO, maxAttempts: 2 },
    );

    expect(out).toBe(FULL);
    expect(calls).toHaveLength(2);
  });
});
