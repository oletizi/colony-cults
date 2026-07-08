<!--
Sync Impact Report
- Version change: (template / unratified) → 1.0.0
- Rationale: First ratified constitution — replaces the unfilled Spec Kit template with
  concrete principles. MAJOR (0→1) establishes the initial governing baseline.
- Principles defined (10):
    I. Evidence Before Narrative
    II. Preserve Disagreement & Uncertainty
    III. Provenance Is Mandatory
    IV. Respect Copyright (Fail Closed)
    V. Fail Loud, No Fallbacks
    VI. Composition Over Inheritance
    VII. Type Safety Is Non-Negotiable
    VIII. Faithful Tool Adoption
    IX. Durable Work — Commit & Push Early and Often
    X. No Git Hooks, Ever
- Added sections: Additional Constraints (Technology & Conventions);
  Development Workflow & Session Standard; Governance.
- Sources reconciled: global CLAUDE.md engineering commandments; AGENTS.md (research
  standards, copyright/acquisition, translation & OCR policy, metadata); GOVERNANCE.md
  (durable-commits, evidence-before-narrative, survive-context-loss).
- Templates reviewed for alignment:
    ✅ .specify/templates/plan-template.md — "Constitution Check" gate accommodates these principles
       (see specs/002-source-translation/plan.md for a worked Constitution Check).
    ✅ .specify/templates/spec-template.md — no mandatory-section conflict.
    ✅ .specify/templates/tasks-template.md — principle-driven task types (tests, fail-loud) already expressible.
- Follow-up TODOs: none deferred. Note: this project's stance is NO git hooks (Principle X) —
  any pre-commit/pre-push hooks currently installed should be removed (enforcement moves to
  skills / CLI / code review / CI).
-->

# Colony Cults Constitution

The `colony-cults` project is a public digital-humanities research workspace and its
supporting tooling (source acquisition, OCR, translation). This constitution states the
non-negotiable commandments that govern both the research record and the code. It supersedes
ad-hoc practice; `CLAUDE.md`, `AGENTS.md`, and `GOVERNANCE.md` are its runtime elaborations.

## Core Principles

### I. Evidence Before Narrative

Prefer primary sources over secondary summaries. Every factual claim MUST move toward a stable
source ID, and evidence, interpretation, and uncertainty MUST be kept visibly separate.
Speculation MUST NOT be converted into fact. Rationale: the archive's value is its
evidentiary integrity; a claim without traceable evidence is a liability, not an asset.

### II. Preserve Disagreement & Uncertainty

When sources disagree, record BOTH claims, attach a source ID to each, and add a note
describing the conflict; do NOT force a resolution without evidence. Uncertainty MUST be
recorded explicitly rather than smoothed over. Rationale: premature resolution destroys
information that later evidence may need.

### III. Provenance Is Mandatory

Every source record carries at least: source ID, title, creator/author/editor, date or range,
source type, language, catalog URL / stable identifier, rights status, acquisition status, and
reliability/bias notes. Every mirrored asset additionally carries: local path, retrieval date,
original URL, checksum, file format, and OCR status. OCR is evidence-adjacent, NOT evidence —
original scans remain the authority; record the OCR engine, date, and known quality issues.
Rationale: provenance is what makes the record auditable and reproducible.

### IV. Respect Copyright (Fail Closed)

Mirror ONLY legally acquirable, preservable material: public-domain, openly licensed, reusable
government publications, or archive material whose terms permit download/preservation.
Copyrighted or restricted material (copyrighted books, restricted reproductions, subscription
exports, licensed articles, full copyrighted translations) MUST NOT be mirrored — it may still
be cataloged, summarized, and cited. Copyright uncertainty BLOCKS mirroring, never cataloging.
Translations MUST retain the original-language citation, be labeled machine-assisted unless
human-reviewed, quote sparingly with page references, and MUST NOT commit a full translation of
a copyrighted work. Rationale: legal integrity is a hard precondition for a public archive.

### V. Fail Loud, No Fallbacks

Never implement fallbacks or use mock data outside test code. Missing functionality or data
MUST raise a descriptive error naming what is absent. Rationale: errors reveal what is not yet
implemented; fallbacks and mock data are bug factories that hide it.

### VI. Composition Over Inheritance

Avoid class inheritance. Build complex behavior by composing small parts behind interfaces,
with interface-first contracts across organizational boundaries and constructor dependency
injection using interface types. External tools (OCR, translation engines) are shelled out
behind injected runners, never reimplemented and never called as ambient globals. Rationale:
composition + DI keeps units small, testable, and swappable.

### VII. Type Safety Is Non-Negotiable

No `any`, no `as Type`, no `@ts-ignore`. TypeScript imports use the `@/` path pattern. Source
files stay within 300–500 lines; anything larger MUST be refactored for readability and
modularity. Rationale: the type system is a correctness tool; bypassing it forfeits the
guarantee and the refactor signal.

### VIII. Faithful Tool Adoption

Adopted tools MUST be driven through their sanctioned interfaces in their prescribed order — do
not skip, off-road, or reimplement them. Spec-driven work flows through the stack-control front
door (define → execute → ship) over native Spec Kit; a missing tool mechanism surfaces its
underlying error verbatim rather than being papered over. Rationale: faithful adoption keeps
the workflow portable, auditable, and free of divergent shadow implementations.

### IX. Durable Work — Commit & Push Early and Often

Git is a journaled, distributed data store: uncommitted work is temporary, committed work is
durable, pushed work is recoverable. Each coherent unit of work MUST be committed the moment it
is coherent and pushed promptly; changes MUST NOT be hoarded in the working tree awaiting a
"done" moment. Never lose work; the project MUST survive context loss, so session state lives in
committed files, not in memory. Rationale: the dangerous state is the un-replicated one.

### X. No Git Hooks, Ever

Enforcement lives in skills, CLI verbs, code review, and CI — NEVER in git hooks. Git hooks MUST
NOT be installed or depended upon: they are local, inconsistent across machines, invisible in
review, and impede commit-and-push-early (Principle IX). Where hooks already exist in a repo,
they MUST NOT be silently bypassed (no `--no-verify` end-runs) — instead remove them or fix the
underlying failure. Rationale: durable, portable enforcement cannot rely on an opt-in local
side-channel.

## Additional Constraints (Technology & Conventions)

- **Runtime**: TypeScript executed with `tsx`. Do NOT use `ts-node`. (`tsx`, not "nox tsx".)
- **File naming**: lowercase kebab-case; avoid spaces and ambiguous abbreviations.
- **Commit messages**: concise conventional-style (`docs:`, `research:`, `bibliography:`,
  `archive:`, `define:`, etc.).
- **Honesty in language**: do NOT label work "production-ready"; do NOT state project-management
  goals in temporal terms (use milestone / sprint / phase); do NOT offer baseless projection
  statistics. False precision erodes trust.
- **Repository boundary**: the public repo holds research metadata, notes, schemas, and tooling —
  never copyrighted scans or restricted reproductions; legally mirrorable assets live in the
  private `colony-cults-archive` repo.

## Development Workflow & Session Standard

- **Start of session**: read `PROJECT.md`, `ROADMAP.md`, `DECISIONS.md`, and `RESEARCH_LOG.md`
  before changing direction.
- **During**: spec-driven features go through the stack-control front door; the plan's
  Constitution Check MUST evaluate the relevant principles above before implementation.
- **End of session**: update the research log, record durable decisions, refresh current state
  and next actions, then commit AND push the work (Principle IX).

## Governance

This constitution supersedes conflicting ad-hoc practice. Amendments are made by editing this
file with a version bump and a prepended Sync Impact Report, and MUST propagate to dependent
templates (`plan`/`spec`/`tasks`) and runtime guidance (`CLAUDE.md`, `AGENTS.md`,
`GOVERNANCE.md`) when they are affected. Versioning is semantic: MAJOR for
backward-incompatible principle removals/redefinitions, MINOR for a new principle or materially
expanded guidance, PATCH for clarifications. Compliance is expected in every review; unavoidable
deviations MUST be justified in writing (e.g., the plan's Complexity Tracking) or the offending
work revised.

**Version**: 1.0.0 | **Ratified**: 2026-07-08 | **Last Amended**: 2026-07-08
