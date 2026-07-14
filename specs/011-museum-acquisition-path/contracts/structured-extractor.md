# Contract: StructuredExtractor + grounding verifier

Engine-agnostic extraction over the reused `createEngine` seam (`src/engine/*`). No new agent-invocation code.

```ts
export interface StructuredExtractor<T> {
  extract(document: FetchedDocument, schema: ExtractionSchema<T>): Promise<GroundedExtraction<T>>;
}

export interface FetchedDocument {
  readonly bytes: string;     // fetched page text (whitespace-normalizable)
  readonly url: string;
}

export interface GroundedField<V> {
  value: V;
  evidence: { excerpt: string; selector?: string };  // verbatim quote of where value was found
  interpretation: string;                            // model claim: WHICH value this is (e.g. "item creation date" vs "donation date"); operator-verified, never authoritative
  provenance: {                                       // stamped per extraction
    modelAssisted: true; engine: string; model: string; promptVersion: string; at: string;
  };
}

export type GroundedExtraction<T> = { [K in keyof T]: GroundedField<T[K]> };

export interface MuseumItemFields {   // the prose-extracted museum schema
  date: string; creator?: string; description?: string; statedCredit?: string;
}
```

## Behavior

- **Engine**: built via `createEngine(name)`; **default `codex`**, model configurable via the engine config; `claude` available. Preflight failure → throw (no fallback, Principle V / FR-011).
- **Injection fencing**: `document.bytes` is passed to the engine strictly as delimited data, never as instructions (FR-009).
- **Missing vs explicit vs inferred**: an absent field is returned absent, never a fabricated blank.

## Grounding verifier (deterministic — the security teeth)

```ts
export function verifyGrounded<T>(doc: FetchedDocument, x: GroundedExtraction<T>, rightsCriticalKeys: (keyof T)[]): void;
```

- Asserts each field's `evidence.excerpt` is a verbatim substring of `doc.bytes` (whitespace-normalized).
- For each rights-critical key (e.g. `date`), asserts `evidence.excerpt` contains the field's `value` source form.
- Any failure → throw (the field is never written; FR-008, 009 INV-2). Deterministic and reproducible — no model call.

## Invariants (test targets)

- **INV-X1**: a fabricated value (excerpt not on page) → `verifyGrounded` throws.
- **INV-X2**: a real excerpt whose text does not contain a rights-critical `date` value → throws.
- **INV-X3**: identical `(doc, extraction)` inputs verify identically across runs (no model in the verifier).
- **INV-X4**: engine-absent → `extract` throws with a descriptive error.

## Semantic correctness (beyond grounding)

Substring grounding proves a value is *on the page*, not that it has the *intended meaning* — an item page may carry creation, donation, catalogue-entry, and restoration dates, all genuine substrings. The deterministic verifier confirms textual grounding only. Each field's `interpretation` (the model's claim of which value it is) MUST be confirmed by the operator at the rights-assessment step before a rights-critical field (the date) contributes to a rights judgment. The `interpretation` is a model claim, never authoritative.
