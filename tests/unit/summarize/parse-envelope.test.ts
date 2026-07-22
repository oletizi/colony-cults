import { describe, it, expect } from 'vitest';
import { parseSummaryEnvelope } from '@/summarize/parse-envelope';

/**
 * Unit coverage for the envelope parser's control-character REPAIR pass
 * (spec 017). The Claude model occasionally emits an otherwise well-formed
 * envelope whose JSON string values carry LITERAL control characters (a raw
 * newline or tab inside a value) -- "Bad control character in string literal
 * in JSON". The parser first tries a strict `JSON.parse`; on failure it runs a
 * single-pass state machine that escapes ONLY control chars appearing INSIDE
 * string literals, then re-parses. Valid JSON is never touched; genuinely
 * broken JSON still throws (strictness preserved, Constitution V).
 *
 * Control and escape-relevant characters are built via `String.fromCharCode`
 * so the raw bytes land in the constructed JSON text without smuggling literal
 * control characters into this source file.
 */

const NL = String.fromCharCode(0x0a); // a real newline
const TAB = String.fromCharCode(0x09); // a real tab
const BS = String.fromCharCode(0x5c); // a single backslash
const QUOTE = '"';
const U0001 = String.fromCharCode(0x01); // a bare control char (structural)

/** A minimal, valid `structured` block as raw JSON text (no control chars). */
const STRUCTURED_JSON =
  '"structured": { "topics": ["t"], "people": [], "places": [], "dates": [], "claims": [] }';

/** Wrap raw JSON text (built by hand so control chars survive) in a json fence. */
function fence(rawJsonText: string): string {
  return '```json\n' + rawJsonText + '\n```';
}

describe('parseSummaryEnvelope control-character repair (spec 017)', () => {
  it('repairs a LITERAL newline inside thoroughBody and preserves it as content', () => {
    // A REAL newline sits inside the JSON string literal -- invalid JSON as
    // emitted, the exact quirk the model produces.
    const raw =
      '{ "thoroughBody": "line one' +
      NL +
      'line two", ' +
      STRUCTURED_JSON +
      ', "concise": "a concise summary" }';

    const result = parseSummaryEnvelope(fence(raw));

    // The newline is preserved as content (repaired to an escape, not dropped).
    expect(result.thoroughBody).toBe('line one' + NL + 'line two');
    expect(result.concise).toBe('a concise summary');
  });

  it('repairs a LITERAL tab inside the concise value', () => {
    const raw =
      '{ "thoroughBody": "body text", ' +
      STRUCTURED_JSON +
      ', "concise": "col1' +
      TAB +
      'col2" }';

    const result = parseSummaryEnvelope(fence(raw));

    expect(result.concise).toBe('col1' + TAB + 'col2');
  });

  it('leaves an already-escaped newline untouched (no double-escape) on valid JSON', () => {
    // The JSON text carries a VALID escape (backslash + n). JSON.parse succeeds
    // on the first pass; the repair must never run and never double the escape.
    const raw =
      '{ "thoroughBody": "line one' +
      BS +
      'n' +
      'line two", ' +
      STRUCTURED_JSON +
      ', "concise": "c" }';

    const result = parseSummaryEnvelope(fence(raw));

    // Exactly one real newline in the decoded value -- not a doubled escape.
    expect(result.thoroughBody).toBe('line one' + NL + 'line two');
    expect(result.thoroughBody).not.toContain(BS + 'n');
  });

  it('repairs an escaped quote followed by a raw newline (state machine respects the escape)', () => {
    // Adversarial: an escaped quote (backslash + ") inside the string must NOT
    // be read as the string terminator; the raw newline that follows is still
    // inside the string and must be escaped by the repair.
    const raw =
      '{ "thoroughBody": "she said ' +
      BS +
      QUOTE +
      'hi' +
      BS +
      QUOTE +
      NL +
      'and left", ' +
      STRUCTURED_JSON +
      ', "concise": "c" }';

    const result = parseSummaryEnvelope(fence(raw));

    expect(result.thoroughBody).toBe('she said "hi"' + NL + 'and left');
  });

  it('still throws on genuinely broken JSON (unbalanced braces)', () => {
    // No control chars: the repair pass produces identical text and the strict
    // parse still fails -- fail loud, no rescue of structurally-broken output.
    const raw =
      '{ "thoroughBody": "body", ' + STRUCTURED_JSON + ', "concise": "c" ';

    expect(() => parseSummaryEnvelope(fence(raw))).toThrow(/malformed|parse|json/i);
  });

  it('still throws on a control char OUTSIDE any string (structural)', () => {
    // A U+0001 sits between tokens, outside every string literal. The repair
    // only touches inside-string control chars, so this structural garbage
    // survives and the strict parse still fails.
    const raw =
      '{ "thoroughBody": "body", ' +
      U0001 +
      STRUCTURED_JSON +
      ', "concise": "c" }';

    expect(() => parseSummaryEnvelope(fence(raw))).toThrow(/malformed|parse|json/i);
  });

  it('preserves all envelope schema validation after repair (empty thoroughBody still throws)', () => {
    // The repair fixes only JSON.parse; the schema checks run AFTER it. An
    // envelope that parses post-repair but violates the contract still fails.
    const raw =
      '{ "thoroughBody": "' +
      NL +
      '", ' +
      STRUCTURED_JSON +
      ', "concise": "c" }';

    // After repair the thoroughBody decodes to a lone newline -> trims empty.
    expect(() => parseSummaryEnvelope(fence(raw))).toThrow(/thoroughBody|empty/i);
  });
});
