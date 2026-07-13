# Phase 0 Research: Corpus Gap Closure

Resolves the open methodology decisions from the design + spec. Each: Decision / Rationale / Alternatives considered.

## R1 — Dry-round threshold for "searched-for-now" (FR-011, US7)

**Decision**: A repository × campaign is marked **searched-for-now after 2 consecutive dry search rounds** (a round that surfaces no new candidate), recording the dry-round evidence. It is revisitable, not permanent.

**Rationale**: One dry round is too eager (a single query can miss); three-plus hits diminishing returns for a bounded 19th-century case. Two matches the audit's "loop-until-dry" pattern and keeps the residual honest.

**Alternatives**: 1 round (too eager — false "exhausted"); ≥3 (wasteful for this corpus size); time-based (arbitrary, not evidence-keyed).

## R2 — Evidence-class vocabulary (FR-005, US5)

**Decision**: An **open, extensible controlled list**, seeded with: book, pamphlet, prospectus, newspaper, periodical-article, trial-record, government-report, parliamentary-paper, correspondence, map, photograph, memoir, survivor-account, missionary-record. New classes are added as sources demand; validation warns on an unknown class but does not reject (soft-closed).

**Rationale**: An open historical corpus surfaces genres we cannot fully enumerate in advance; a hard-closed vocab would force misclassification, violating Principle II (preserve uncertainty) and inviting false precision. A seed list gives faceting without over-committing.

**Alternatives**: hard-closed vocab (rejected — forces misclassification / false precision); free-text (rejected — no reliable faceting for the audit).

## R3 — Search-log granularity + schema (FR-001, US1)

**Decision**: **Repository × campaign** records, using the shipped `search-log.yml` shape: `repository`, `campaign`, `date` (last search), `coverage` (short descriptor of what was covered), `remaining-questions`, and an `outcome` (candidates-found | dry). Manual and automated searches use the same record shape.

**Rationale**: Matches the shipped search-log + coverage-report model (repo × campaign matrix + repository rollup); coarse enough to maintain by hand, fine enough to measure coverage and dry-rounds.

**Alternatives**: repository × case (too coarse — hides per-campaign coverage); per-query log (too fine — noise, no clean coverage read).

## R4 — Multi-repository acquisition/discovery seam (FR-003, US3)

**Decision**: A composed **`RepositoryAdapter` interface** (injected, per Principle VI): `search(campaign) → Candidate[]`, `resolveIdentifier(candidate) → stable id`, `determineRights(id) → public-domain | restricted | uncertain`, `acquire(id, --object-store) → provenance`. The **Gallica adapter wraps the shipped fetcher**; IIIF-exposing repositories (Internet Archive, many libraries) share an **IIIF acquire helper**; non-IIIF repositories (Trove API, museum holdings) implement bespoke `acquire`. Adapters are built **as sources demand** — **Trove first** (PB-P005).

**Rationale**: Composition/DI keeps each repository a small, testable, swappable unit; reuse the IIIF path where the standard allows; never fork the fetcher wholesale. Faithful to Principles V/VI/VII.

**Alternatives**: fork the fetcher per repository (rejected — duplication); one mega-fetcher with repository branches (rejected — coupling, violates composition); no adapter layer / manual-only acquisition (rejected — not durable/reusable).

## R5 — Per-repository rights determination (FR-007, Principle IV)

**Decision**: Each adapter's `determineRights` returns `public-domain | restricted | uncertain`; **only `public-domain` permits mirroring** — `restricted` and `uncertain` block it (fail closed) while the source stays cataloged. Gallica uses OAI `dc:rights`; Trove/IA use their item metadata + jurisdiction rules (e.g. Australian pre-1955 photographs are PD). Rights basis is recorded on the record.

**Rationale**: Principle IV (Respect Copyright, fail closed) is a hard precondition; uncertainty must block mirroring, never cataloging.

**Alternatives**: assume-PD-then-check (rejected — fails open); mirror-then-remove (rejected — legal exposure).

## R6 — Reuse-vs-new boundary (FR-012)

**Decision**: **Reuse** unchanged: `bib discover | inventory | verify-member | promote | acquire | reconcile | coverage | validate`. **New/extended**: the `RepositoryAdapter` layer (§R4); a **search-log authoring path** (append a record safely, distinct from the read/validate the audit shipped); a **bibliographic-mining** discovery source feeding `discover`/`inventory`. **Never** `bib migrate` (rebuilds from stale legacy CSVs — TASK-8).

**Rationale**: Maximize reuse (Principle VIII); add only the genuinely-missing seam.

**Alternatives**: rebuild the pipeline (rejected — waste, off-roads shipped tooling).

## R7 — Program decomposition (FR-013)

**Decision**: Run the program as **one governed roadmap item**; per-repository adapters and per-campaign passes are **tasks within it**, captured as reached (Trove first). If an adapter grows into a substantial capability, it may be **promoted** to its own feature later (backlog→spec seam), not pre-decomposed.

**Rationale**: The program is the coherent deliverable; premature epic-with-children decomposition is structure for its own sake. Promotion-when-warranted respects "capture, scope later."

**Alternatives**: epic + child feature per repository up front (rejected — heavier than warranted now; keep the option open).

## R8 — Cadence, honesty, and the research log (Constitution IX + Additional Constraints)

**Decision**: Each loop iteration commits + pushes bibliography/search-log changes and appends to `RESEARCH_LOG.md`. Progress is stated in **milestone/phase** terms and as the audit's measured deltas — **never** temporal projections or baseless statistics (false precision erodes trust).

**Rationale**: Durable work (Principle IX) + honesty-in-language (Additional Constraints); the program must survive context loss.

**Alternatives**: batch commits at "done" (rejected — un-replicated state is the dangerous one); progress-by-percentage (rejected — false precision over an `unknown` denominator).
