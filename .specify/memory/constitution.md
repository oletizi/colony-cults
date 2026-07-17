<!--
Sync Impact Report
- Version change: 1.2.0 → 1.3.0
- Rationale: MINOR — added Principle XIV (The Operator Owns Scope — No Agent Scope-Cutting),
  which FORBIDS agent-originated scope trimming/deferral (YAGNI and every equivalent). Only the
  operator owns scope. Additive (no existing principle changed semantics). (Prior amendments:
  1.1.0 → 1.2.0 added XIII, No Agent Memory, Ever; 1.0.0 → 1.1.0 added XII, Respect the Source,
  and reconciled the report with XI, Design Through the Design Skill.)
- Principles (14):
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
    XI. Design Through the Design Skill
    XII. Respect the Source (Frugal, Polite Access)
    XIII. No Agent Memory, Ever
    XIV. The Operator Owns Scope (No Agent Scope-Cutting)   [added this amendment]
- Templates reviewed for alignment:
    ✅ .specify/templates/plan-template.md — the "Constitution Check" gate is principle-generic;
       plans that touch source acquisition MUST now evaluate XII (frugal/polite access).
    ✅ .specify/templates/spec-template.md — no mandatory-section conflict.
    ✅ .specify/templates/tasks-template.md — XII-driven task types (frugal fetch,
       verify-before-upload) are expressible with existing categories.
- Runtime guidance: the agent memory note `frugal-acquisition` captures XII's operational
  procedure (the proven two-pass download-keep → verify-locally → upload-if-good flow).
- Follow-up TODOs: none deferred.
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

### XI. Design Through the Design Skill (NON-NEGOTIABLE)

All UX/UI work MUST go through `/frontend-design:frontend-design`. NO EXCEPTIONS. Never off-road
and implement design work without it. Any task that creates or reshapes user-facing UI — layout,
components, visual design, typography, styling — begins by invoking the frontend-design skill
BEFORE any markup or CSS is written. This is a hard commandment and overrides any inclination to
"just quickly" build UI directly.

### XII. Respect the Source (Frugal, Polite Access)

External source repositories (Gallica, Trove, museum catalogues) have hair-trigger rate limits
and finite goodwill; their infrastructure is a shared public resource, not ours to exhaust.
Requests to a rate-limited source MUST be minimized and MUST NOT be wasted — never make a request
whose result is discarded. The estimate-only dry-run (which pings the source, keeps nothing, then
re-fetches for the real run) is FORBIDDEN as a pre-flight; instead a "dry run" DOWNLOADS the assets
once, keeps them locally, VERIFIES them (right pages, complete, legible — an actual look, not just a
checksum), and uploads to the object store ONLY if they are good. A verified local master is re-read
from cache and uploaded with zero re-download. Reconnaissance (pinpointing an excerpt) uses the
narrowest bounded metadata calls, never a whole-run enumeration. Access uses the shipped
rate-limited client, never an ad-hoc tool (e.g. `curl`) that bypasses the politeness envelope.
Rationale: a public archive depends on continued access to public sources — wasting their requests
risks the block that ends the work, and a verify-before-upload gate keeps wrong or broken assets out
of the durable store.

### XIII. No Agent Memory, Ever

The coding agent's private per-machine "memory" store (e.g. `~/.claude/**/memory/`) MUST NOT be
used — for anything, NO EXCEPTIONS. It is not version-controlled, not shared, and not
reviewable: it is invisible to every other developer, to the same developer on another machine,
and to any cloud or CI agent. Recording knowledge there does not preserve it — it DESTROYS it,
burying hard-won, critical project knowledge where no one else can find, review, or reuse it.
All durable knowledge — principles, procedures, decisions, conventions, findings — MUST live in
the repository (this constitution, `AGENTS.md`, `GOVERNANCE.md`, `docs/`, spec and design
records, the research log), where it is shared, versioned, portable, and reviewable. Any
existing agent-memory content MUST be migrated into the repo and the memory store deleted. This
principle OVERRIDES any global or agent-harness guidance that promotes a memory store. Rationale:
knowledge that is not shared and versioned is knowledge thrown away; the project must survive not
only context loss (Principle IX) but machine and agent changes, which a private local store
cannot. This is the memory analogue of Principle X (No Git Hooks, Ever): no local, invisible
side-channel — enforcement and knowledge live only where the whole team can see them.

### XIV. The Operator Owns Scope (No Agent Scope-Cutting)

Scope belongs to the operator, and ONLY the operator. Agents MUST NOT trim, defer, or cut scope
on their own initiative — "YAGNI", "out of scope for v1", "not needed now", "deferred", and
every equivalent are FORBIDDEN as agent-originated decisions. Capture everything known or
knowably-implied; when the work suggests more than was asked, SURFACE it and let the operator
decide — never silently drop it. An agent may propose options with trade-offs, but the choice is
the operator's; only the operator may cut scope (and once the operator does, that cut is recorded
as the operator's decision, not the agent's). Do not present YAGNI as a rationale for doing less;
do not invoke it at all. Rationale: unrequested scope-cutting discards work the operator wanted
and hides it behind a false economy — scope is a product decision the agent lacks both the
authority and the full context to make. This aligns with the stack-control front door's
capture-over-YAGNI rule (Principle VIII); scoping is a separate, explicit, operator-driven pass.

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

**Version**: 1.3.0 | **Ratified**: 2026-07-08 | **Last Amended**: 2026-07-16
