# Design — New Italy Museum acquisition path

- Roadmap item: `impl:feature/museum-acquisition-path`
- Date: 2026-07-13 (third-party review folded in 2026-07-14)
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
cannot act on it. Blocks:

1. **No acquire path for a non-Gallica repository.** `bib acquire` is hardwired
   `ark → runFetchSource` (`src/sourcegroup/acquire.ts:184-210`); it selects a
   `RepositoryRecord`, reads the first `type === 'ark'` copy identifier, and calls
   the single shipped Gallica-oriented fetcher. A museum item has no ARK — it has
   a Musarch **accession id** / catalogue URL — so acquisition dies at
   `acquire.ts:185`. The inventory/verify/promote verbs are equally Gallica-bound
   (`src/cli/bib-sourcegroup.ts:126,204,247`) over an `ArkResolver` seam that
   assumes *"ark string in / ark string out"*. There is **no `RepositoryAdapter`
   in code** — only the written contract in
   `specs/009-corpus-gap-closure/contracts/repository-adapter.md`.

2. **Museum objects don't fit the structural `kind` model.** Structural kinds are
   `periodical | monograph | source-group` (`src/model/source.ts:23`); a member
   "is still a monograph/periodical" (`source.ts:27`) and `evidenceClass` is
   explicitly orthogonal (`source.ts:55`). A photograph / letter / postcard /
   certificate is none of these — classifying one as a `monograph` to pass
   validation is exactly the dishonest modeling spec 010 removed.

3. **Resolved leads are invisible to the audit.** PB-P006's two leads carry their
   `RESOLVED -> identified` verdicts only in free-text `notes`. The register
   (`coverage-register.ts:38-46`) and render (`coverage-render.ts:91-93`) emit
   every `suspected[]` entry as an identical open bullet. The loader rejects a
   `resolution` key: `SUSPECTED_KEYS` (`load-coverage-fields.ts:30`) allows only
   `description|basis|evidenceClass|notes`, and `assertKnownKeys`
   (`load-primitives.ts:63-74`) fails loud otherwise. This is 009's SC-004 gap.

4. **Bare-`unknown` extent.** PB-P006 carries `knownMemberCount: unknown` — the
   overloaded bare-`unknown` 009 forbids. `validateKnownMemberCount`
   (`load-coverage-fields.ts:121-133`) accepts only `number | 'unknown'`, not
   009's `number | unexamined | irreducible`.

**Why a new spec (not a 009 task).** Spec 009 is built *tool-on-demand* (R4/R7:
"don't abstract on n=1") and its own methodology (spec.md:184) directs that a
proven-missing tool is "built just-in-time as its own small spec through the front
door." Trove (PB-P005) **disproved** its adapter; the museum (PB-P006) **proved**
the adapter + resolution-render + three-state-extent tools 009 pre-specified. The
museum is the **first non-Gallica acquisition** — the "2nd repository" condition
009 named (T003) for pulling the shared `RepositoryAdapter` seam.

## Solution space

### Acquisition architecture

- **### Chosen — B: Extract the `RepositoryAdapter` interface (full cutover).**
  Implement 009's `contracts/repository-adapter.md`, refined per review to operate
  on canonical records and return typed results. Refactor the shipped Gallica path
  into a `GallicaAdapter` wrapping the existing fetcher (009's T004), add a
  `NewItalyMuseumAdapter`, and dispatch acquire/inventory/verify/promote through
  the adapter. The museum is the 2nd repository — the trigger 009 named for T003.
  **Full cutover, not a transitional shim**: the hardwired `ark → fetch-source`
  path is *replaced*, guarded by Gallica characterization tests (Decision 9).
- **### Rejected — A: Bespoke museum path, no shared interface.** A repository-type
  branch in the verbs, deferring extraction. *Rejected*: the seam stays implicit
  and the branch accretes; 009 set the pull-threshold at the 2nd repository, met.
- **### Rejected — C: Separate standalone museum tool.** *Rejected*: duplicates
  inventory/verify/promote and creates two ways to do one thing — the pipeline
  drift specs 009/010 fought.

### Item extraction from the Musarch catalogue

- **### Chosen — Layered hybrid: DOM-direct pull + LLM extraction + deterministic
  verifier.** Fetch the item page + image with the existing rate-limit-safe HTTP
  client. Read mechanical fields (asset URL, accession id) straight from the DOM
  node (deterministic). Extract prose-embedded fields (date, creator, description)
  via a **new `StructuredExtractor<T>` contract wrapping the already-shipped
  `createEngine`/`TranslationEngine` coding-agent seam** (`src/engine/*`,
  `src/codex/*`, `src/claude/*`) — no new callout code — returning grounded fields
  a **deterministic verifier** then ratifies against the fetched bytes (Decision 3).
  This keeps the operator's LLM choice (no hand-rolled template parser) while
  ensuring non-deterministic output never becomes the source of truth for a
  canonical, rights-critical field without deterministic grounding — the security,
  reproducibility, and silent-drift arguments against *pure* LLM extraction.
- **### Rejected — Bare `TranslationEngine.run` returning free text.** Reusing the
  translation seam *as-is* pushes fragile text-to-field parsing into the adapter.
  *Rejected*: keep the callout, add the structured contract on top.
- **### Rejected — Deterministic HTML/DOM parser (the reviewer's preference).** A
  fixture-guarded parser over the Musarch markup. *Rejected by operator decision*:
  the operator chose model-assisted extraction over a hand-rolled parser for a
  volunteer-museum static export that can drift; a fixture-guarded parser stays the
  documented fallback if model extraction proves unreliable in execution.
- **### Rejected — Manual-backed / operator-supplied per item.** *Rejected by
  operator steer* (automate the fetch/extraction); `searchMechanism: manual`
  remains a valid adapter config for *other* repositories.

## Decisions

1. **`RepositoryAdapter` per 009's contract, full cutover, canonical I/O.** The
   injected interface operates on canonical records and returns typed results
   (refined from 009's sketch per review §3):
   - `resolve(locator, context) → ResolvedRepositoryItem` (repository identity +
     copy identifiers + source URL + copy metadata held together).
   - `collectRightsEvidence(item) → RightsEvidence` (renamed from 009's
     authoritative-sounding `determineRights` per review §4 — it *proposes*, never
     decides).
   - `acquire(record: RepositoryRecord, context) → AcquisitionResult` with
     `{ repositoryRecordId, assets[], metadataSnapshot, complete,
     reconciliationRequired }`; each `AcquiredAsset` reports source URL, media
     type, object-store key, checksum, byte length, provenance path, role/sequence.
   Refactor the shipped Gallica acquire/resolve into `GallicaAdapter`; **remove**
   the hardwired `ark → runFetchSource` path — no dual path, no back-compat alias,
   no shim; a lingering reference to the old shape fails loud.

2. **Honest structural kind for museum objects (review §1, §7).** Add
   `kind: 'item'` (a discrete archival work — photograph/letter/postcard/
   certificate — neither serial nor monographic). Boundaries: one photograph = one
   Source; one letter = one Source; a multi-page diary = one Source with multiple
   assets; multiple scans/views/thumbnail+full of one object = **assets of one
   `RepositoryRecord`**, not separate Sources. The adapter picks the best
   representation deterministically (max-resolution, non-thumbnail) and records how
   the choice was made; a thumbnail is never preserved as a master. Objects are
   never mis-typed as `monograph` to pass validation.

3. **`StructuredExtractor<T>` over the engine seam, with a deterministic verifier
   (review §2, sharpened).** The extraction is a layered hybrid — LLM stays the
   chosen mechanism (no hand-rolled template parser), but non-deterministic output
   is never the source of truth for a canonical field without deterministic
   grounding. Three layers:
   - **(a) DOM-direct deterministic pull for mechanical fields.** The asset
     URL(s) (from the item's `<img>`/`<a href>`) and the Musarch `accession` id
     (from its stable id pattern) are read straight from the DOM node — no LLM,
     deterministic by construction. These are not prose; an LLM adds only risk.
   - **(b) LLM extraction for prose-embedded fields** (date, creator, description,
     stated credit). The extractor calls `createEngine(...)` under the hood (reuse,
     not rebuild) and returns `GroundedExtraction<T>` where each `GroundedField`
     carries `{ value, evidence: { excerpt, selector? } }` — a verbatim quote of
     where the value was found. **Injection fencing:** fetched content is supplied
     strictly as data, never as instructions. **Missing vs explicit vs inferred**
     are distinguished (an absent field is not a fabricated blank).
   - **(c) Deterministic verifier (the security teeth — fail loud, no fabrication,
     INV-2).** A cheap, reproducible check — *not* a scraper — asserts each
     `evidence.excerpt` is a verbatim substring of the fetched page bytes
     (whitespace-normalized); for the **rights-critical date**, it additionally
     asserts the excerpt contains the value's source form (`value: 1890` ⇒ excerpt
     must contain `"1890"`). An excerpt that is not literally on the page throws —
     the field is never written. This kills fabrication; the model cannot assert a
     value unsupported by page text.
   **Persisted evidence + reproducibility.** The verified `evidence.excerpt` is
   stored in the record's provenance alongside `model-assisted` + engine + model +
   prompt-version + timestamp — so the canonical record is **re-verifiable
   deterministically without re-running the model**, defeating model-version drift.
   **Mis-attribution backstop.** The verifier cannot catch a real excerpt attached
   to the wrong object; the operator's rights confirmation (Decision 4) ratifies
   the date against the shown excerpt-in-context, closing that residual. Engine
   preflight failure → fail loud, no fallback. (Layered: verifier kills
   hallucination, human kills mis-attribution, stored evidence restores
   reproducibility.)

4. **Rights = fail-closed, operator-recorded judgment; authority lives in the
   canonical record (review §4).** `collectRightsEvidence` gathers stated
   rights/credit text, creation date, creator, publication status, repository
   policy, jurisdiction facts — and *proposes*. The authoritative judgment lives on
   the `RepositoryRecord` (`rights` is already a structured `Rights` type,
   `repository-record.ts:21`), extended with `rightsRaw`, `rightsStatus`,
   `rightsBasis`, `rightsJurisdiction`, `assessedBy: operator`, `assessedAt`. Only
   a recorded `public-domain` state permits mirroring; the adapter *enforces* that
   recorded state and never authors it. Named candidates carry their dates in
   `bibliography/sources/PB-P006.yml`.

5. **Museum copy identity is the accession id, not a URL (review §6).** Add
   `accession` to `CopyLevelIdentifierType` (today `ark | iiif-manifest |
   scan-doi`, `identifiers.ts:12`). The `RepositoryRecord` carries the accession as
   copy identity + a `sourceUrl` locator; the detail-page URL and asset URL are
   locators, not identity, and may change across catalogue rebuilds. Museum analog
   of Gallica's ark.

6. **Museum items are group members — no standalone-promotion change.** Inventoried
   items become member Sources with `partOf → PB-P006`, flowing through the
   *existing* group-member `verify-member → promote` path. TASK-27
   (standalone-source promotion) and TASK-24 (standalone-no-group) are **out of
   scope** — orthogonal, surfaced by PB-P002.

7. **`SuspectedLead.resolution` — model + render, with evidence (review §8).** Add
   `resolution` with 009's vocab `unexamined | identified | inventoried | excluded
   | unavailable` plus a structured payload: `identified` references a concrete
   repository candidate; `inventoried` references the resulting Source id;
   `excluded`/`unavailable` **require a reason**; `resolvedAt` timestamp. Extend
   `SUSPECTED_KEYS`; render the state distinctly in `bib coverage` (closes SC-004);
   migrate PB-P006's two leads from free-text `RESOLVED` notes into the field.
   *Scoped down from the review*: record current state + reason + timestamp
   (auditable); a full transition-history subsystem is deferred until a real
   reconsideration occurs (R4/R7). Extends 009's flat resolution shape — reconcile
   in `/stack-control:define`.

8. **Three-state `knownMemberCount` (T029, review §9).** Replace `number |
   'unknown'` with `number | 'unexamined' | 'irreducible'`; `extentBasis` required
   for a number and for `irreducible`, omitted for `unexamined`; render each state
   distinctly. PB-P006 leans `irreducible` with basis (heterogeneous, unbounded
   holding) — confirmed at inventory time. The `'unknown'` literal is removed, not
   aliased (fail loud on it).

9. **Convergent, idempotent acquire + Gallica characterization tests (review §5,
   §10).** Acquisition is convergent: resolve canonical record → confirm recorded
   rights → fetch current repository metadata → compare identity + expected asset
   metadata → write missing assets → verify object-store checksums → write
   provenance/manifest → reconcile. A retry continues from recorded state (the
   fetcher already skips already-checksummed assets and has `--checkpoint`,
   `acquire.ts:132,55-68`); it never duplicates objects or overwrites mismatched
   content. **If remote content changed after inventory, fail loud or preserve a
   new version — never silently replace a master.** The full cutover is gated by
   `GallicaAdapter` characterization tests proving identical behavior: ARK
   inventory, PD verification, archive layout + provenance, object-store keys +
   checksums, source-group guardrails, reconcile transitions. *Build-scope note:*
   the full partial-failure matrix is captured here; the first museum fetch may
   land incremental idempotency — not a full retry state machine on n=1.

## Open questions

- **Engine + model for extraction.** `createEngine` defaults to `claude` (codex
  default `gpt-5.5`); the operator asked for a codex callout. Confirm the
  engine/model the extractor selects and whether it is per-run configurable, plus
  the prompt-version registry. Resolve in `/stack-control:define`.
- **Grounding-verification specifics.** The exact `evidence` rule per field
  (excerpt substring + DOM selector/attribute; date cross-check against a labelled
  catalogue field) — pin at spec time.
- **PB-P006 extent value.** `irreducible` (leaning, per review §9) vs a bounded
  `number` of enumerated PD candidates — confirm at inventory time; render supports
  both.
- **Master quality.** What resolution the Musarch item pages expose, and whether to
  request originals from the museum for archival-grade masters.
- **Museum courtesy / relationship.** Provenance credits the museum; open whether to
  notify or seek the volunteer museum's blessing before mirroring.
- **Build-scope pass (operator).** Which captured items are first-build vs
  follow-on: the full partial-failure/retry matrix (Decision 9), the resolution
  transition-history (Decision 7), and multi-asset role/sequence handling
  (Decision 2) are candidates to stage.

## Provenance

- Spun out of spec 009 (`impl:feature/corpus-gap-closure`) per its
  build-as-a-small-spec methodology (`specs/009-corpus-gap-closure/spec.md:184`,
  FR-013). Proven-need counterpart to Trove's disproven adapter (2026-07-14
  journal, SRCH-0007).
- Backlog: **TASK-26** (museum path) and **TASK-25** (suspected-resolution) in
  scope; **TASK-27** / **TASK-24** (standalone-source) captured out-of-scope.
- Reuses 009 artifacts: `contracts/repository-adapter.md` (adapter interface + loop
  invariants INV-1..6 — refined here per review to canonical I/O + typed results);
  `data-model.md` (DiscoveryCandidate / SuspectedLead `resolution`; three-state
  `knownMemberCount`; `RepositoryAdapterConfig`); tasks T003/T004/T019/T029.
- Source record: `bibliography/sources/PB-P006.yml`.
- Reused code seams (reused, not re-built): `src/engine/types.ts`,
  `src/engine/factory.ts`, `src/codex/*`, `src/claude/*`;
  `src/sourcegroup/acquire.ts:83-210`, `promote.ts:126-158`,
  `src/cli/bib-sourcegroup.ts`, `load-coverage-fields.ts:30,95-133`,
  `coverage-register.ts:38-46`, `coverage-render.ts:91-145`, `vocab.ts:30-57`,
  `src/model/source.ts`, `src/model/repository-record.ts`,
  `src/model/identifiers.ts:12`, `src/model/rights.ts`.
- **Third-party review disposition (2026-07-14).** Accepted: §1 `item` kind, §3
  typed canonical adapter contract, §4 rights naming + canonical authority, §5
  idempotent/convergent acquire, §6 accession-as-identity, §7 item↔assets, §9
  three-state extent, §10 Gallica regression tests. Accepted with synthesis: §2 —
  rejected the "deterministic parser preferred" recommendation (contradicts the
  operator's explicit reuse-the-callout / no-hand-rolled-parser decision) but
  adopted a layered hybrid over the reused engine seam: DOM-direct pull for
  mechanical fields + LLM extraction for prose + a **deterministic verifier** that
  ratifies each field's evidence excerpt against the fetched bytes (excerpt must be
  verbatim on the page; rights-critical date must contain its value), with the
  excerpt persisted so the record is re-verifiable without re-running the model.
  Resolved after an operator-invited argument on parser-vs-LLM: the real axis is
  determinism where a field is canonical + rights-critical, not the parsing tool. Accepted with
  scope-down: §8 — structured resolution with evidence, but transition-history
  subsystem deferred (R4/R7).
- Operator steers: Q1 mechanism (automate fetch + reuse coding-agent callout, no
  hand-rolled parser); Q2 architecture B; full cutover, never back-compat.
- Design house rules: `stack-control-design-v1`.
