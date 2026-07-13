# Design: Corpus Model Coherence — decouple the overloaded "source-group"

**Date**: 2026-07-13
**Roadmap item**: `impl:feature/corpus-model-coherence`
**Status**: design (awaiting operator approval marker)
**Backend**: superpowers:brainstorming, driven via /stack-control:design

## Problem domain

The corpus coverage model (specs/007-corpus-coverage-audit + the source-group /
search-log tooling) overloads a single concept — **source-group** — to do three
unrelated jobs at once. Doing the 009 gap-closure research surfaced this as three
distinct blockers that are actually one root cause:

| "source-group" is used as… | in this machinery | blocker surfaced |
|---|---|---|
| a **search scope / campaign** (what a search covers) | search-log `campaign` field | TASK-24 — a search that isn't about a group has nowhere to be logged |
| a **container** (bundle of member works) | `bib coverage` evidence-class distribution | TASK-22 — containers are counted as if they were works (`unclassified` can't reach 0) |
| a **gate for approval** (what is acquirable) | `bib acquire` (FR-017) | TASK-27 — a standalone source can't be approved-for-acquisition |

Concretely, on the real corpus:
- The colony newspaper (PB-P001) was really searched at the State Library of
  Queensland and Gallica, but that search **cannot be logged** — PB-P001 is a
  single work, not a source-group, and the search-log only accepts a group id.
- After classifying all 11 individual works, `bib coverage` still reports
  `unclassified 2` — the two source-groups (PB-P004, PB-P006), counted as though a
  container were itself a work.
- PB-P002 resolved to a real BnF identifier but **cannot be acquired**: acquire
  gates on `approved-for-acquisition`, a status the promote/verify verbs only
  confer on group members, and PB-P002 is in no group.

The forcing insight (from the operator): the fix must NOT be an artificial
"everything else" source-group to unstick loose items — that is dirty metadata we
would hit again the moment the next ungrouped source or cross-cutting research
thread appears. The project's own ROADMAP Phase 4 lists nine analysis **threads**
(recruitment & propaganda, finance & speculation, religion, migration networks,
voyage logistics, disease & mortality, trial & scandal, survivor settlement,
memory & historiography) — research scopes that cut across works and map to no
bundle. The model must accommodate threads honestly, not by hacking.

## Solution space

### Chosen — Scope as a first-class concept; source-group is one *kind* of scope

Introduce one concept: a **Scope** is "the question a search is trying to answer,"
and it is the unit measured-closure is asked about. A scope has a `kind`:

- `case` — the whole affair (one, implicit for now)
- `thread` — a topic that cuts across many works (the Phase-4 analysis themes)
- `work-bundle` — a fixed set of member works (what a source-group is today)
- `work` — a single source

The load-bearing move: **a source-group, exactly as it exists on disk today, simply
IS a `work-bundle` scope.** This is a *reinterpretation*, not a migration — PB-P004
and PB-P006 are re-read as work-bundle scopes; nothing is rewritten. The three
conflated jobs then separate onto the right thing:

- **Search** is logged against **a scope** (any kind) — unblocks PB-P001's real
  search against a `work` scope, with no fake group.
- **Counting**: the evidence-class distribution counts **works only**; scopes /
  containers are structure, never counted as items.
- **Approval**: `approved-for-acquisition` is a property of a **work (source)**,
  independent of grouping.

Representation, kept un-fragmented: `work` and `work-bundle` scopes are derived
from Sources already on disk (a work = a Source; a work-bundle = a
`kind: source-group` Source). The only genuinely new artifact is a thin **thread
registry** (`bibliography/scopes.yml`: id, name, description). A work is tagged
into the threads it belongs to (many-to-many). `case` is implicit. Threads start
empty and are populated as research warrants.

### Rejected — Artificial "everything else" source-group

Drop the 6 ungrouped works into a new catch-all source-group to satisfy the
group-keyed machinery. **Rejected**: it is dirty metadata (a grab-bag that does not
represent a real bundle), it does not generalize (the next ungrouped source or
cross-cutting thread hits the same wall), and it papers over the root conflation
rather than fixing it. Explicitly rejected by the operator.

### Rejected — Generalize only the search target, leave the rest (minimal "Option A")

Make the search-log `campaign` field a polymorphic reference (case | group |
source) and stop there, without a thread concept or the counting/approval fixes.
**Rejected**: it solves TASK-24 narrowly but not TASK-22/27, and — critically — it
has no home for a cross-cutting **thread** (survivor-settlement across many works
and repositories), so the Phase-4 analysis work would hit exactly this wall again.
It treats "what a search covers" as a mere reference rather than recognizing that
"bundle of works" was only ever one flavor of scope. Half a fix.

### Rejected — A full parallel Campaign/Investigation entity separate from source-groups

Introduce Campaigns as their own first-class entity distinct from source-groups,
with their own lifecycle, duplicating much of what source-groups already do.
**Rejected**: it adds a parallel concept and two things that both "bundle" —
inviting a new conflation (which is a campaign vs a group?). The chosen model
unifies instead: source-group becomes a *subtype* of scope, not a sibling of a new
entity.

## Decisions

1. **Scope is first-class**, with kinds `case | thread | work-bundle | work`.
2. **Source-group is reinterpreted as the `work-bundle` scope kind** — no data
   migration; existing on-disk data (source-groups, the SRCH-0001 search-log entry
   keyed to PB-P004, the classified works, the reconciled statuses) stays valid.
3. **Search-log** targets a `scope` reference `{kind, id}` (generalizing
   `campaign`); the referent must resolve to a real scope or fail loud.
4. **Coverage** counts **works only** in the evidence-class distribution
   (`kind: source-group` excluded); search history + measured-closure report **per
   scope**, not just per source-group.
5. **Approval** (`approved-for-acquisition`) is a property of **any source**, with
   a direct approve path independent of group membership.
6. **Threads** are the only new stored artifact — a thin registry
   (`bibliography/scopes.yml`); works are tagged into threads (many-to-many);
   threads start empty and are populated as research warrants (NOT populated by
   this build).

## Open questions

- Exact `scopes.yml` shape (fields per thread; how `case` is represented if it ever
  needs to be explicit).
- Whether a work is tagged into threads via a field on the Source
  (`threads: [ids]`) or a member list on the thread record — a build detail for the
  spec.
- Whether measured-closure (009 US7) needs any per-scope-kind difference (e.g. a
  `work` scope is trivially closed once acquired), to be settled in the spec.
- Backward-compat surface: confirm the search-log loader accepts both the legacy
  `campaign:` key and the new `scope:` shape during transition (or a one-time,
  non-lossy read-compat), decided at spec time.

## Boundary (explicitly out of scope for this design)

- The suspected-lead **`resolution` state** and the **three-state
  `knownMemberCount`** (`unexamined` / `irreducible`) — TASK-25 — remain a
  **separate** small spec; they measure lead/extent *state*, a different root than
  the scope/container/approval conflation.
- **Populating** the nine analysis threads — the model *supports* threads;
  declaring and filling them is later research, not this build.
- **No UI** — CLI / `bib coverage` output only (Constitution XI N/A).

## Provenance

- Surfaced by the 009 corpus-gap-closure research passes (2026-07-13): TASK-22
  (coverage counts containers), TASK-24 (search-log keyed by group only), TASK-27
  (standalone-source approval path) — captured to the local backlog during US1/US3/US5.
- Design conversation: /stack-control:design → superpowers:brainstorming, in-session,
  2026-07-13. Core decision (scope-as-first-class, source-group = work-bundle kind)
  chosen over the artificial-group hack and the minimal search-only generalization
  because the project's own Phase-4 analysis threads are cross-cutting scopes that
  the narrower options would strand.
- Related: this is the first **tool-on-demand** the 009 program pulls into
  existence per its research-first plan (tasks.md Phase 4); it will be authored as
  its own Spec Kit spec via /stack-control:define and run via /stack-control:execute.
