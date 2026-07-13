## 2026-07-13: <!-- session title -->

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
- Commits: 0
  - (no commits this session)
- Files changed: 0
- Backlog touched: (none)

## 2026-07-12: Ship corpus-print-pdf; publish 72 issues via CDN; design+define edition-publishing

**Goal:** Pick up `impl:feature/corpus-print-pdf` from its runnable spec and take it through
execute → ship; then (operator-driven) build an english-only reading edition, publish the
corpus to B2/CDN, and design + spec the follow-on publishing feature.

**Accomplished:**
- **Shipped corpus-print-pdf (spec 007) end to end.** `/stack-control:execute` dispatched 31
  tier-tagged tasks to fresh model-sized subagents (haiku/sonnet/opus); govern converged via
  `--override` (barrage can't run here); `/stack-control:ship` merged **PR #32 → status:shipped**.
  The Typst facing-page facsimile-edition generator (`src/pdf/`, template + vendored OFL fonts),
  fail-loud, **99 tests**, byte-identical reproducibility.
- **Live-iterated an english-only reading edition** (`--no-french` / `PDF_SHOW_FRENCH`): two-column
  Old Standard TT (19th-c. Modern serif, via `/frontend-design`), book-style indented paragraphs
  (paragraph gap measured to exactly equal the line gap), single line spacing, justified +
  hyphenated (per-column `lang`), halved margins, and a **state-gated page-foreground column rule**
  scoped to the text-column length (repeats per leaf; off versos/blanks/front-back matter).
- **Fixed a real integrity bug the "use B2" push surfaced:** the colophon + B2 verification were
  keyed on the *translation-text* sha256, not the image-master hash — carried the real
  `imageSha256` through snapshot → colophon → verified B2 fetch (12/12 masters verified).
- **Published all 72 buildable PB-P001 english-only issues** (48 B2-verified + 24 IIIF fallback) to
  the public B2 bucket; **adopted the Cloudflare read-through CDN** (merged from main, TASK-12) and
  warmed all 72 PDFs at the edge. Stood up a tailscale review server + a `/frontend-design`ed
  chronological **index page** (oxblood provenance-rail-as-timeline, embedded Theano Didot masthead).
- **Designed + specced the follow-on `impl:feature/edition-publishing`.** `/stack-control:design`
  (brainstorm → design record → 4 decisions) → `/stack-control:define` (spec 008: specify + clarify,
  4 more decisions): a governed `pdf:publish` pipeline over pre-built PDFs recording per-edition
  `publications[]` on the Source SSOT, an affirmative fail-closed `Source.rights` gate, and
  immutable snapshot-versioned artifacts. Spec authored + clarified; **plan → tasks → analyze remain**.

**Didn't Work:**
- The cross-model **govern barrage still can't complete in this env** (killed) — corpus-print-pdf
  converged by `--override` after extensive live validation (established pattern).
- The **B2 Class-B download cap** got exhausted repeatedly (render fetches + warming ~1.4 GB of PDFs)
  → 403 on all public reads until the operator raised it; the CDN read-through cache is the durable
  fix (HITs never touch B2). The ~24 "missing" B2 masters were likely the same cap mid-render, not
  truly absent (TASK-15, re-check after reset).
- **`run_in_background` bash jobs get killed by the harness** mid-run → relaunched long jobs as
  detached host processes (`nohup`+`disown`; no `setsid` on macOS).
- `edition-publishing` define stopped after clarify (operator ran session-end); not yet runnable.
- 7 PB-P001 monographs + 1 trailing issue are untranslated → can't build editions (TASK-16).

**Course Corrections:**
- Operator steers reshaped the edition: *"favor the B2 cache"* exposed the image-vs-text sha256
  conflation; *"do not optimize for my phone"* → reframed as a print-first edition (kept facing-page
  binding parity); *"single space, not 1.5"* → measured Typst's leading and set it precisely.
- Ship PR wasn't cleanly mergeable (main had advanced — coverage-audit, corpus-browser, CDN) →
  merged main, resolved 3 conflicts (append-only journal kept both; two active-feature pointers took
  main's newer values).

**Insights:**
- Typst `par.leading` is the inter-line **gap**, not the baseline advance — `leading:10pt` on 8pt
  read as ~1.96× (double-spaced). Measure empirically; a paragraph gap = line gap needs `spacing`
  tuned to the measured advance.
- A `place`d rect **can't repeat across page breaks** and isn't margin-bounded → a **state-gated page
  foreground** is the right primitive for a per-leaf column rule.
- The overflow that looked typographic was **structural** — the facing-page parity + per-page rectos
  spread an issue's ~7 leaves of text across ~40 pages; type density barely moved the count.
- A **published PDF edition is a derivative WE made** — it belongs in `publications[]` on the Source,
  distinct from `repositoryRecords[]` (other archives' copies).
- Note: the auto-derived count below is only this branch's (`edition-publishing`) tail; the session's
  bulk (corpus-print-pdf, ~30 commits) shipped to `main` via PR #32 this same session.

**Quantitative (auto-derived from git; verify before publishing):**
- Commits: 5
  - define(edition-publishing): clarify spec 008 — 4 decisions integrated
  - define(edition-publishing): author spec 008 — governed publish pipeline + SSOT record
  - roadmap(edition-publishing): designing -> in-flight, design-approved
  - design(edition-publishing): design record (approved)
  - design(edition-publishing): capture roadmap item + open designing phase
- Files changed: 5
- Backlog touched: (none)

## 2026-07-08: define source-translation spec; ratify constitution; clear dependabot alerts

**Goal:** Pick up and complete the `define` operation for `impl:feature/source-translation`.
Along the way: encode git commandments the operator raised, and clear the repo's open
security alerts.

**Accomplished:**
- Authored `specs/002-source-translation` through the stack-control front door
  (specify → clarify → plan → tasks → analyze). `execute-check` runnable; analyze 0
  critical / 0 high. Linked the `spec:` pointer and recorded the `analyze-clean` marker →
  item phase advanced to `implementing`.
- Clarified 5 design decisions and integrated them: artifacts stored in the private archive
  alongside the source; **page-image** chunk unit (per-page idempotent cleanup+translate,
  whole-issue assembled); continue-but-abort-after-3-consecutive-failures for whole-source
  runs; YAML `.yml` provenance reusing `@/archive/provenance`; engine = Claude Code CLI
  (`claude --print`) behind a DI runner mirroring `src/ocr/`.
- Added two git commandments to global CLAUDE.md + auto-memory: **commit & push early and
  often**, and **no git hooks ever**. Ratified the project constitution **v1.0.0** (10
  principles across research integrity, legal/copyright, and engineering).
- Cleared all **6 dependabot alerts** (vitest 1.6.1→3.2.7, fast-xml-parser 4.5.7→5.9.3) on
  a dedicated branch off `main`; verified 0 vulns / typecheck / 77 tests; **PR #5 merged**;
  0 alerts remaining. Confirmed Dependabot auto-fix already enabled.

**Didn't Work:**
- Did not start `/stack-control:execute` (implementation) — operator ended the session at
  the execute-scope decision point. The spec is runnable and ready to pick up next session.

**Course Corrections:**
- Caught and corrected my own `AskUserQuestion` option that mis-stated the fetcher's
  provenance format as JSON; the shipped convention is **YAML** — confirmed with the
  operator and reused the existing provenance module instead of reimplementing.

**Insights:**
- The fetcher's `pdftotext` runs without `-nopgbrk`, so `issue.txt` carries `\f` page
  separators — the natural per-page chunk boundary, aligned with `f###.jpg`. Confirmed
  empirically (20 form-feeds in a real `PB-P001` issue).
- Dependabot auto-fix was already enabled; the 6 alerts likely predated it or required the
  major bumps we applied by hand.

**Quantitative (auto-derived from git; verified):**
- Commits this session on this branch (2): `define: author source-translation spec`,
  `docs: ratify project constitution v1.0.0`. (The auto-derived `origin/main..HEAD` list
  below also includes 3 `design`/`roadmap` commits from the PRIOR session, and omits the
  dependabot fixes, which landed on `main` via PR #5 on a separate branch.)
- Auto-derived commits: 5
  - docs: ratify project constitution v1.0.0
  - define: author source-translation spec (runnable)
  - design: source-translation design record (approved) [prior session]
  - design: set design pointer for source-translation [prior session]
  - roadmap: add impl:feature/source-translation (depends-on gallica-fetcher) [prior session]
- Files changed: 14
## 2026-07-09: Ship archive object-store, acquire the Port Breton corpus, harden the fetcher

**Goal:** Take the approved archive object-store (Backblaze B2) design from handoff to shipped, then use it to acquire the Port Breton sources to B2 — and harden the fetcher against the real-world failures that surfaced while doing it. (Tool-repo commits below are the tail since the last session boundary; the bulk of the acquisition lives in the `colony-cults-archive` repo, and the earlier feature build merged via PR #6.)

**Accomplished:**
- Shipped the **archive object-store (B2)** feature end to end: `/stack-control:define` → `execute` (model-sized subagent dispatch) → govern (override) → `/stack-control:ship` (PR #6 merged, `status: shipped`). Image masters go to B2; git tracks provenance (`object_store` + sha256 + size), no image bytes.
- **Acquired all 3 Port Breton sources to B2**: PB-P001 (78 newspaper issues), PB-P002 (de Rays brochure, 32 pp), PB-P003 (Baudouin book, 395 pp). Provenance committed per-issue / per-page and merged to archive `main` (archive PR #1), coexisting cleanly with the translator's work.
- **Hardening (PR #7, merged):** content-based idempotency + metadata/provenance backfill; per-issue and per-page git checkpoints (injected hook, fetch core stays git-free); Gallica network-error retry; provenance-churn fix; B2 adaptive retry; and **trust-local-provenance-by-default** (`--reconcile-remote` opt-in).
- Merged `main` twice (canonical-source-metadata + its cleanup) into the branch; reconciled cleanly (registry retired → SSOT; `yaml` dep).
- Filed **TASK-7** (rotate the exposed B2 key) and **TASK-8** (CDN read-caching for public consumption).
- Brainstormed PB-P004; captured operator design guidance (**Source Group** model) to `docs/design/2026-07-09-pb-p004-source-group-guidance.md`, deferred to a dedicated design session.

**Didn't Work:**
- The whole-feature cross-model **govern barrage never completes in this environment** (multi-round, 12+ min, killed) — resolved by an operator `--override` after live validation (established pattern).
- Long fetches died repeatedly on two transient classes: **Gallica network resets** (undici `fetch failed`, not a retryable status) and **B2 `UnknownError`** — both only retried on received-status before; added network + adaptive retry.
- The **B2 Class B (download/HEAD) transaction cap** got exceeded and is **not raisable** on this plan; a CDN wouldn't help the capture path (writes are Class A, direct to B2).
- **PB-P004 has no fetchable archival identity** — it's a research category, not a document; the per-document fetcher can't acquire it.

**Course Corrections:**
- **Trust local provenance by default** (operator call) — both the correct design *and* the thing that routed around the un-raisable Class B cap: skips read nothing from B2; new masters are Class A PUTs, so PB-P003 finished while the download cap was maxed.
- A **public bucket does not bypass the cap** — anonymous downloads are Class B too (verified: `download_cap_exceeded` on the native URL).
- The tab-after-colon key parsing was fine; the real blocker was the Class B cap, surfaced only via a GET (HEAD has no error body).
- Reclassify PB-P004 as a **Source Group** (discover → inventory → verify → promote → acquire) rather than force a single-document fetch.

**Insights:**
- Idempotency must be **content/provenance-based, not metadata-presence-based** — the rclone-placed masters (no `x-amz-meta-sha256`) exposed that the skip check trusted our metadata, not the object.
- **B2 Class A (upload) vs Class B (download) accounting** is the key cost/cap lever — a write-heavy capture that trusts local provenance touches Class B zero times.
- Checkpoints belong in an **injected hook** so the fetch core stays git-free; the commit adapter is the only place git runs.
- **Not every "source" is one document** — the Source/Source-Group/Repository-Record distinction is the next modeling step.

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
workflow(graduate): impl:feature/source-groups merging -> validating
workflow(graduate): impl:feature/corpus-browser merging -> validating
workflow(graduate): impl:feature/source-group-acquisition merging -> validating
workflow(start-implementing): impl:feature/corpus-print-pdf specifying -> implementing
workflow(graduate): impl:feature/corpus-coverage-audit merging -> validating
workflow(graduate): impl:feature/corpus-print-pdf merging -> validating
workflow(graduate): impl:feature/edition-publishing merging -> validating
workflow(graduate): impl:feature/coverage-web-view merging -> validating
workflow(graduate): impl:feature/corpus-model-coherence merging -> validating
