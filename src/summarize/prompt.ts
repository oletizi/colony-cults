/**
 * Prompt(s) driving the two-depth structured summary generation (T008,
 * spec.md FR-001/FR-001a/FR-001b, SC-003). One generation flow -- one read of
 * `inputText` -- produces BOTH depths:
 *
 * - a THOROUGH finding-aid: the structured fields (topics, people, places,
 *   dates, notable claims) plus a narrative prose body (FR-001a);
 * - a CONCISE ~1-3 sentence (~60-80 word) abstract DISTILLED FROM the
 *   thorough (FR-001b) -- the concise MUST NOT introduce any topic, person,
 *   place, date, or claim absent from the thorough (SC-003, the
 *   concise/thorough distillation invariant). That instruction is baked into
 *   the prompt below, not left to the adapter to police.
 *
 * This module only BUILDS the prompt string(s); it never calls an LLM. The
 * Claude CLI adapter (T009, `src/summarize/runner-claude.ts`) is the sole
 * caller: it drives `claude --print <prompt>` with `SUMMARY_SYSTEM_PROMPT`
 * appended via `--append-system-prompt` (mirroring `createClaudeCli` in
 * `src/claude/client.ts`) and parses the model's reply back into a
 * `SummaryResult` (`src/summarize/types.ts`) using the envelope contract
 * documented below.
 *
 * ## Output envelope contract (binding on the Claude adapter's parser, T009)
 *
 * The model's ENTIRE reply MUST be exactly one fenced code block tagged
 * `json` and nothing else -- no preamble, no acknowledgement, no narration,
 * no closing remarks, no second code block, no text before or after the
 * fence. `SUMMARY_SYSTEM_PROMPT` pins this "output only the fence" behavior
 * the same way `TRANSFORMATION_SYSTEM_PROMPT` pins output-only behavior for
 * the translation pipeline (`src/claude/client.ts`).
 *
 * The fenced block's content MUST be a single JSON object with exactly these
 * keys, mapping 1:1 onto `SummaryResult`:
 *
 * ```json
 * {
 *   "thoroughBody": "<narrative prose markdown -- the finding-aid body>",
 *   "structured": {
 *     "topics": ["..."],
 *     "people": ["..."],
 *     "places": ["..."],
 *     "dates": ["..."],
 *     "claims": ["..."]
 *   },
 *   "concise": "<1-3 sentence, ~60-80 word abstract distilled from thoroughBody>"
 * }
 * ```
 *
 * Field rules the adapter's parser MUST enforce (fail loud on violation --
 * Constitution V, no fallback, no best-effort partial parse):
 *
 * - The reply MUST contain exactly one ```json fenced block; extract its
 *   content and parse it with a standard JSON parser. A reply with zero
 *   fences, more than one fence, or unparseable JSON is malformed.
 * - The parsed value MUST be a JSON object carrying exactly the three
 *   top-level keys above (`thoroughBody`, `structured`, `concise`) -- a
 *   missing key is malformed, an unexpected extra key is malformed.
 * - `structured` MUST be an object carrying exactly the five keys `topics`,
 *   `people`, `places`, `dates`, `claims`, each a JSON array of strings. An
 *   array MAY be empty (`[]`) when the input text truly yields none for that
 *   field -- an empty array is valid, but a missing key or a `null` is not.
 * - `thoroughBody` and `concise` MUST be non-empty JSON strings using
 *   standard JSON escaping (`\n` for embedded newlines, `\"` for embedded
 *   quotes) so the fenced block parses character-for-character with
 *   `JSON.parse` -- no unescaped control characters, no trailing commas.
 * - Any violation of the above -- unparseable JSON, a missing/extra key, a
 *   wrong-typed field, an empty `thoroughBody`/`concise` -- is a malformed
 *   response: the adapter throws a descriptive error (Constitution V) rather
 *   than guessing, truncating, or filling a default. It never returns a
 *   partially-populated `SummaryResult`.
 *
 * A single JSON envelope was chosen over freeform delimited sections (e.g.
 * `## Topics` / `## Concise` markdown headings) because (a) it maps directly
 * onto `SummaryResult`'s shape, so the adapter's parse step is a validated
 * `JSON.parse` plus a field-presence/type check rather than prose-section
 * splitting with its own ambiguity (heading spelling, ordering, nesting),
 * and (b) JSON arrays are the natural, unambiguous encoding for the five
 * list-valued structured fields -- a heading-delimited list would need its
 * own per-field list-parsing convention (bullets? commas? newlines?) on top.
 */

/**
 * System prompt appended via `--append-system-prompt` to pin `claude --print`
 * to emit ONLY the fenced JSON envelope for the summarization pass. Mirrors
 * `TRANSFORMATION_SYSTEM_PROMPT` (`src/claude/client.ts`): the live `claude`
 * CLI intermittently prefixes conversational narration ("I'll summarize this
 * issue...") even when the user prompt alone says "output only" -- pinning
 * the constraint at the system-prompt level suppresses that leak far more
 * reliably.
 */
export const SUMMARY_SYSTEM_PROMPT = `You are an automated summarization engine inside a document archive pipeline. You receive a source document's text and a single instruction describing the two-depth summary to produce.

Respond with ONLY one fenced code block tagged \`\`\`json, containing a single JSON object, and nothing else -- the raw result, ready to be parsed directly by a JSON parser.

Absolute rules:
- Never write any preamble, acknowledgement, or narration (no "Here is", no "I'll summarize", no "Sure").
- Never add commentary, explanations, or closing remarks before or after the fenced block.
- Never emit more than one fenced code block.
- Never wrap the JSON in anything other than a single \`\`\`json ... \`\`\` fence -- no surrounding prose, no separator lines.
- The JSON object MUST have exactly three top-level keys: "thoroughBody" (string), "structured" (object), and "concise" (string). No other top-level keys.
- "structured" MUST have exactly five keys: "topics", "people", "places", "dates", "claims" -- each a JSON array of strings (use [] when none apply; never omit a key, never use null).
- Escape the JSON strings correctly (\\n for newlines, \\" for quotes) so the block parses with a standard JSON parser, character for character.
- Begin your reply with \`\`\`json and end it with \`\`\` -- nothing before, nothing after.`;

/**
 * Builds the complete instruction prompt for one summarization pass,
 * embedding `inputText` (the acquired OCR/translation text -- the best
 * available English-bearing layer per FR-002) in a clearly delimited section.
 *
 * Unlike `TranslationEngine.run`, which takes the instruction and the source
 * text as two separate arguments (prompt on the CLI argument, source text on
 * stdin), `SummarizationRunner.summarize(inputText, model?)`
 * (`src/summarize/types.ts`) exposes only `inputText` -- so this function
 * folds both the instruction and the input text into the single returned
 * prompt string, intended to be passed whole as the `claude --print <prompt>`
 * argument (with `SUMMARY_SYSTEM_PROMPT` appended via
 * `--append-system-prompt`). The delimiter markers below let the model (and
 * a human reading the prompt) unambiguously locate where the source text
 * starts and ends, regardless of what the source text itself contains.
 *
 * @param inputText The acquired document text to summarize (English OCR, or
 *   French OCR plus its English translation already concatenated by the
 *   caller -- this function is agnostic to how the caller assembled it).
 * @returns The complete prompt string for one `claude --print` invocation.
 */
export function buildSummaryPrompt(inputText: string): string {
  return `Read the source document text below and produce a two-depth summary of it, following every rule in this instruction exactly.

## What to produce

1. A THOROUGH finding-aid: a structured account of the document (topics, people, places, dates, notable claims) plus a narrative prose body describing what the document contains, section by section. Be exhaustive -- there is no length cap on the thorough summary. This is a research finding-aid, not a teaser.
2. A CONCISE abstract: exactly 1-3 sentences, approximately 60-80 words, DISTILLED FROM the thorough finding-aid you just produced. The concise summary MUST NOT introduce any topic, person, place, date, or claim that is not already present in the thorough summary -- every statement in the concise abstract must trace back to something already stated in the thorough body or structured fields. Do not go back to the source text for new material when writing the concise summary; distill only from your own thorough output.

## Rules for the structured fields

- "topics": the subjects/themes the document covers.
- "people": named individuals mentioned in the document.
- "places": named locations mentioned in the document.
- "dates": dates or date ranges mentioned in the document, as they appear or in a normalized form.
- "claims": notable factual assertions the document makes. RECORD these as things the document says or reports -- e.g. "The article reports that..." or "The document states that..." -- do NOT phrase them as established facts, and do NOT assert them as true. A claim is what the source says, not a verified fact.
- Every field is a JSON array of strings. Use an empty array when the document truly yields nothing for that field -- never omit a field, never invent an entry to avoid an empty array.

## Other rules

- Write the ENTIRE summary -- both depths and all structured fields -- in English, regardless of what language the source document text is written in.
- Base every part of the summary strictly on the source document text below. Do not invent, assume, or add any person, place, date, topic, or claim that is not evidenced in the text. If the text is fragmentary or unclear on some point, summarize only what is actually there.
- Follow the output format given in your system instructions exactly: one fenced \`\`\`json code block, nothing else.

## Source document text

--- BEGIN SOURCE DOCUMENT TEXT ---
${inputText}
--- END SOURCE DOCUMENT TEXT ---`;
}
