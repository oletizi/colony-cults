## 2026-07-09: <!-- session title -->

**Goal:** <!-- compose: what we set out to do -->

**Accomplished:**
- <!-- compose -->

**Didn't Work:**
- <!-- compose -->

**Course Corrections:**
- <!-- compose -->

**Insights:**
- <!-- compose -->

**Quantitative (auto-derived from git; verify before publishing):**
- Commits: 13
  - Merge remote-tracking branch 'origin/main' into feature/archive-object-store
  - backlog: capture CDN read-caching for public consumption (TASK-8)
  - Merge pull request #7 from oletizi/feature/archive-object-store
  - roadmap: close impl:feature/canonical-source-metadata (validated -> closed)
  - feat(archive-object-store): trust local provenance by default (B2 verify is opt-in)
  - Merge remote-tracking branch 'origin/main' into feature/archive-object-store
  - Merge pull request #9 from oletizi/feature/canonical-source-metadata
  - refactor(bibliography): archive register/stubs are curated migrate input, not views
  - Merge remote-tracking branch 'origin/main' into feature/archive-object-store
  - Merge pull request #8 from oletizi/feature/canonical-source-metadata
  - fix(archive-object-store): resilient B2 client (adaptive retry, maxAttempts 10)
  - fix(archive-object-store): preserve provenance on idempotent skip (no retrieved churn)
  - fix(gallica): retry network-level fetch rejections, not just retryable statuses
- Files changed: 20
- Backlog touched: TASK-8

## 2026-07-09: Author canonical-source-metadata spec through the stack-control front door

**Goal:** Take the approved canonical source metadata design (handed off in the prior session's commit `c1b0689`) and author a *runnable* Spec Kit spec for `impl:feature/canonical-source-metadata` via `/stack-control:define`.

**Accomplished:**
- Approved the design (recorded the `design-approved` marker) after the compass gated `define` for an unmet designing-phase exit gate.
- Drove the full authoring chain through the front door: `/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks`. Result: `specs/004-canonical-source-metadata/` with spec (5 user stories, 20 FRs, 8 SCs), research (R-001…R-007), data-model, 3 contracts, quickstart, and 31 tiered tasks.
- `stackctl spec-check` → `spec=yes plan=yes tasks=yes`; `execute-check` → **runnable**. Spec linked to the roadmap node.
- Resolved 4 clarify questions (hybrid SSOT direction; public `bibliography/sources/PB-###.yml`; closed vocab + minimal required core; legacy files → generated-and-committed views).

**Didn't Work:**
- Nothing broke. The one hard stop was expected: the compass refused `define` (`verdict: ahead`) because the design phase's `design-approved` marker was absent — the gate doing its job, not a defect.

**Course Corrections:**
- Skipped the mandatory `speckit.git.feature` branch-creation hook: we were already on `feature/canonical-source-metadata`, the branch the roadmap node id and design commit are keyed to. Creating a new `NNN-…` branch would have diverged from the governed identity; define resolves the active spec via the CLAUDE.md SPECKIT marker, not the branch.
- Numbered the spec `004` (next after existing `001`/`003`).

**Insights:**
- Grounding the plan in the real codebase paid off: `src/archive/source-registry.ts`'s singular `sourceArchive` field is literally the PB-P001 overwrite bug the model exists to fix, and `src/model/source.ts` is Gallica-specific (single `gallicaArk`). The plan retires/generalizes both.
- The project already hand-serializes deterministic YAML (`src/archive/provenance.ts`, fixed field order → byte-identical) — reused as the mechanism for FR-015 reproducible views rather than adding serialization machinery.
- Front-door marker discipline: each `/speckit-*` drive was bracketed by a session-keyed `front-door enter/exit`, carrying the literal token across the two Bash calls; every marker closed cleanly (no leaks).

**Quantitative (auto-derived from git; verify before publishing):**
- Commits: 5
  - tasks(canonical-source-metadata): generate tasks.md — spec is runnable
  - plan(canonical-source-metadata): plan + research + data-model + contracts + quickstart
  - spec(canonical-source-metadata): clarify — resolve 4 open questions
  - spec(canonical-source-metadata): author spec via /stack-control:define
  - govern(canonical-source-metadata): approve design — record design-approved marker
- Files changed: 13
- Backlog touched: (none)

workflow(graduate): impl:feature/gallica-fetcher merging -> validating
workflow(graduate): impl:feature/archive-object-store merging -> validating
workflow(graduate): impl:feature/canonical-source-metadata merging -> validating
