import type { SummaryResult, StructuredSummaryFields } from '@/summarize/types';

/**
 * Parse the Claude summarization adapter's reply (T008 output envelope, see
 * `src/summarize/prompt.ts`) into a `SummaryResult`, enforcing the envelope
 * contract with explicit runtime validation and failing loud on any violation
 * (Constitution V -- no fallback, no best-effort partial parse). Untrusted
 * model output is narrowed with `typeof`/`Array.isArray` guards and never with
 * a type cast (`as`) -- every field is validated before it is read.
 *
 * The reply MUST be exactly one fenced ```json code block whose content is a
 * single JSON object with exactly three top-level keys (`thoroughBody`,
 * `structured`, `concise`) mapping 1:1 onto `SummaryResult`; `structured` MUST
 * carry exactly the five string-array keys; `thoroughBody` and `concise` MUST
 * be non-empty strings. Any deviation throws a descriptive `Error` naming what
 * was wrong.
 */

/** The three required top-level keys, in canonical order. */
const TOP_LEVEL_KEYS = ['thoroughBody', 'structured', 'concise'] as const;

/** The five required `structured` keys, in canonical order. */
const STRUCTURED_KEYS = ['topics', 'people', 'places', 'dates', 'claims'] as const;

/** Matches every ```json ... ``` fenced block; used to enforce exactly one. */
const JSON_FENCE_RE = /```json[ \t]*\r?\n?([\s\S]*?)```/g;

/** Type guard: a plain (non-array, non-null) object. No cast. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Type guard: an array whose every element is a string. No cast. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** Extract the single ```json fence's content, or throw if not exactly one. */
function extractLoneJsonFence(reply: string): string {
  const matches = [...reply.matchAll(JSON_FENCE_RE)];
  if (matches.length === 0) {
    throw new Error(
      'Malformed summary envelope: the model reply contained no ```json fenced ' +
        'code block. Exactly one is required.',
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Malformed summary envelope: the model reply contained ${matches.length} ` +
        '```json fenced code blocks. Exactly one is required.',
    );
  }
  return matches[0][1];
}

/**
 * Escape a single control character (U+0000-U+001F) into its shortest valid
 * JSON escape. The five characters with a dedicated escape use it; every other
 * control char becomes a `\uXXXX` unit.
 */
function escapeControlChar(code: number): string {
  switch (code) {
    case 0x08:
      return '\\b';
    case 0x09:
      return '\\t';
    case 0x0a:
      return '\\n';
    case 0x0c:
      return '\\f';
    case 0x0d:
      return '\\r';
    default:
      return '\\u' + code.toString(16).padStart(4, '0');
  }
}

/**
 * REPAIR pass for the ONE known Claude output quirk: LITERAL control characters
 * (raw newline/tab/etc.) left unescaped INSIDE a JSON string literal, which the
 * strict `JSON.parse` rejects ("Bad control character in string literal in
 * JSON"). A single-pass state machine tracks whether the cursor is inside a
 * string (toggled by unescaped `"`), honours existing backslash escapes (so a
 * valid `\n` is copied verbatim, never doubled, and an escaped `\"` never ends
 * the string), and escapes only the control chars that fall INSIDE a string.
 * Control chars OUTSIDE strings are structural and left untouched -- genuinely
 * broken output must still fail loud, so this rescues nothing it should not.
 *
 * Returns the (possibly identical) repaired text; the caller re-parses and only
 * trusts the result if it now parses.
 */
function repairControlCharsInStrings(content: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (!inString) {
      if (ch === '"') {
        inString = true;
      }
      out += ch;
      continue;
    }
    // Inside a string literal.
    if (ch === '\\') {
      // Backslash escape: copy the backslash and its escaped char verbatim so
      // an already-valid escape is never doubled and an escaped quote never
      // terminates the string. Guard the final-char edge case.
      out += ch;
      if (i + 1 < content.length) {
        out += content[i + 1];
        i++;
      }
      continue;
    }
    if (ch === '"') {
      inString = false;
      out += ch;
      continue;
    }
    const code = content.charCodeAt(i);
    if (code <= 0x1f) {
      out += escapeControlChar(code);
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Parse the fenced content as JSON, or throw naming the parse failure. On a
 * parse failure a single control-character REPAIR pass is attempted (the known
 * LLM quirk of raw control chars inside string literals) and the repaired text
 * re-parsed; if the repair changes nothing or the re-parse still fails, the
 * original descriptive error is thrown (fail loud -- strictness preserved).
 */
function parseJson(fenceContent: string): unknown {
  try {
    return JSON.parse(fenceContent);
  } catch (cause) {
    const repaired = repairControlCharsInStrings(fenceContent);
    if (repaired !== fenceContent) {
      try {
        return JSON.parse(repaired);
      } catch {
        // Repair did not yield valid JSON -- fall through and fail loud below.
      }
    }
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      'Malformed summary envelope: the json fence content was not parseable ' +
        `JSON (${detail}).`,
    );
  }
}

/** Assert an object carries exactly `expected` keys -- no missing, no extra. */
function assertExactKeys(
  obj: Record<string, unknown>,
  expected: readonly string[],
  where: string,
): void {
  for (const key of expected) {
    if (!(key in obj)) {
      throw new Error(
        `Malformed summary envelope: ${where} is missing the required key "${key}".`,
      );
    }
  }
  for (const key of Object.keys(obj)) {
    if (!expected.includes(key)) {
      throw new Error(
        `Malformed summary envelope: ${where} carried an unexpected extra key "${key}".`,
      );
    }
  }
}

/** Validate + narrow one required string-array field. No cast. */
function parseStringArray(value: unknown, field: string): string[] {
  if (!isStringArray(value)) {
    throw new Error(
      `Malformed summary envelope: "${field}" must be a JSON array of strings ` +
        '(an empty array is allowed; null, a missing key, or a non-string entry ' +
        'is not).',
    );
  }
  return value;
}

/** Validate + narrow the `structured` value into `StructuredSummaryFields`. */
function parseStructured(value: unknown): StructuredSummaryFields {
  if (!isRecord(value)) {
    throw new Error(
      'Malformed summary envelope: "structured" must be a JSON object with the ' +
        'five list-valued keys.',
    );
  }
  assertExactKeys(value, STRUCTURED_KEYS, '"structured"');

  // Narrow each field independently so the readonly result is built from
  // values proven to be string[] (no cast).
  return {
    topics: parseStringArray(value.topics, 'structured.topics'),
    people: parseStringArray(value.people, 'structured.people'),
    places: parseStringArray(value.places, 'structured.places'),
    dates: parseStringArray(value.dates, 'structured.dates'),
    claims: parseStringArray(value.claims, 'structured.claims'),
  };
}

/** Validate + narrow a required non-empty string field. */
function parseNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(
      `Malformed summary envelope: "${field}" must be a string.`,
    );
  }
  if (value.trim().length === 0) {
    throw new Error(
      `Malformed summary envelope: "${field}" must be a non-empty string.`,
    );
  }
  return value;
}

/**
 * Parse a raw model reply into a validated `SummaryResult`. Throws a
 * descriptive `Error` on any envelope-contract violation.
 */
export function parseSummaryEnvelope(reply: string): SummaryResult {
  const fenceContent = extractLoneJsonFence(reply);
  const parsed = parseJson(fenceContent);

  if (!isRecord(parsed)) {
    throw new Error(
      'Malformed summary envelope: the ```json fence content must be a single ' +
        'JSON object (not an array, string, number, or null).',
    );
  }
  assertExactKeys(parsed, TOP_LEVEL_KEYS, 'the summary object');

  return {
    thoroughBody: parseNonEmptyString(parsed.thoroughBody, 'thoroughBody'),
    structured: parseStructured(parsed.structured),
    concise: parseNonEmptyString(parsed.concise, 'concise'),
  };
}
