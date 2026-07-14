# Feature Specification: New Italy Museum acquisition path

**Feature Branch**: `feature/corpus-gap-closure` (numbered spec dir `specs/011-museum-acquisition-path`; this program runs on one long-lived branch)

**Created**: 2026-07-14

**Status**: Draft

**Input**: Approved design record `docs/superpowers/specs/2026-07-13-museum-acquisition-path-design.md` (source of truth). Roadmap item `impl:feature/museum-acquisition-path`; originating backlog TASK-26 (museum acquisition path) + TASK-25 (suspected-resolution state). TASK-27 / TASK-24 (standalone-source) explicitly out of scope.

## Context

Spec 009's research loop resolved PB-P006 (the New Italy Museum source-group) to `identified`: its two `suspected[]` leads name concrete public-domain acquisition candidates (*Survivors arrival in Sydney 1881*, *Landing site at Port Breton*, *Pioneers Group Photo 1890*, *School Group Photo New Italy 1903*; **excluded**: *1961 group photo*, post-1955). The museum's Musarch static catalogue (`newitaly.org.au/CAT/`) is item-level digitised — per-item detail pages plus images — but it is not Gallica/Trove/IIIF, so the shipped acquisition pipeline (hardwired to Gallica ARKs) cannot reach it. The museum is the **first non-Gallica repository** the corpus acquires from — the "second repository" condition spec 009 named for extracting a shared repository adapter. This feature builds that adapter, acquires the identified public-domain items, and makes the coverage audit reflect the resolution and extent knowledge 009 produced.

## Clarifications

### Session 2026-07-14

- Q: How is the repository adapter selected when the operator runs the pipeline? → A: Deterministic + explicit hybrid — where a RepositoryRecord already exists (acquire/verify), dispatch by its copy-identifier type (ark→Gallica, accession→museum); where the operator supplies a raw locator (inventory), an explicit `--repository <name>` flag names the adapter. No locator-shape sniffing.
- Q: Which coding-agent engine backs the museum prose extraction? → A: Default to the codex backend (model configurable via the existing engine config); claude remains available as the alternate backend.
- Q: How does the operator record the authoritative public-domain rights judgment? → A: A dedicated rights-assessment step that surfaces the collected evidence (excerpt, date, credit) and writes the rights fields (status/basis/jurisdiction/assessed-by/assessed-at) on operator confirmation.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Acquire an identified museum public-domain item (Priority: P1)

A researcher takes an identified PB-P006 lead (e.g. *Pioneers Group Photo 1890*), inventories it as a discrete museum item under the source-group, confirms its public-domain rights against the evidence the tool surfaces, and the tool fetches the item, extracts its metadata (grounded in the page), writes the image master + full provenance to the object store, and reconciles the canonical record — so the corpus grows by one preservable, provenance-bearing public-domain work.

**Why this priority**: This is the concrete corpus-growth value and the reason the feature exists. It is the minimum viable slice: one museum item acquired end-to-end proves the whole non-Gallica path.

**Independent Test**: Take one identified candidate through inventory → rights confirmation → acquire → reconcile; verify the master + provenance exist in the object store, the canonical record is `archived`, and coverage reflects it. Delivers value with no other story implemented.

**Acceptance Scenarios**:

1. **Given** an identified PB-P006 candidate whose rights the operator has recorded as public-domain, **When** the researcher acquires it, **Then** the image master and full provenance (retrieval date, original URL, checksum, format, crediting the New Italy Museum) are written to the object store and the canonical record reconciles to `archived`.
2. **Given** the item's date lives in prose on the catalogue page, **When** the tool extracts it, **Then** the extracted date is accompanied by a verbatim page excerpt that is deterministically verified to appear on the fetched page and to contain the date value; an ungrounded field aborts the acquisition (nothing is written).
3. **Given** the operator has NOT recorded a public-domain rights judgment (rights absent, restricted, or uncertain), **When** acquisition is attempted, **Then** it is refused and the item stays cataloged but unmirrored.
4. **Given** a museum item is a discrete photograph, **When** it is inventoried, **Then** it is represented as a first-class archival work (not mis-typed as a monograph) belonging to the PB-P006 source-group.
5. **Given** an already-acquired item, **When** acquisition is re-run, **Then** it continues from recorded state without duplicating objects or overwriting content whose checksum matches.

---

### User Story 2 - Existing Gallica acquisitions are unchanged through the adapter (Priority: P1)

The full cutover replaces the Gallica-hardwired acquisition path with a repository-adapter seam. An operator acquiring an existing Gallica ARK source gets byte-identical behavior — same archive layout, object-store keys, checksums, and canonical status transitions — with no transitional/back-compat path left behind.

**Why this priority**: The cutover touches shipped, working functionality. A regression here breaks the corpus's primary acquisition path, so proving no-regression is as critical as the new capability.

**Independent Test**: Run the existing Gallica acquisition/verify/reconcile flows through the adapter and compare against recorded prior behavior via characterization tests; all must match. Testable without any museum work.

**Acceptance Scenarios**:

1. **Given** a Gallica ARK source, **When** it is inventoried/verified/acquired/reconciled through the adapter seam, **Then** the ARK inventory, public-domain verification, archive layout + provenance, object-store keys + checksums, source-group guardrails, and reconcile transitions are identical to the pre-cutover behavior.
2. **Given** the cutover is complete, **When** any code references the removed hardwired `ark → fetch` path, **Then** it fails loud (no dual path, no back-compat alias remains).

---

### User Story 3 - The coverage audit reflects lead resolution (Priority: P2)

A researcher reading the coverage audit sees each suspected lead's resolution state (unexamined / identified / inventoried / excluded / unavailable) rather than every lead rendering identically as open — so resolved research (like PB-P006's two identified leads) stops reading as an outstanding gap.

**Why this priority**: Closes spec 009's SC-004 (resolved leads invisible). High value for audit honesty, but independent of acquiring anything.

**Independent Test**: Record PB-P006's two leads as `identified` and confirm coverage renders them distinctly from unexamined leads; an `excluded`/`unavailable` lead shows its reason. Testable with no acquisition.

**Acceptance Scenarios**:

1. **Given** a suspected lead resolved to `identified` (with a repository candidate reference), **When** coverage renders, **Then** it shows the `identified` state, not an open bullet.
2. **Given** a lead resolved to `excluded` or `unavailable`, **When** it is recorded, **Then** a reason is required and rendered.
3. **Given** a lead resolved to `inventoried`, **When** coverage renders, **Then** it references the resulting Source.

---

### User Story 4 - The coverage audit reports honest extent (Priority: P2)

A researcher sees a campaign's believed extent as an explicit state — a measured number (with basis), `unexamined` (not yet researched), or `irreducible` (researched, unbounded, with basis) — never the overloaded bare word `unknown`.

**Why this priority**: Removes the bare-`unknown` dishonesty spec 009 forbids; independent of acquisition.

**Independent Test**: Set PB-P006's extent to its explicit state with basis and confirm coverage renders it distinctly; confirm a bare `unknown` is rejected. Testable standalone.

**Acceptance Scenarios**:

1. **Given** a campaign whose extent is researched but unbounded, **When** its extent is recorded as `irreducible` with a basis, **Then** coverage renders that state distinctly and the basis is present.
2. **Given** an attempt to record a bare `unknown` extent, **When** it is loaded, **Then** it fails loud.
3. **Given** a campaign with a measured bounded extent, **When** it is recorded as a number, **Then** a basis is required.

---

### Edge Cases

- **Ungrounded extraction**: a rights-critical field whose value cannot be tied to a verbatim page excerpt aborts acquisition — the field is never written (no fabrication).
- **Remote content changed after inventory**: acquisition fails loud or preserves a new version — it never silently replaces a previously preserved master.
- **Multiple representations of one object** (front/back, page scans, thumbnail + full): these are assets of one canonical record, never separate works; the best representation is chosen deterministically (max-resolution, non-thumbnail) and how it was chosen is recorded; a thumbnail is never preserved as a master.
- **Rights restricted/uncertain**: the item is cataloged but not mirrored (copyright fail-closed).
- **HTML-description-only item** (no downloadable master): recorded as such; nothing is mirrored (there is no asset to preserve).
- **Coding-agent engine unavailable**: extraction fails loud with a descriptive error; no fallback.
- **Partial acquisition failure** (asset written but provenance failed, or acquire done but reconcile failed): a retry converges from recorded state; no duplicate objects.
- **Standalone (non-group) source**: out of scope for this feature (the museum items are group members); a standalone promotion path is TASK-27, not built here.

## Requirements *(mandatory)*

### Functional Requirements

**Repository adapter seam (full cutover)**

- **FR-001**: The system MUST define an injected repository-adapter contract that operates on canonical records: resolve a repository locator to a resolved item, collect rights evidence (proposing, never deciding), and acquire a selected canonical record — returning a typed result rather than requiring the caller to infer success from side effects.
- **FR-002**: The acquisition result MUST report, per acquired asset: source URL, media type, object-store key, checksum, byte length, provenance path, and role/sequence within the item; and MUST report whether the acquisition is complete and whether reconciliation is required.
- **FR-003**: The system MUST refactor the shipped Gallica acquisition path to implement the adapter contract (a Gallica adapter wrapping the existing fetcher) and MUST remove the hardwired ARK→fetch path — no dual path, no transitional shim, no back-compat alias. A reference to the removed shape MUST fail loud.
- **FR-004**: The Gallica cutover MUST be gated by characterization tests proving behavior identical to the pre-cutover path: ARK inventory, public-domain verification, archive layout + provenance, object-store keys + checksums, source-group guardrails, and reconcile transitions.
- **FR-023**: The adapter MUST be selected deterministically where a RepositoryRecord already exists — dispatched by its copy-identifier type (ARK → Gallica, accession → museum) — and MUST be named by an explicit `--repository <name>` flag where the operator supplies a raw locator (inventory). The system MUST NOT infer the adapter from the locator/URL shape (no sniffing); an unresolvable or ambiguous selection MUST fail loud.

**Museum adapter + grounded extraction**

- **FR-005**: The museum adapter MUST fetch item detail pages and images through the existing rate-limit-safe HTTP client (reused, not reimplemented).
- **FR-006**: Mechanical fields (asset URL, accession identifier) MUST be read deterministically from the page structure, not via the language model.
- **FR-007**: Prose-embedded fields (date, creator, description, stated credit) MUST be extracted via a structured-extraction contract that reuses the existing coding-agent engine seam (no new agent-invocation code); each extracted field MUST carry evidence (a verbatim page excerpt, optionally a locator). The extractor MUST default to the codex engine backend with the model configurable via the existing engine config, and MUST leave the claude backend available as the alternate.
- **FR-008**: A deterministic verifier MUST assert each extracted field's evidence excerpt is a verbatim substring of the fetched page bytes (whitespace-normalized), and that a rights-critical date's excerpt contains the date value; a field that cannot be grounded MUST fail loud and MUST NOT be written (no fabricated identifier or date — Principle V, and 009 INV-2).
- **FR-009**: Fetched page content MUST be supplied to the model strictly as data, never as instructions (prompt-injection fencing).
- **FR-010**: The verified evidence excerpt MUST be persisted in provenance alongside a model-assisted marker + engine + model + prompt-version + timestamp, so the record is re-verifiable without re-running the model.
- **FR-011**: When the coding-agent engine is unavailable, extraction MUST fail loud with a descriptive error — no fallback.

**Honest model for museum objects**

- **FR-012**: The Source model MUST gain a structural kind for a discrete archival work (photograph, letter, postcard, certificate) that is neither serial nor monographic; a museum object MUST NOT be mis-typed as a monograph to pass validation.
- **FR-013**: The system MUST represent the Source/asset boundary: one photograph or letter is one Source; a multi-page work (e.g. a diary) is one Source with multiple assets; multiple scans/views/thumbnail+full of one object are assets of one canonical record, never separate Sources.
- **FR-014**: The museum copy identity MUST be the Musarch accession identifier (a new copy-identifier type), with catalogue-page and asset URLs recorded as locators, not identity.

**Rights (fail closed, operator-recorded)**

- **FR-015**: The authoritative rights judgment MUST live on the canonical record (raw rights text, status, basis, jurisdiction, assessed-by = operator, assessed-at); the adapter proposes evidence but MUST NOT author the judgment. The judgment MUST be recorded via a dedicated rights-assessment step that surfaces the collected evidence (excerpt, date, credit) and writes the rights fields on operator confirmation.
- **FR-016**: Only a recorded public-domain state MUST permit mirroring; restricted/uncertain MUST block mirroring while keeping the catalog entry (Principle IV). The adapter MUST enforce the recorded state before acquiring.

**Membership + audit surfaces**

- **FR-017**: Inventoried museum items MUST become members of the PB-P006 source-group (via the existing group-membership edge) and flow through the existing group-member verify/promote path; no standalone-source promotion path is added.
- **FR-018**: A suspected lead MUST support a resolution state (unexamined | identified | inventoried | excluded | unavailable) with a structured payload — identified references a repository candidate, inventoried references the resulting Source, excluded/unavailable require a reason, plus a resolved-at timestamp — and the coverage audit MUST render the state distinctly so resolved leads do not read as open. PB-P006's two leads MUST be migrated from free-text notes into the field.
- **FR-019**: A campaign's known extent MUST be exactly one of: a measured number (basis required), `unexamined` (no basis), or `irreducible` (basis required); the bare `unknown` literal MUST be removed and fail loud; the coverage audit MUST render each state distinctly.

**Acquisition integrity**

- **FR-020**: Acquisition MUST be convergent and idempotent: resolve the canonical record → confirm recorded rights → fetch current repository metadata → compare identity + expected asset metadata → write missing assets → verify object-store checksums → write provenance/manifest → reconcile. A retry MUST continue from recorded state (reusing the fetcher's already-checksummed-asset skip) without duplicating objects.
- **FR-021**: If remote content has changed since inventory, acquisition MUST fail loud or preserve a new version — it MUST NEVER silently replace a previously preserved master.
- **FR-022**: A single intellectual work MUST be counted once in coverage; multiple repository copies are separate repository records (SSOT).

### Key Entities *(include if feature involves data)*

- **RepositoryAdapter**: the injected contract (resolve / collect-rights-evidence / acquire) any repository implements; capability, not vendor identity. Implementations: **GallicaAdapter** (wraps the shipped fetcher) and **NewItalyMuseumAdapter**.
- **ResolvedRepositoryItem / AcquisitionResult / AcquiredAsset**: typed I/O of the adapter — the resolved item, and the per-asset result (URL, media type, object-store key, checksum, byte length, provenance path, role/sequence, complete, reconciliation-required).
- **StructuredExtractor / GroundedField**: the extraction contract over the reused engine seam; a grounded field is `{ value, evidence: { excerpt, locator? } }` deterministically verified against the page.
- **Source**: intellectual work; gains a discrete-archival-work structural kind; members belong to the PB-P006 source-group.
- **RepositoryRecord**: a held copy; gains the accession copy-identifier and the authoritative rights fields; carries assets.
- **SuspectedLead**: a research lead; gains a resolution state + structured payload.
- **KnownExtent**: a campaign's believed extent as the three-state value (number | unexamined | irreducible) with basis rules.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The identified PB-P006 public-domain candidates are acquired with image masters + full provenance present in the object store and their canonical records reconciled — verified by inspection of the object store and reconcile output, not asserted.
- **SC-002**: Every acquired museum field that drives a rights decision is backed by a persisted page excerpt that re-verifies against the fetched page without re-running the model; zero fabricated identifiers or dates are written.
- **SC-003**: Existing Gallica acquisitions produce identical archive layout, object-store keys, checksums, and reconcile transitions through the adapter — characterization tests pass green.
- **SC-004**: No resolved suspected lead renders as an open gap in the coverage audit; PB-P006's two identified leads render with their resolution state.
- **SC-005**: No campaign extent renders as a bare `unknown`; PB-P006's extent renders as its explicit three-state value with a basis.
- **SC-006**: No copyrighted, restricted, or rights-uncertain museum item is mirrored; such items remain cataloged (copyright fail-closed).

## Assumptions

- The Musarch accession identifier is stable across catalogue rebuilds and serves as durable copy identity (confirmed at inventory time; a discovered instability surfaces as a fail-loud gap, not a silent guess).
- The existing rate-limit-safe HTTP client, the object store (B2), and the shipped `bib reconcile` / group-member verify/promote verbs are reused as-is.
- The coding-agent engine seam is available in the operator's environment (the codex backend by default; model configurable); its absence fails loud (no fallback).
- The operator performs the rights judgment interactively against the surfaced evidence; the tool never auto-clears rights.
- PB-P006's extent is expected to resolve to `irreducible` (a heterogeneous, unbounded holding) with basis, confirmed at inventory time; the render supports a bounded number if the public-domain candidates are instead enumerated.
- Only Gallica and the New Italy Museum adapters are built now; the adapter contract generalizes but further repositories are captured-when-reached (009 FR-013), not pre-built.
- Provenance credits the New Italy Museum as the holding archive; any courtesy notification of the volunteer museum is an operator relationship step outside the tooling.
- Master quality is whatever the Musarch item pages expose; requesting archival originals from the museum is a possible follow-on, not in this feature.

## Out of Scope

- Standalone (non-grouped) source promotion to approved-for-acquisition (TASK-27) and standalone-source-has-no-group (TASK-24) — orthogonal, surfaced by PB-P002; the museum items are group members.
- A full lead-resolution transition-history/audit-log subsystem (deferred at n=1); the current state + reason + timestamp is recorded.
- Adapters for repositories other than Gallica and the New Italy Museum (IIIF helper, Trove, HathiTrust, etc.) — captured-when-reached.
- OCR/translation of acquired items; requesting non-catalogue originals from the museum.
