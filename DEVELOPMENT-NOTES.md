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
- Backlog touched: (none)

workflow(graduate): impl:feature/gallica-fetcher merging -> validating
