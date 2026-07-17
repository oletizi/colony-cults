import { describe, it, expect } from 'vitest';
import {
  assessOcrQuality,
  aspellLanguageFor,
  tierFor,
} from '@/ocr/quality';
import type { OcrCommandRunner } from '@/ocr/types';
import type { ExecResult } from '@/ocr/exec';

/**
 * Unit coverage for the computed OCR fidelity score. `aspell` is faked via the
 * injected runner (it echoes the "misspelled" tokens on stdin), so no real
 * aspell is required.
 */

/** A fake aspell that reports the given token set as misspelled. */
function fakeAspell(misspelled: string[]): {
  runner: OcrCommandRunner;
  calls: Array<{ command: string; args: string[]; stdin?: string }>;
} {
  const calls: Array<{ command: string; args: string[]; stdin?: string }> = [];
  const runner: OcrCommandRunner = {
    run: async (command, args, stdin): Promise<ExecResult> => {
      calls.push({ command, args, stdin });
      const input = (stdin ?? '').split('\n').filter(Boolean);
      const bad = input.filter((t) => misspelled.includes(t));
      return { stdout: bad.join('\n'), stderr: '', exitCode: 0 };
    },
  };
  return { runner, calls };
}

describe('aspellLanguageFor', () => {
  it('maps tesseract codes to aspell codes (primary of a +-set)', () => {
    expect(aspellLanguageFor('fra')).toBe('fr');
    expect(aspellLanguageFor('eng')).toBe('en');
    expect(aspellLanguageFor('eng+fra')).toBe('en');
  });
  it('fails loud on an unmapped language', () => {
    expect(() => aspellLanguageFor('xyz')).toThrow(/no aspell dictionary/i);
  });
});

describe('tierFor', () => {
  it('maps ratios to tiers at the thresholds', () => {
    expect(tierFor(0.5)).toBe('low');
    expect(tierFor(0.69)).toBe('low');
    expect(tierFor(0.7)).toBe('medium');
    expect(tierFor(0.84)).toBe('medium');
    expect(tierFor(0.85)).toBe('high');
    expect(tierFor(0.95)).toBe('high');
  });
});

describe('assessOcrQuality', () => {
  it('scores the real-word ratio from aspell and derives the tier', async () => {
    // 5 tokens; aspell flags 2 -> ratio 0.6 -> low.
    const { runner, calls } = fakeAspell(['Xqz', 'ffff']);
    const q = await assessOcrQuality(
      'the quick Xqz brown ffff',
      'eng',
      runner,
    );
    expect(q).toEqual({
      method: 'aspell-realword-ratio-v1',
      language: 'en',
      ratio: 0.6,
      tier: 'low',
    });
    // Scored against the mapped dictionary, tokens piped on stdin.
    expect(calls[0].command).toBe('aspell');
    expect(calls[0].args).toEqual(['-l', 'en', 'list']);
  });

  it('scores clean text as high', async () => {
    const { runner } = fakeAspell([]);
    const q = await assessOcrQuality('le siecle actuel tend', 'fra', runner);
    expect(q.ratio).toBe(1);
    expect(q.tier).toBe('high');
    expect(q.language).toBe('fr');
  });

  it('treats a token-less (blank) page as ratio 1 without calling aspell', async () => {
    const { runner, calls } = fakeAspell([]);
    const q = await assessOcrQuality('  \n 12 . -- \n', 'fra', runner);
    expect(q.ratio).toBe(1);
    expect(q.tier).toBe('high');
    expect(calls).toHaveLength(0);
  });

  it('fails loud when aspell exits non-zero', async () => {
    const runner: OcrCommandRunner = {
      run: async () => ({ stdout: '', stderr: 'boom', exitCode: 1 }),
    };
    await expect(
      assessOcrQuality('some real words here', 'eng', runner),
    ).rejects.toThrow(/aspell .* failed/i);
  });
});
