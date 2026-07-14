# Design — New Italy Museum acquisition path

- Roadmap item: `impl:feature/museum-acquisition-path`
- Date: 2026-07-13
- Design backend: `superpowers:brainstorming`, driven under house rules `stack-control-design-v1`
- Handoff target: `/stack-control:define` (NEVER `writing-plans`)

## Problem domain

Spec 009's research loop resolved PB-P006 (the New Italy Museum source-group) to
`identified`: two `suspected[]` leads now name concrete public-domain acquisition
candidates — *Survivors arrival in Sydney 1881*, *Landing site at Port Breton*,
*Pioneers Group Photo 1890*, *School Group Photo New Italy 1903* — with one
explicitly **excluded** as post-1955/in-copyright (*Expedition Survivors Group
Photo 1961*). The museum's online Musarch catalogue (`newitaly.org.au/CAT/`, a
static export) is item-level digitised: per-item detail pages plus images (~55
digital images over 300+ photographic prints; ~70 Documents-category items —
diaries, letters, certificates, postcards). The research is done; the corpus
cannot act on it. Three concrete blocks:

1. **No acquire path for a non-Gallica repository.** `bib acquire` is hardwired
   `ark → runFetchSource` (`src/sourcegroup/acquire.ts:184-210`); it selects a
   `RepositoryRecord`, reads the first `type === 'ark'` copy identifier, and calls
   the single shipped Gallica-oriented fetcher. A museum item has no ARK — it has
   a Musarch accession id / catalogue URL — so acquisition dies at
   `acquire.ts:185` (`the selected RepositoryRecord carries no ark identifier`).
   The inventory/verify/promote verbs are equally Gallica-bound: they inject a
   concrete `gallicaArkMetadataResolver` / `gallicaArkIdentifierResolver`
   (`src/cli/bib-sourcegroup.ts:126,204,247`) over an `ArkResolver` seam that
   assumes *"ark string in / ark string out"*. There is **no `RepositoryAdapter`
   in code** — it exists only as a written contract in
   `specs/009-corpus-gap-closure/contracts/repository-adapter.md`.

2. **Resolved leads are invisible to the audit.** PB-P006's two leads carry their
   `RESOLVED -> identified` verdicts only in free-text `notes`. The coverage
   register (`src/bibliography/coverage/coverage-register.ts:38-46`) and render
   (`src/bibliography/coverage/coverage-render.ts:91-93`) emit every `suspected[]`
   entry as an identical open bullet — there is nowhere to show a resolution
   state. The loader actively rejects a `resolution` key: `SUSPECTED_KEYS`
   (`src/bibliography/load-coverage-fields.ts:30`) allows only
   `description|basis|evidenceClass|notes`, and `assertKnownKeys`
   (`src/bibliography/load-primitives.ts:63-74`) fails loud on any other key. This
   is spec 009's SC-004 gap.

3. **Bare-`unknown` extent.** PB-P006 carries `knownMemberCount: unknown` — the
   exact overloaded bare-`unknown` that 009 forbids (it conflates "not yet
   researched" with "researched, unbounded"). `validateKnownMemberCount`
   (`src/bibliography/load-coverage-fields.ts:121-133`) accepts only
   `number | 'unknown'`, not 009's three-state `number | unexamined | irreducible`.

**Why a new spec (not a 009 task).** Spec 009 is explicitly built *tool-on-demand*
(R4/R7: "don't abstract on n=1") and its own methodology (spec.md:184) directs:
*"Any genuinely-missing tool … is discovered through the research, captured
(FR-013), and built just-in-time as its own small spec through the front door."*
Trove (PB-P005) **disproved** its adapter; the New Italy Museum (PB-P006)
**proved** exactly the adapter + resolution-render + three-state-extent tools 009
pre-specified but deferred. This spec is where that proven need is built. The
museum is the **first non-Gallica acquisition** — the "2nd repository" condition
009 named (T003) for pulling the shared `RepositoryAdapter` seam.

## Solution space

### Acquisition architecture (relative to the shipped Gallica pipeline)

- **### Chosen — B: Extract the `RepositoryAdapter` interface (full cutover).**
  Implement 009's `contracts/repository-adapter.md`
  (`resolveIdentifier`/`determineRights`/`acquire`). Refactor the shipped Gallica
  path into a `GallicaAdapter` that wraps the existing fetcher (009's T004), add a
  `NewItalyMuseumAdapter`, and dispatch acquire/inventory/verify/promote through
  the adapter. The museum is the 2nd repository — the exact trigger 009 named for
  T003, and the contract is already written. **This is a full cutover, not a
  transitional shim** (see Decisions): the hardwired `ark → fetch-source` path is
  *replaced*, not paralleled.
- **### Rejected — A: Bespoke museum path, no shared interface yet.** Wire a
  museum-specific resolve+acquire directly with a repository-type branch in the
  verbs; defer extracting `RepositoryAdapter` until a 3rd repo appears. *Rejected*:
  the shared seam stays implicit and the type-branch accretes at every verb; and
  009 already set the pull-threshold at the 2nd repository, which the museum meets.
- **### Rejected — C: Separate standalone museum tool.** A parallel
  `acquire-museum` command that never touches the Gallica verbs. *Rejected*: it
  duplicates inventory/verify/promote logic and creates two ways to do the same
  thing — precisely the pipeline drift specs 009/010 fought to eliminate.

### Item extraction from the Musarch catalogue

- **### Chosen — Reuse the existing engine seam + coding-agent callout.** Fetch
  the item detail page + image with the existing rate-limit-safe HTTP client, then
  extract structured fields via the **already-shipped `TranslationEngine` /
  `createEngine(name)` seam** (`src/engine/types.ts`, `src/engine/factory.ts`;
  codex/claude backends, hardened read-only isolation, injectable runners,
  preflight availability check). No new agent-invocation code is written.
- **### Rejected — Hand-rolled HTML/DOM parser.** A bespoke scraper over the
  Musarch markup. *Rejected*: brittle, drifts whenever the static export changes,
  and re-implements extraction the coding-agent seam already does robustly.
- **### Rejected — Manual-backed / operator-supplied per item.** Operator downloads
  each item and the tool only records it. *Rejected by operator steer*: automate
  the fetch/extraction, reusing existing rate-limit-safe tooling. (Retained as the
  fallback shape only if the automated path is refused per-repository — the
  adapter's `searchMechanism: manual` remains a valid config for other repos.)

## Decisions

1. **`RepositoryAdapter` per 009's contract, full cutover.** Build the injected
   interface `{ name, resolveIdentifier, determineRights, acquire }`. Refactor the
   shipped Gallica acquire/resolve into `GallicaAdapter`; **remove** the hardwired
   `ark → runFetchSource` path and the directly-injected Gallica resolvers rather
   than leaving them beside the adapter. No dual path, no back-compat alias, no
   "just for now" shim — if anything still references the old shape it fails loud.
   (Clean break; matches project standing directive against back-compat.)
2. **`NewItalyMuseumAdapter` extraction reuses the engine seam.** The adapter
   fetches via the existing rate-limit-safe HTTP client and calls
   `engine.run(extractionPrompt, fetchedPage)` (engine from `createEngine`) to
   extract `{title, date, description, imageUrl, accessionId, statedCredit}`.
   **Grounding gate (fail loud, no fabrication — INV-2):** every extracted
   identifier / date / image URL must be verifiable against the fetched page
   bytes; an ungroundable extraction throws — it is never written. If the selected
   engine's preflight fails (binary absent), the adapter fails loud — no fallback.
3. **Rights = fail-closed, operator-recorded judgment (FR-007, Principle IV).**
   The engine may *propose* the item date as a hint, but only an
   operator-confirmed `public-domain` verdict (pre-1955 photograph term, or
   author-dead-70y for writings) reaches `acquire`. `restricted` / `uncertain`
   block mirroring but keep the catalog entry. The engine never clears rights
   autonomously. The named candidates already carry their dates in
   `bibliography/sources/PB-P006.yml`.
4. **Museum items are group members — no standalone-promotion change.** Inventoried
   museum items become member Sources with `partOf → PB-P006`, so they flow through
   the *existing* group-member `verify-member → promote` path. TASK-27
   (standalone-source promotion) and TASK-24 (standalone-no-group) are **out of
   scope** — orthogonal, surfaced by PB-P002, not by the museum.
5. **`SuspectedLead.resolution` — model + render.** Add the `resolution` field with
   009's vocab `unexamined | identified | inventoried | excluded | unavailable`
   (reason required for `excluded`/`unavailable`); extend `SUSPECTED_KEYS`; render
   the state distinctly in `bib coverage` so resolved leads stop reading as open
   (closes SC-004). Migrate PB-P006's two leads from their free-text `RESOLVED`
   notes into the field. Clean cutover: the field is authoritative, the note prose
   is not re-parsed.
6. **Three-state `knownMemberCount` (T029).** Replace `number | 'unknown'` with
   `number | 'unexamined' | 'irreducible'`; `extentBasis` required for a number and
   for `irreducible`, omitted for `unexamined`; render each state distinctly.
   PB-P006's bare `unknown` is reset to an explicit state at inventory time. The
   old `'unknown'` literal is removed, not aliased (fail loud on it).
7. **Acquisition preserves + reconciles.** `adapter.acquire(--object-store)` writes
   masters + provenance to B2, then `bib reconcile <id>` advances the SSOT status
   (`wanted → … → archived`). Provenance credits the New Italy Museum as the
   holding archive.

## Open questions

- **Engine choice + model for extraction.** `createEngine` defaults to `claude`
  (`gpt-5.5` for codex); the operator asked specifically for a codex CLI callout.
  Confirm the engine/model the museum adapter selects, and whether it is
  configurable per-run. Resolve in `/stack-control:define`.
- **Grounding-verification protocol specifics.** The exact rule for "verifiable
  against fetched bytes" (substring match of accession/URL; date cross-check
  against a visible catalogue field) — pin down at spec time.
- **PB-P006 extent value.** `irreducible` (heterogeneous, unbounded museum holding
  with basis) vs a bounded `number` (the enumerated public-domain candidates).
  Decide at inventory time during execution; the render must support both.
- **Master quality.** What resolution the Musarch item pages expose, and whether to
  request originals from the museum for archival-grade masters.
- **Museum courtesy / relationship.** Provenance credits the museum; open whether to
  notify or seek the volunteer museum's blessing before mirroring — a relationship
  question, not merely a copyright one.

## Provenance

- Spun out of spec 009 (`impl:feature/corpus-gap-closure`) per its own
  build-as-a-small-spec methodology (`specs/009-corpus-gap-closure/spec.md:184`,
  FR-013). The New Italy Museum is the proven-need counterpart to Trove's
  disproven adapter (2026-07-14 journal, SRCH-0007).
- Backlog: **TASK-26** (new-italy-museum-acquisition-path) and **TASK-25**
  (suspected-resolution-state) are in scope; **TASK-27** / **TASK-24**
  (standalone-source) captured as out-of-scope.
- Reuses 009 artifacts: `contracts/repository-adapter.md` (the adapter interface +
  loop invariants INV-1..6); `data-model.md` (DiscoveryCandidate / SuspectedLead
  `resolution`; three-state `knownMemberCount`; `RepositoryAdapterConfig`);
  tasks T003/T004/T019/T029.
- Source record: `bibliography/sources/PB-P006.yml` (identified candidates + rights
  buckets + museum custodianship).
- Reused code seams: `src/engine/types.ts`, `src/engine/factory.ts`,
  `src/codex/*`, `src/claude/*` (coding-agent callout — reused, not re-built);
  `src/sourcegroup/acquire.ts:83-210`, `promote.ts:126-158`,
  `src/cli/bib-sourcegroup.ts`, `src/bibliography/load-coverage-fields.ts:30,95-133`,
  `coverage-register.ts:38-46`, `coverage-render.ts:91-145`, `vocab.ts:30-57`,
  `src/model/source.ts`, `src/model/repository-record.ts`.
- Operator steers this session: Q1 mechanism (automate fetch + reuse coding-agent
  callout, no hand-rolled parser); Q2 architecture B (extract adapter interface);
  full cutover, never back-compat.
- Design house rules: `stack-control-design-v1` (capture-over-yagni;
  ≥2 solution-space alternatives; required sections; operator approval marker;
  handoff to `/stack-control:define`; installation-anchored record).
