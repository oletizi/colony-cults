# Contract: Typst input + template invocation

The seam between our TypeScript data layer and the Typst template. Our side serializes an `Edition`
to a stable JSON input; Typst composes the PDF from it. The template's *visual design* is authored
via `/frontend-design` (Constitution XI) — this contract fixes only the **data interface** and the
**invocation**, not typography.

```ts
// src/pdf/render/typst-input.ts
export function toTypstInput(edition: Edition): TypstInput;   // stable, sorted-key JSON-serializable
export function serializeTypstInput(input: TypstInput): string;

// src/pdf/render/typst-runner.ts
export interface TypstRunner { compile(req: CompileRequest): Promise<CompileResult>; }
export interface CompileRequest { templatePath: string; inputPath: string; imageDir: string; outPath: string; }
export interface CompileResult { outPath: string; }
export function makeTypstRunner(exec: ExecRunner): TypstRunner; // shells `typst compile`, DI
```

## Guarantees

- **G-1 (facing-page structure)**: `TypstInput` presents each source page as a verso image + a recto
  `{ ocrFrench, english }` pair, in page order — the data shape the facing-page template consumes
  (FR-002). Verso and recto for a page are never split across non-facing leaves.
- **G-2 (scan is authoritative)**: the input marks the scan as the page's primary element and carries
  the machine-derived labels for OCR and translation, so the template can render the required
  "machine-derived" apparatus labeling (FR-003, SC-003).
- **G-3 (provenance carried)**: `TypstInput` includes the `TitlePageMeta` and `ColophonMeta` verbatim
  so the title page and colophon render with full provenance (FR-004, FR-005).
- **G-4 (stable serialization)**: `serializeTypstInput` emits sorted-key JSON so identical `Edition`s
  produce byte-identical input — a precondition for reproducible PDFs (SC-004), mirroring the
  snapshot's `serializeSnapshot`.
- **G-5 (runner shells out, fails loud)**: `makeTypstRunner` invokes the external `typst compile` via
  the injected `ExecRunner`; a missing binary or non-zero exit throws with Typst's stderr surfaced
  verbatim (Principle V/VIII). No layout is reimplemented in TypeScript.
- **G-6 (embed-permissive fonts only)**: the template references only fonts vendored under
  `pdf/template/fonts/` that are licensed for embedding + redistribution (FR-014).

**Fixture**: `tests/unit/pdf/typst-input.test.ts` asserts G-1/G-3/G-4 on a built `Edition` (structure
+ stable-serialization). `tests/integration/pdf/` uses a fake `TypstRunner` to assert G-5's contract
(request shape, error surfacing) without requiring the Typst binary in CI.
