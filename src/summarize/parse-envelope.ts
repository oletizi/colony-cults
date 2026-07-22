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

/** Parse the fenced content as JSON, or throw naming the parse failure. */
function parseJson(fenceContent: string): unknown {
  try {
    return JSON.parse(fenceContent);
  } catch (cause) {
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
