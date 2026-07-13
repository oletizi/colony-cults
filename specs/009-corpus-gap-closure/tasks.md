# Tasks: Corpus Gap Closure

**Feature dir**: `specs/009-corpus-gap-closure/` · **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

**A research-first program.** The gap-closure loop is run **interactively** (operator + agent) against the bibliography SSOT / search-log using the **shipped `bib` verbs** — it is *not* dispatched wholesale to an autonomous code executor (archival search + historical judgment are not autonomously executable, and faking them would violate FR-008 / Principle I & V). Tooling is **pulled into existence by the research, not designed ahead of it**: where shipped tooling exists, use it; where it doesn't, capture the gap (FR-013) and build the minimal tool just-in-time as its own small spec through the front door (define → execute). Every durable action is committed + pushed (Principle IX); work happens in a per-session archive clone (never the shared tree).

Task kinds: **[research]** — a durable action/judgment run in the interactive loop. **[tool-on-demand]** — a code unit built only when a loop pass proves the concrete need (each becomes its own small spec at that point; listed here so the need is *named*, not pre-built).

## Phase 1 — Setup & baseline (shipped tooling, zero new code)

- [ ] T001 [research] Confirm shipped prerequisites resolve (`bib coverage`, `bib reconcile`, `bib inventory|verify-member|promote|acquire|discover`, `bib validate`) and capture the baseline coverage snapshot into `RESEARCH_LOG.md` (the pre-program measured gap).
- [ ] T002 [research] Document the per-session archive-clone + env setup in the loop runbook (quickstart.md is canonical); no shared working tree.

## Phase 2 — First move: reconcile already-acquired (US2, P1 — shipped `bib reconcile`, zero new code)

**Runnable now.** The one gap-reduction that needs no tooling at all — immediate, visible closure using a shipped verb. **Independent test**: `bib reconcile PB-P003` → `archived`; coverage reflects it.

- [ ] T011 [US2] [research] `bib reconcile PB-P003` (Baudouin book — masters in B2); expect `archived`; `bib validate` clean; commit + push.
- [ ] T012 [US2] [research] `bib reconcile PB-P001` (newspaper, partial); expect `collected` (not overstated); commit + push.
- [ ] T013 [US2] [research] Confirm SC-003 for the reconciled set: no acquired-but-unreconciled remain; re-run `bib coverage`.

## Phase 3 — The gap-closure research loop (shipped tooling; pull a Phase-4 tool only when a pass proves the need)

Each pass runs in the interactive loop. The **tool it may pull** is named in brackets; build that tool (Phase 4) only if/when doing the pass by hand becomes the actual blocker — the first pass of anything is attempted with shipped verbs / manual authoring in the per-session clone.

### US1 — Search a repository and log the result (P1) — *may pull T005 (search-log authoring); per-repo search T004/T015*

- [ ] T008 [US1] [research] First search-and-log pass: **PB-P004 × Gallica** and **× BnF catalogue**; hand-author the `SearchLogRecord` (or pull T005 if repetitive); record coverage + remaining-questions; commit + push.
- [ ] T009 [US1] [research] Search-and-log **PB-P006 × New Italy Museum** and **× Trove** (manual-backed where no automated mechanism); commit + push.
- [ ] T010 [US1] [research] Verify `bib coverage` Search History + repository rollup are no longer `(none)` for searched pairs (SC-001).

### US5 — Classify every source by evidence-class (P2) — *may pull T006 (evidence-class facet)*

- [ ] T021 [US5] [research] Assign an evidence-class to all 13 current sources; `bib coverage` `unclassified` → 0 (SC-002); commit + push.
- [ ] T022 [US5] [research] Classify each newly-discovered source at inventory time (standing rule for the loop).

### US4 — Discover sources not yet known / resolve leads (P2) — *may pull T018 (bibliographic-mining)*

- [ ] T019 [US4] [research] Resolve PB-P006 **suspected** items (New Italy Museum photographs, survivor accounts): identify → inventory, or document as unavailable/undigitized with basis (SC-004); commit + push. Fail loud on the unverifiable — never fabricate (INV-2).
- [ ] T020 [US4] [research] Mine each acquired source's bibliography for new works → candidates → inventory/verify/promote the genuine ones (pull T018 when manual mining proves repetitive).

### US3 — Acquire a known-missing source from any repository (P2) — *Gallica via shipped `bib acquire`; non-Gallica pulls T015/T017*

- [ ] T014 [US3] [research] Resolve PB-P002's Gallica ark via `bib inventory`/discovery; then `bib acquire PB-P002 --object-store` → `bib reconcile PB-P002` (shipped Gallica path — no new tool).
- [ ] T016 [US3] [research] Acquire **PB-P005** from **Trove** → reconcile (proves SC-006, the non-Gallica end-to-end claim). Pulls T015 (Trove adapter) — this is the pass that proves the multi-repository tooling need.

### US6 — Establish known-extent where researchable (P3) — *may pull T029 (three-state extent + render)*

- [ ] T023 [US6] [research] Research + set `knownMemberCount` + `extentBasis` for campaigns whose extent is boundable (e.g. the trial corpus); mark genuinely-unbounded extents `irreducible` with basis, and leave un-researched extents `unexamined` (SC-005) — never a bare `unknown`. Pulls T029 to render the state distinctly.

### US7 — Declare measured closure (P3) — *may pull T024 (dry-round counter)*

- [ ] T025 [US7] [research] Per campaign, evaluate + record measured-closure (all leads resolved/acquired, all repos logged, residual documented as `irreducible` with basis and no `unexamined` dimension left); update `RESEARCH_LOG.md`. Pulls T024 to count consecutive dry rounds mechanically once the loop reaches searched-for-now evaluation.

## Phase 4 — Tooling, built on demand (each becomes its own small spec via the front door when its Phase-3 pass proves the need — NOT built up front)

These are the genuinely-missing code units. **None is a blocking prerequisite.** When a Phase-3 pass hits the concrete need, capture it (FR-013 / T027), then spec + build the minimal version via define → execute (typed, `@/` imports, no `any`, files ≤ 300–500 lines, test-first). Listed so the need is *named*, not so it is pre-built.

- [ ] T005 [tool-on-demand] Append-safe **search-log authoring** path in `src/bibliography/search-log.ts` (write a `SearchLogRecord` without rewriting others'); test INV-1 (a search always yields a committed record, incl. `dry`). *Pulled by US1 when hand-authoring records is repetitive/error-prone.*
- [ ] T006 [tool-on-demand] **Evidence-class facet** (open seed vocab R2) on the Source model + `bib` assignment path; soft-warn on unknown class. *Pulled by US5.*
- [ ] T029 [tool-on-demand] **Three-state extent** on the campaign model — `knownMemberCount: number | 'unexamined' | 'irreducible'`, `extentBasis` required for a number and for `irreducible`, omitted for `unexamined` — and render it distinctly in `bib coverage` (never a bare `unknown`); test the basis-required rule + the render (R9). *Pulled by US6.*
- [ ] T003 [tool-on-demand] `RepositoryAdapter` interface (`search`/`resolveIdentifier`/`determineRights`/`acquire`), typed. *Pulled when a second repository (Trove) proves a shared seam is warranted — not before one exists (R4/R7: don't abstract on n=1).*
- [ ] T004 [tool-on-demand] **Gallica adapter** wrapping the shipped fetcher; tests INV-2 (unverifiable → throw), INV-3 (rights gate), INV-6 (never `bib migrate`). *Pulled only if the shipped `bib acquire` Gallica path (T014) proves insufficient for the loop.*
- [ ] T007 [tool-on-demand] Wire the loop step `adapter.search(campaign)` → append `SearchLogRecord` → surface candidates; integration test vs a fixture adapter. *Pulled once ≥1 automated adapter exists (T004/T015).*
- [ ] T015 [tool-on-demand] **Trove adapter** (Trove API search + resolve + rights + bespoke acquire); tests INV-2/3/4/5. *Pulled by T016 — the first proven non-Gallica acquisition.*
- [ ] T017 [tool-on-demand] **IIIF acquire helper** reused by IIIF-exposing repositories (Internet Archive, libraries) behind the adapter interface; test. *Pulled when the first IIIF repository is actually reached.*
- [ ] T018 [tool-on-demand] **Bibliographic-mining** discovery source feeding `bib discover`/`inventory` (citations/footnotes/advertisements from acquired-source text); fail loud on unverifiable (INV-2). *Pulled by US4/T020 when manual mining proves repetitive.*
- [ ] T024 [tool-on-demand] **Dry-round counter** per repository × campaign; mark searched-for-now at 2 (R1); test INV vs fixtures. *Pulled by US7/T025.*

## Phase 5 — Standing cross-cutting (every iteration)

- [ ] T026 [research] After every loop iteration: `bib validate` clean, `bib coverage` shows no silently-empty dimension (SC-007), confirm single-work-once holds (FR-015), then commit + push (Principle IX).
- [ ] T027 [research] Capture each surfaced tooling / per-repository capability gap (missing adapter / authoring path / facet, e.g. HathiTrust / WorldCat / archives) as a backlog item (FR-013) — this is the seam that feeds Phase 4; tracked, never blocking other passes.
- [ ] T028 [research] Honesty pass: RESEARCH_LOG entries state progress as measured deltas + milestone/phase terms — no temporal projections or baseless statistics (Additional Constraints).

## Dependencies & order

- **Research-first.** Phase 1 (baseline) → Phase 2 (reconcile — the zero-code runnable move) → Phase 3 (the loop). Phase 4 tools are pulled *by* Phase-3 passes, never scheduled ahead of them; Phase 5 runs every iteration.
- **No blocking foundational code phase.** A pass is attempted first with shipped verbs / manual authoring; a Phase-4 tool is built only when that pass proves the concrete need (FR-013 / R7 — "built as sources demand, not pre-decomposed").
- P1 (US2 reconcile + US1 search-and-log) is the earliest measured progress; forward discovery (US4) feeds US3/US5 continuously — the loop iterates.

## How this program is executed (and governed)

The loop is **not** run through `/stack-control:execute` as a monolith — its `[research]` passes are interactive judgment against real archives, which no autonomous subagent can faithfully perform. Instead: the operator + agent run the loop; each **[tool-on-demand]** unit, when a pass proves it, is authored and run as **its own small spec** via the front door (define → execute → govern → ship), tier-tagged at that point. 009's own progress is measured by `bib coverage` deltas and recorded in `RESEARCH_LOG.md`, not by an execute ledger.

## MVP scope

**US2 reconcile, then US1 search-and-log** (P1): reconcile the already-acquired sources with a shipped verb (zero code), then turn the empty search history into measured coverage. The first real deliverable needs **no new tooling** — proving the program is runnable now; the tooling register (Phase 4) grows only as the research demands.
