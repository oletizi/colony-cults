# Design: Asset Summaries (`impl:feature/asset-summaries`)

- Date: 2026-07-21
- Roadmap item: `impl:feature/asset-summaries`
- Depends-on: `impl:feature/corpus-browser` (website display), and consumes the
  shipped `source-group-acquisition` / `gallica-fetcher` / `archive-object-store`
  (acquired OCR), `source-translation` (English translations), `canonical-source-metadata`
  (bibliography SSOT), `corpus-coverage-audit` (evidence-class link).
- Status: designing (awaiting operator approval marker)
- Backend: `superpowers:brainstorming` via `/stack-control:design`; browser display
  routed to `/frontend-design` at build (Constitution XI).

## Problem domain

The acquired corpus — newspaper issues and monographs, in French and (now) English —
is readable **page by page** (facsimile + OCR + translation), but there is no
**condensed, human-readable account of what each document contains**. A researcher
cannot quickly learn "what is in this issue" without reading it; the website shows no
abstract; the bibliography catalog carries structured metadata (title, creator, date,
rights) but no substantive content description. LLMs can produce such accounts from
the acquired text — but only as **interpretation**: machine-generated, machine-labeled,
kept separate from the evidence and never asserted as fact (Constitution I & III). The
authoritative record remains the scans + OCR; a summary is a finding-aid over them.

Two distinct consumers want different depths: the **website** wants a *concise* abstract
per issue; the **bibliography** wants a *thorough, exhaustive* research summary.

## Solution space

### Chosen — per-issue two-depth LLM summaries (concise → website, thorough → bibliography)

- **Unit: per issue / document.** Each newspaper issue gets one summary; each book is one
  document. Matches the reading-view unit and serial navigation.
- **Two depths from one generation flow.** One LLM pass produces the **thorough /
  exhaustive** summary from the best available acquired text; the **concise** summary is
  **distilled from the thorough** — so the two never disagree and we do not pay for two
  full-text passes.
- **Input: the best available acquired text, output English.** English OCR for
  English-language sources (e.g. the Papers Past NZ-press / Trove items); French OCR
  **plus** the English translation where it exists for French sources. Fail loud if an
  issue has no usable text layer (no fabricated summary — Principle V).
- **Storage: machine-labeled companion artifacts** in the archive, alongside the OCR /
  translation companions — e.g. `issue.summary.long.en.md` + `issue.summary.short.en.md`
  — each with a **provenance sidecar** (engine, model, date, input-layers-used, and an
  explicit "machine-generated summary — interpretation, not evidence" label). The
  **bibliography *references* the thorough summary** (does not inline exhaustive prose
  into the source YAML — the SSOT is structured metadata, not long-form text). The
  **website reads the concise** summary.
- **Per-source rollup.** A concise + thorough summary per *source* (a landing-page
  abstract of the whole run / book), synthesized from the issue summaries.
- **Injected `SummarizationRunner`** (Claude via API), shelled behind an interface with
  constructor injection — mirroring how OCR / translation engines are already composed
  (Constitution VI); swappable and configurable.
- **Resumable / idempotent**, keyed to the input layers: skip an already-summarized issue;
  regenerate when its OCR / translation changes (same discipline as OCR / translation).
- **v1 scope**: the corpus-browser's shipped set (PB-P001 issues + the monographs + the
  new English-language Papers Past items), with the pipeline generalized so any source
  slots in.
- Browser display of the abstract is UI → its build goes through **`/frontend-design`**
  (Constitution XI). Type-safe throughout (`@/`, no `any`, files ≤ 300–500).

### Rejected — a single summary depth

One length for both consumers. Rejected: the operator explicitly wants a *concise*
website abstract and a *thorough, exhaustive* bibliography summary; a single depth
under-serves one and over-serves the other.

### Rejected — inline the thorough summary into the source YAML (SSOT)

Store the exhaustive prose directly in `bibliography/sources/*.yml`. Rejected: it bloats
the structured SSOT with long-form text and couples catalog metadata to generated prose;
a referenced companion artifact keeps the SSOT clean and the summary regenerable.
(Left as the one operator-flagged call; operator confirmed reference-not-inline.)

### Rejected — vision-from-images summarization

Feed page images to a vision LLM. Rejected for v1: more expensive (vision + B2 Class-B
reads) and unnecessary when the acquired OCR / translation text is sufficient for a
textual finding-aid. Kept as a **future option** for image-heavy or badly-OCR'd assets.

### Rejected — per-page or per-source-only unit

Per-page: too granular, noisiest input, hundreds of tiny summaries and the most LLM
calls. Per-source-only: loses the issue-level granularity the reading view and serial
navigation need. Per-issue (with a per-source rollup) is the balance.

### Rejected — treating summaries as evidence

Rejected on constitutional grounds (I / III): an LLM summary is interpretation and must
be machine-labeled, provenance-stamped, and kept separate from the authoritative
scans / OCR — never converted to fact.

## Decisions

1. **Per-issue** unit (each issue; each book); plus a **per-source rollup**.
2. **Two depths** — thorough (bibliography finding-aid) + concise (website abstract);
   the concise is **distilled from the thorough** in one generation flow.
3. **Input**: best available acquired text (English OCR for English sources; French OCR
   + English translation where present); **output English**; fail loud on no text layer.
4. **Storage**: machine-labeled companion artifacts + provenance sidecar in the archive;
   bibliography **references** the thorough; website reads the concise.
5. **Injected `SummarizationRunner`** (Claude API), composed/DI; **resumable/idempotent**
   keyed to input layers.
6. **Machine-labeled interpretation, never evidence** (I/III); **fail loud, no fallback**
   (V); **type-safe** (VII); **browser display via `/frontend-design`** (XI).
7. **v1** = the shipped browser corpus incl. the English-language Papers Past items;
   generalized so any source slots in.

## Open questions

_Carry into `/stack-control:define`; none are blockers._

- **Thorough-summary shape**: freeform prose vs a structured account (topics, people,
  places, dates, notable claims) — the structured form could feed evidence-class /
  discovery (gap-closure) and the audit.
- **Concise length target** (e.g. 1–3 sentences / a word budget) and the thorough's
  expected extent.
- **Exact companion + provenance schema** (file naming, sidecar fields) and how the
  bibliography record references the thorough summary.
- **Per-source rollup** generation: synthesized from the issue summaries vs a separate
  pass; when it runs.
- **LLM / model choice + cost/rate envelope.** Note: summarization reads **local** text
  and calls an LLM API — it is NOT an external *source* query, so it uses a dedicated
  `SummarizationRunner`, not the spec-014 governed source-query client (that governs
  fetches *from sources*). Confirm this boundary in define.
- **Noisy-OCR handling**: a quality threshold / low-confidence note in provenance; when
  to defer to the future vision option.
- **Non-public-domain sources**: a summary is interpretation, not a reproduction — likely
  permissible even for cataloged-but-not-mirrored sources (a summary of a restricted work
  is fair), but confirm the rights posture in define.
- **Interaction with `corpus-gap-closure`**: whether structured summaries feed evidence-
  class assignment / thematic discovery.

## Provenance

- Origin: interactive `superpowers:brainstorming` via `/stack-control:design`, 2026-07-21.
  Decisions from operator answers to `AskUserQuestion` prompts (unit = per-issue; input =
  OCR + translation where present; home = archive-companion + browser), refined by the
  operator to **concise-for-the-website / thorough-exhaustive-for-the-bibliography**, and
  informed by the operator's note that **English-language texts now exist in the archive**
  (completed translations + English-language Papers Past originals). The structural calls
  (both per-issue; concise distilled from thorough; companion + reference-not-inline) were
  confirmed by the operator.
- Consumes shipped: `corpus-browser`, `source-group-acquisition` / `gallica-fetcher` /
  `archive-object-store`, `source-translation`, `canonical-source-metadata`,
  `corpus-coverage-audit`.
- Handoff target: `/stack-control:define`.
