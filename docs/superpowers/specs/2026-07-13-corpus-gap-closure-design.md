# Design: Corpus Gap Closure (`impl:feature/corpus-gap-closure`)

- Date: 2026-07-13
- Roadmap item: `impl:feature/corpus-gap-closure`
- Depends-on: `impl:feature/corpus-coverage-audit` (shipped — measures the gap),
  `impl:feature/source-group-acquisition` (shipped — discover→inventory→verify→
  promote→acquire→reconcile pipeline), `impl:feature/gallica-fetcher`,
  `impl:feature/canonical-source-metadata`, `impl:feature/archive-object-store`
  (all shipped/closed).
- Status: designing (awaiting operator approval marker)
- Backend: `superpowers:brainstorming` via `/stack-control:design`.
- Note: a **research program**, not a coding effort — but governed with a design,
  spec, and plan. Captured at **full scope, no YAGNI** (operator directive).

## Problem domain

The `corpus-coverage-audit` **measures** the gap between what the archive holds and
the full evidentiary record of the Port Breton / Marquis de Rays affair, but nothing
**closes** it. As of 2026-07-13 the audit reads the gap as mostly `unknown`:

- **Search history is empty** — no repository has been searched-and-logged, so the
  audit cannot distinguish "searched, nothing there" from "never looked." This is
  the dominant gap: it forces every other dimension to `unknown`.
- `knownMemberCount` is `unknown` for both campaigns (PB-P004, PB-P006) — coverage
  is uncomputable.
- **13 of 13 sources are unclassified** (no evidence-class facet).
- PB-P006 carries **suspected** items (New Italy Museum photographs, survivor
  accounts) that are unidentified/undigitized.
- Several sources are unacquired **across multiple repositories**: PB-P001 partial
  (`collecting`), PB-P003 acquired-but-unreconciled, PB-P002 (Gallica, no ark yet),
  **PB-P005 (Trove/NLA — not Gallica)**.

The gap is therefore **multi-dimensional, multi-repository, and open-ended** (it
includes sources we do not yet know exist). There is no governed process to drive it
down, and the prior framing — acquire the Gallica known-but-missing (TASK-17, since
completed) — addressed only one slice. Two operator corrections define the true
mandate: (a) the corpus is **not restricted to Gallica**; (b) closing the gap
**requires forward discovery** to find new things to research after everything
currently known is acquired.

## Solution space

### Chosen — a governed, iterative discovery-and-acquisition program

A repeatable, `bib coverage`-driven research program that drives the *measured* gap
down and keeps it measured, building capability per repository as sources demand.

- **The loop (per campaign / repository):** search-and-log a repository → discover /
  inventory / verify / promote candidates → **acquire (any repository)** → reconcile
  the SSOT → re-measure with `bib coverage` → repeat. Reuses the shipped
  source-group-acquisition pipeline end-to-end.
- **Forward discovery as first-class:** bibliographic mining of every acquired source
  (citations, footnotes, publisher ads, archival references), plus resolution of
  `suspected`/`referenced` leads, to surface unknown-unknowns — not just process the
  current known list. The loop iterates: acquire the known → discover more → acquire
  → repeat.
- **Multi-repository:** Gallica, BnF catalogue, Trove/NLA, Internet Archive,
  HathiTrust, WorldCat, National Archives, State Library of Queensland, the New Italy
  Museum, and in-source bibliographies. **Acquisition/discovery adapters are built
  per repository as sources demand** — Gallica is shipped; others (Trove first, for
  PB-P005) are a capability sub-track. The fetcher's IIIF path likely generalizes to
  other IIIF providers; non-IIIF repositories (Trove API, museum holdings) get
  bespoke adapters.
- **Populate every audit dimension:** the **search-log** (repository × campaign,
  dated, coverage, remaining questions); `knownMemberCount` where research supports a
  defensible number; **evidence-class** for all sources; **suspected/referenced**
  resolution. Acquisition is the smallest slice.
- **"Closed" defined honestly — measured, not zero.** For an open historical corpus
  the audit deliberately keeps `unknown` a valid, permanent state; we can never prove
  we have found every 1880s document. **Closed = every surfaced lead
  resolved-or-acquired + all in-scope repositories searched-and-logged + a maintained
  discovery loop keeping the documented residual shrinking.** A documented `unknown`
  extent is a valid terminal state, never asserted as complete.
- **Fail loud, rights-gated.** Discovery never fabricates candidates (ambiguous /
  unverifiable → fail loud, no invented ARKs). Every acquisition passes a
  per-item public-domain rights determination first (per repository — Gallica OAI
  `dc:rights` exists; other repos need their own rights logic).
- **Immediate track-1 wins reuse shipped tooling** (visible movement now): reconcile
  PB-P003 + PB-P001, classify the 13 sources, acquire PB-P002. Non-Gallica capability
  is a tracked sub-thread, not a blocker on the program.

### Rejected — narrow acquisition-only campaign (the original TASK-17 framing)

Acquire the known-but-missing Gallica sources and stop. Rejected: it closes one
slice and ignores the search-history vacuum, forward discovery, classification,
known-extent, and every non-Gallica repository. It is the slice, not the gap — and
it is exactly the framing the operator corrected.

### Rejected — one-shot exhaustive "enumerate everything, then acquire"

Attempt a complete up-front enumeration of the corpus, then acquire against the list.
Rejected: it assumes the historical record is knowable in advance; it is not. It
contradicts the audit's measure-don't-assert design (which treats `unknown` as
valid), produces a false sense of completeness, and is brittle to newly-surfaced
sources.

### Rejected — ad hoc / un-governed opportunistic acquiring

Keep acquiring whatever is convenient, with no structure — the status quo. Rejected:
no measured progress, repeated re-searching, missed repositories, no record of what
was searched, and no way to know how complete we are. The entire point of the audit
+ this program is structure.

## Decisions

1. A **governed, iterative program** driven by `bib coverage`, not a one-off task.
2. **Multi-repository**; per-repository acquisition/discovery **adapters built as
   sources demand** (capability sub-track; Trove first for PB-P005). Not
   Gallica-restricted.
3. The **loop** (search-and-log → discover/inventory/verify/promote → acquire →
   reconcile → re-measure) **plus forward discovery** (bibliographic mining +
   suspected/referenced resolution) as first-class.
4. Populate **all** audit dimensions — search-log, known-extent, evidence-class,
   suspected/referenced — not just acquisition.
5. Scope = **the whole Port Breton case + all repositories + unknown-unknowns**; no
   narrowing to the two current campaigns.
6. **"Closed" = measured, not zero;** a documented `unknown` residual is a valid
   terminal state.
7. **Fail loud** on unverifiable/ambiguous discovery (no fabricated candidates);
   **per-item public-domain rights gate** before every acquisition.
8. **Reuse** the shipped source-group-acquisition pipeline; **track-1 wins run now**
   (reconcile PB-P003/PB-P001, classify, acquire PB-P002); non-Gallica capability is
   a tracked sub-thread, not a blocker.

## Open questions

_Carry into `/stack-control:define`; none are blockers._

- **Search-and-log granularity + schema:** repository × campaign vs repository × case;
  the `coverage` descriptor and `remaining-questions` shape the search-log records.
- **Known-extent methodology:** which campaigns admit a defensible `knownMemberCount`
  (e.g. a bounded trial corpus) vs permanent `unknown` (e.g. New Italy holdings).
- **Discovery-mechanism maturity per repository:** currently one spiked BnF-SRU
  mechanism + operator-supplied ARKs; which repositories get automated search
  adapters vs operator-driven manual search-and-log.
- **Non-Gallica acquisition:** IIIF-generalization for IIIF providers (Internet
  Archive, many libraries) vs bespoke adapters (Trove API, museum holdings); build
  sequencing.
- **Per-repository rights determination:** Gallica OAI `dc:rights` exists; Trove /
  Internet Archive / museum need their own rights logic and per-item PD tests.
- **Evidence-class vocabulary finalization:** book / pamphlet / prospectus /
  newspaper / trial-record / government-report / parliamentary-paper / correspondence
  / map / photograph / memoir / survivor-account / missionary-record / …
- **Exhaustion + completion criteria:** how many "dry" discovery rounds mark a
  repository "searched for now"; how the program declares its own (measured)
  completion vs an ongoing maintained loop.
- **Reuse-vs-new boundary:** precisely what the loop reuses from the shipped pipeline
  (discover/inventory/verify/promote/acquire/reconcile) vs genuinely new capability
  (search-log workflow, per-repository adapters, bib-mining).
- **Decomposition:** whether the plan runs the program as one deliverable or spawns
  per-repository capability adapters as child features as they are reached.

## Provenance

- Origin: interactive orchestration across this session. The mandate was
  progressively clarified — from "acquisition-first PB-P004" (TASK-17, since
  completed via the new `bib reconcile` verb) to the operator's correction that the
  true mandate is **closing the gap the audit describes**, which is **(a)
  multi-repository** (not Gallica-only) and **(b) includes forward discovery** of
  sources not yet known to exist. Operator directives: govern via stack-control
  (design → spec → plan); non-coding but fully structured; **NO YAGNI — capture the
  full scope.**
- Consumes shipped features: `corpus-coverage-audit` (the gap measure + search-log +
  evidence-class + reconcile), `source-group-acquisition` (the discover→acquire→
  reconcile pipeline), `gallica-fetcher`, `canonical-source-metadata`,
  `archive-object-store`.
- Handoff target: `/stack-control:define`.
