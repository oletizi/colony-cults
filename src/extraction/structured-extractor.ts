/**
 * Structured extraction contract types.
 *
 * Engine-agnostic extraction over the reused `createEngine` seam.
 * All types are immutable by design (readonly fields) to prevent accidental mutation.
 */

/**
 * A fetched document with page text and source URL.
 * The bytes field holds fetched page text (whitespace-normalizable).
 */
export interface FetchedDocument {
  readonly bytes: string;
  readonly url: string;
}

/**
 * A single grounded field within an extraction.
 *
 * The value is extracted from the document.
 * Evidence links the value to a verbatim excerpt on the page.
 * Interpretation is a model claim of WHICH value this is (e.g. "item creation date" vs "donation date").
 * This interpretation is operator-verified, never authoritative — it is a model claim only.
 * Provenance stamps the extraction metadata (engine, model, version, timestamp).
 */
export interface GroundedField<V> {
  value: V;
  evidence: {
    /** Verbatim quote of where the value was found on the page. */
    excerpt: string;
    /** Optional CSS selector or reference to the location of the excerpt. */
    selector?: string;
  };
  /**
   * Model claim of which semantic value this is (e.g. "item creation date" vs "donation date").
   * Operator-verified, never authoritative. Must be confirmed by rights assessment before
   * contributing to any rights judgment.
   */
  interpretation: string;
  /**
   * Provenance metadata stamped per extraction.
   * Immutable to enforce reproducibility and auditability.
   */
  provenance: {
    readonly modelAssisted: true;
    readonly engine: string;
    readonly model: string;
    readonly promptVersion: string;
    readonly at: string;
  };
}

/**
 * A complete grounded extraction over schema T.
 * Maps each field key in T to its corresponding GroundedField.
 * Missing fields are returned absent, never fabricated as blanks.
 */
export type GroundedExtraction<T> = {
  [K in keyof T]: GroundedField<T[K]>;
};

/**
 * The prose-extracted museum item schema.
 * Defines the set of fields that can be extracted from museum acquisition documents.
 */
export interface MuseumItemFields {
  /** Item creation or other key temporal reference (rights-critical). */
  date: string;
  /** Creator, artist, or maker (optional). */
  creator?: string;
  /** Description or content summary (optional). */
  description?: string;
  /** Stated credit, donor, or attribution line (optional). */
  statedCredit?: string;
}

/**
 * A minimal descriptor that the extractor uses to know which fields to extract.
 * Specifies the schema shape and identifies fields that are critical for rights assessment.
 */
export interface ExtractionSchema<T> {
  /**
   * List of field keys to extract from the document.
   */
  fields: (keyof T)[];
  /**
   * List of field keys whose grounding must be verified with high confidence.
   * These fields are critical for rights assessment and must be operator-verified
   * before contributing to any rights judgment.
   */
  rightsCriticalFields: (keyof T)[];
}

/**
 * Engine-agnostic structured extraction interface.
 * Extracts and grounds field values from a fetched document against a schema.
 *
 * Behavior:
 * - Engine is built via `createEngine(name)` (default: "codex", model configurable).
 * - Preflight failure throws (no fallback, Principle V / FR-011).
 * - Document bytes are passed strictly as delimited data, never as instructions (FR-009).
 * - Missing fields are returned absent, never fabricated (Principle IV).
 */
export interface StructuredExtractor<T> {
  /**
   * Extract grounded fields from a document.
   * @param document The fetched document to extract from.
   * @param schema The extraction schema defining which fields to extract.
   * @returns A promise resolving to the grounded extraction over schema T.
   * @throws If engine is unavailable or any preflight check fails.
   */
  extract(
    document: FetchedDocument,
    schema: ExtractionSchema<T>,
  ): Promise<GroundedExtraction<T>>;
}
