import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import type { TranslationEngine } from '@/engine/types';
import type {
  ExtractionSchema,
  FetchedDocument,
  MuseumItemFields,
} from '@/extraction/structured-extractor';
import {
  MusarchStructuredExtractor,
  MUSARCH_PROMPT_VERSION,
} from '@/repository/new-italy-museum/extractor';

/** One captured invocation of the fake engine's `run`. */
interface RunCall {
  prompt: string;
  sourceText: string;
  model?: string;
  systemPrompt?: string;
}

/**
 * A fake {@link TranslationEngine} that returns a canned reply and records the
 * arguments it received. It NEVER shells out to a real codex/claude binary.
 */
function fakeEngine(reply: string): { engine: TranslationEngine; calls: RunCall[] } {
  const calls: RunCall[] = [];
  const engine: TranslationEngine = {
    name: 'fake-engine',
    async run(prompt, sourceText, model, systemPrompt) {
      calls.push({ prompt, sourceText, model, systemPrompt });
      return reply;
    },
  };
  return { engine, calls };
}

const FIXTURE_HTML = readFileSync(
  new URL('./__fixtures__/musarch-000844.html', import.meta.url),
  'utf-8',
);

const DOCUMENT: FetchedDocument = {
  bytes: FIXTURE_HTML,
  url: 'https://newitaly.org.au/CAT/000844.htm',
};

const SCHEMA: ExtractionSchema<MuseumItemFields> = {
  fields: ['date', 'creator', 'description', 'statedCredit'],
  rightsCriticalFields: ['date'],
};

/** Build the extractor with a fixed clock + provenance labels for determinism. */
function extractorWith(reply: string): {
  extractor: MusarchStructuredExtractor;
  calls: RunCall[];
} {
  const { engine, calls } = fakeEngine(reply);
  const extractor = new MusarchStructuredExtractor({
    engine,
    engineName: 'codex',
    model: 'gpt-5.5',
    now: () => '2026-07-14T00:00:00.000Z',
  });
  return { extractor, calls };
}

describe('MusarchStructuredExtractor', () => {
  it('extracts a grounded prose date with provenance (happy path, 000844)', async () => {
    // "Pioneers Group Photo 1890" appears verbatim in the fixture and contains "1890".
    const reply = JSON.stringify({
      date: {
        value: '1890',
        evidence: {
          excerpt: 'Pioneers Group Photo 1890',
          selector: '#objectdesc',
        },
        interpretation: "the photograph's creation year, stated in the description",
      },
    });
    const { extractor } = extractorWith(reply);

    const result = await extractor.extract(DOCUMENT, SCHEMA);

    expect(result.date.value).toBe('1890');
    expect(result.date.evidence.excerpt).toBe('Pioneers Group Photo 1890');
    expect(result.date.evidence.selector).toBe('#objectdesc');
    expect(result.date.interpretation).toContain('creation year');
    expect(result.date.provenance.modelAssisted).toBe(true);
  });

  it('stamps engine/model/promptVersion/at into every field', async () => {
    const reply = JSON.stringify({
      date: {
        value: '1890',
        evidence: { excerpt: 'Pioneers Group Photo 1890' },
        interpretation: 'creation year',
      },
    });
    const { extractor } = extractorWith(reply);

    const result = await extractor.extract(DOCUMENT, SCHEMA);

    expect(result.date.provenance).toEqual({
      modelAssisted: true,
      engine: 'codex',
      model: 'gpt-5.5',
      promptVersion: MUSARCH_PROMPT_VERSION,
      at: '2026-07-14T00:00:00.000Z',
    });
  });

  it('passes page content ONLY through the sourceText data channel (injection fencing)', async () => {
    const reply = JSON.stringify({
      date: {
        value: '1890',
        evidence: { excerpt: 'Pioneers Group Photo 1890' },
        interpretation: 'creation year',
      },
    });
    const { extractor, calls } = extractorWith(reply);

    await extractor.extract(DOCUMENT, SCHEMA);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    // The full page bytes are the DATA channel, verbatim.
    expect(call.sourceText).toBe(FIXTURE_HTML);
    // The page content is NOT concatenated into the instruction or system prompt.
    expect(call.prompt).not.toContain('Pioneers Group Photo 1890');
    expect(call.prompt).not.toContain(FIXTURE_HTML);
    expect(call.systemPrompt ?? '').not.toContain(FIXTURE_HTML);
    // The instruction frames the data block as untrusted.
    expect(call.systemPrompt ?? '').toMatch(/untrusted/i);
    // The model is forwarded.
    expect(call.model).toBe('gpt-5.5');
  });

  it('extracts optional prose fields when present and grounded', async () => {
    const reply = JSON.stringify({
      date: {
        value: '1890',
        evidence: { excerpt: 'Pioneers Group Photo 1890' },
        interpretation: 'creation year',
      },
      description: {
        value: 'Pioneers Group Photo 1890',
        evidence: { excerpt: 'Pioneers Group Photo 1890' },
        interpretation: 'content description',
      },
    });
    const { extractor } = extractorWith(reply);

    const result = await extractor.extract(DOCUMENT, SCHEMA);

    expect(result.description?.value).toBe('Pioneers Group Photo 1890');
    expect(result.creator).toBeUndefined();
    expect(result.statedCredit).toBeUndefined();
  });

  it('throws when a field excerpt is NOT on the page (fabrication guard)', async () => {
    const reply = JSON.stringify({
      date: {
        value: '1890',
        evidence: { excerpt: 'Painted in 1890 by a travelling studio artist' },
        interpretation: 'creation year',
      },
    });
    const { extractor } = extractorWith(reply);

    await expect(extractor.extract(DOCUMENT, SCHEMA)).rejects.toThrow(/not grounded/i);
  });

  it('throws when the date excerpt is on the page but omits the value (mis-attribution guard)', async () => {
    // "General Collection" really appears in the fixture, but does not contain "1890".
    const reply = JSON.stringify({
      date: {
        value: '1890',
        evidence: { excerpt: 'General Collection' },
        interpretation: 'creation year',
      },
    });
    const { extractor } = extractorWith(reply);

    await expect(extractor.extract(DOCUMENT, SCHEMA)).rejects.toThrow(/mis-attributed/i);
  });

  it('throws when the engine reply is not valid JSON (fail loud)', async () => {
    const { extractor } = extractorWith('not json at all {{{');

    await expect(extractor.extract(DOCUMENT, SCHEMA)).rejects.toThrow(/not valid JSON/i);
  });

  it('throws when the engine omits the required date field', async () => {
    const reply = JSON.stringify({
      description: {
        value: 'Pioneers Group Photo 1890',
        evidence: { excerpt: 'Pioneers Group Photo 1890' },
        interpretation: 'content description',
      },
    });
    const { extractor } = extractorWith(reply);

    await expect(extractor.extract(DOCUMENT, SCHEMA)).rejects.toThrow(/omitted the required "date"/i);
  });

  it('throws when a field has the wrong shape (missing evidence)', async () => {
    const reply = JSON.stringify({
      date: { value: '1890', interpretation: 'creation year' },
    });
    const { extractor } = extractorWith(reply);

    await expect(extractor.extract(DOCUMENT, SCHEMA)).rejects.toThrow(/evidence/i);
  });
});
