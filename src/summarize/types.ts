/** Summarizer selector value (CLI/config). v1 wires 'claude'; room to add 'codex' later. */
export type SummarizerName = 'claude';

/**
 * Structured account extracted from the input text (thorough frontmatter,
 * FR-001a). `claims` are recorded, not asserted (Constitution I/II — no
 * conversion to fact).
 */
export interface StructuredSummaryFields {
  readonly topics: readonly string[];
  readonly people: readonly string[];
  readonly places: readonly string[];
  readonly dates: readonly string[];
  readonly claims: readonly string[];
}

/**
 * One generation's two-depth output: the thorough (structured + prose) and
 * the concise distilled from that same generation (SC-003 — the concise
 * MUST NOT introduce a claim absent from the thorough).
 */
export interface SummaryResult {
  readonly thoroughBody: string;
  readonly structured: StructuredSummaryFields;
  readonly concise: string;
}

/**
 * A pluggable summarization engine: one adapter per backend CLI. `name` is
 * the provenance label recorded in each artifact's `.yml` (e.g.
 * "claude-code-cli"). `summarize` is one instruction+inputText
 * transformation call producing both depths in a single pass.
 */
export interface SummarizationRunner {
  readonly name: string;
  summarize(inputText: string, model?: string): Promise<SummaryResult>;
}
