# Design: Corpus Model Coherence — decouple the overloaded "source-group"

**Date**: 2026-07-13
**Roadmap item**: `impl:feature/corpus-model-coherence`
**Status**: design (awaiting operator approval marker)
**Backend**: superpowers:brainstorming, driven via /stack-control:design

## Governing constraint — clean breaks only (operator directive, non-negotiable)

This feature ships as a **clean break**. No intermediate migrations, no transitional
dual-representations, no backwards-compatibility shims or aliases — anywhere in the
implementation. Every schema/format/interface change is a single clean cutover:
the existing data is rewritten to the new canonical shape and every consumer speaks
**only** the new shape, **failing loud on the old one** (a retired field/key is an
error, never a tolerated alias or silently-ignored key). Rationale: a transitional
state invites agents who cannot tell transitional from canonical to build on the
soon-to-be-removed thing; backwards compatibility is inexcusable tech debt. (This
is distinct from — and must not become — a `bib migrate`-style rebuild from stale
legacy inputs, which is separately prohibited.)

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
into the threads it belongs to (many-to-many). `case` has the stable id
`port-breton` (the existing case slug), so every persisted scope reference is
resolvable. Threads start empty and are populated as research warrants.

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

Decisions 1–8 incorporate a third-party design review (2026-07-13); decisions 1,
4, 5, 7, 8 and the fail-loud invariant in 1 promote former open-questions to
settled model invariants (they are decidable now, not build minutiae).

1. **Scope is a discriminated reference (`ScopeRef`), not one persisted entity:**
   `{ kind: 'case' | 'thread' | 'work-bundle' | 'work', id }`. Resolution
   invariants, each **validated / fail-loud**:
   - `work` → a **fetchable, non-container** Source (`kind != source-group`);
   - `work-bundle` → a `kind: source-group` Source;
   - `thread` → an entry in `bibliography/scopes.yml`;
   - `case` → the stable case slug `port-breton`.
   A `ScopeRef` whose `id` does not resolve **under its declared `kind`** is
   rejected loud — e.g. `{ kind: work, id: PB-P004 }` fails because PB-P004 is a
   source-group. Kind/referent agreement is checked, never assumed.
2. **Source-group is the `work-bundle` kind** — reinterpretation, no migration;
   existing on-disk data (source-groups, the SRCH-0001 entry, the classified works,
   the reconciled statuses) stays valid.
3. **Search-log targets a `ScopeRef` via a clean one-time cutover, not dual-schema.**
   There is exactly one hand-authored entry (SRCH-0001) and the search-log is
   hand-authored by design, so there is no transition window to manage: the single
   entry is rewritten by hand to the `scope:` shape and the loader/coverage read
   **only** `scope:` from the start. `campaign:` is retired immediately and a
   `campaign:` key thereafter is a **hard error (fail loud)** — never a tolerated
   alias or silently-ignored key (per the clean-breaks constraint above). Kept as a
   permanent parallel representation it would recreate the very coherence problem
   this feature fixes. **This cutover is a hand-edit of one entry, NOT a
   `bib migrate`** (which is prohibited — it rebuilds the SSOT from stale legacy
   inputs and corrupts curation; TASK-8 / Constitution VIII).
4. **The case scope has a stable id now — `port-breton`** — so every persisted
   `ScopeRef` is resolvable and a second case later needs no migration.
5. **Approval is a property of a fetchable work Source only.**
   `approved-for-acquisition` and the direct approve path apply to non-container
   works; a work-bundle / `source-group` is not fetchable and remains
   **un-approvable and un-acquirable** (the existing container prohibition is
   preserved). Predicate: `isFetchableWork(source)` = the source is not a
   work-bundle scope. Approval is independent of group membership; it is NOT
   independent of being a real work.
6. **Coverage** counts **works only** in the evidence-class distribution
   (`kind: source-group` excluded); search history + measured-closure report **per
   scope**, not just per source-group.
7. **Thread membership is authored in one direction — on the Source**
   (`threads: [ids]`), reverse membership derived (the existing `partOf` precedent;
   "no fact stored twice"). The thread registry (`bibliography/scopes.yml`) owns
   thread **identity + description only**, never a member list. The `threads:`
   Source field is defined by this feature but exercised only when thread
   population begins (a later research pass) — not populated by this build.
8. **Measured closure is explicit and evidence-based for every scope kind — never
   inferred from acquisition.** Search-scope closure ("has the discovery surface
   been adequately examined?") is not acquisition ("has a located asset been
   preserved?"). A work can be acquired while questions remain (other editions,
   other repository copies, missing issues, supplements, provenance, cited
   references). A `work` scope has *simpler* closure criteria (all repository
   copies of that work searched, each acquired-or-documented) but still closes on
   **search evidence**, not on a single acquisition.

## Open questions

- Exact `bibliography/scopes.yml` field set beyond `id / name / description`.
- Whether `bib coverage` needs per-scope-kind display differences (a `work`
  scope's line vs a `thread` scope's rollup).
- The precise spec-time definition + validation of the `threads:` Source field
  (defined now, populated later) without requiring any thread to exist yet.

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
- Third-party design review (2026-07-13) incorporated: tightened approval to
  fetchable works only (D5), named Scope a discriminated `ScopeRef` with fail-loud
  kind/referent invariants (D1), gave the case scope a stable id (D4), fixed thread
  membership to one authored direction (D7), separated closure from acquisition
  (D8), and made the `campaign`→`scope` change a clean one-time cutover rather than
  permanent dual-schema (D3). Refinements beyond the review: the fail-loud
  kind/referent check in D1, and the clean single-entry cutover (no transition
  window) with an explicit "not `bib migrate`" guard in D3.
