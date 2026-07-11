---
title: Corpus Coverage & Discovery Audit — Design
roadmap-item: impl:feature/corpus-coverage-audit
date: 2026-07-11
house-rules: stack-control-design-v1
status: awaiting-operator-approval
---

# Corpus Coverage & Discovery Audit — Design

A lightweight audit layer that answers **"what evidence are we still missing?"**
It is *generated* from the existing bibliography (the single source of truth),
never a parallel hand-maintained research tree. This design fixes how the
roadmap's in-scope items (a)–(f) are realized as data-model additions and
generated views, under one governing rule: **no fact is stored in two places.**

## Problem domain

The corpus (one case, `port-breton`, ~11 sources) records *what we have*: each
`Source` is an identified work, each `RepositoryRecord` a held copy at an
archive. Two shipped lifecycles already model acquisition
(`Source`: `discovered → approved-for-acquisition → excluded`;
`RepositoryRecord`: `wanted → … → archived`) and source-groups already model
discovery campaigns (`PB-P004` is the trial-records campaign; members derive
from `partOf` edges).

What the corpus **cannot currently express** is the shape of the *gap*:

1. **Genre / evidence class** — nothing records that a source is a pamphlet vs a
   trial record vs a newspaper, a facet orthogonal to the structural `kind`
   (`periodical | monograph | source-group`). Coverage questions are often
   per-evidence-class ("do we have the prospectus?").
2. **Pre-discovery knowledge** — a work can be *known to exist* (cited by an
   acquired source — e.g. PB-P007 is titled as an extract from the journal
   *la Nouvelle France*) or *inferred to exist* (a colony this size likely
   issued a prospectus) long before it is identified in any archive. The model
   has no home for either.
3. **Known-count with an explicit unknown** — a campaign cannot say "we believe
   there are exactly N members and hold them all" vs "we do not know how many
   exist." `unknown` must be first-class and distinct from `incomplete`.
4. **Search history** — `RepositoryRecord`s are *per-copy*, not *per-search*.
   Nothing records "searched the State Library of Queensland on this date for
   this campaign, covered X, with open question Y." This is the genuinely-missing
   artifact.
5. **A coverage report** — there is no generated summary of counts-and-unknowns.

The central hazard is **source-of-truth divergence**: the roadmap explicitly
rejects a parallel hand-maintained `research/` tree (the legacy-CSV drift trap).
Any solution must add facts *once*, on the node that owns the evidence, and
generate every audit view.

### Constraints and rejections carried from the roadmap

- Right-size to the current one-case, ~11-source corpus. Do **not** build a
  research-program-management subsystem heavier than the corpus it manages.
- **Reject** the third-party proposal's 11-stage linear lifecycle as false
  precision; the two shipped lifecycles stay.
- **Out of scope:** no fetch/OCR/translate, no new acquisition pipeline, no query
  automation (YAGNI until records are used by hand).
- The coverage report emits **counts with explicit unknowns** — **no headline
  coverage %**, which would be false precision over a mostly-unknown denominator.

## Solution space

The load-bearing decision is where "known/suspected but unidentified" evidence
lives, and whether audit outputs are stored or generated. The alternatives below
are framed around the divergence hazard.

### Chosen — Single store, facts authored once, audit views generated

Every new fact is authored exactly once, on the bibliography node that owns its
evidence; the register and report are **derived views emitted to stdout and
never committed**. The bibliography remains the sole source of truth.

- **Citations** live on the acquiring `Source` (`references:`); an unresolved
  citation *is* the `referenced-but-unidentified` state, expressed as a
  reference lacking a `resolvedTo` edge.
- **Suspected (inferred) gaps** live on the campaign source-group (`suspected:`).
- **Search events** live in one new append-only authored file
  (`bibliography/search-log.yml`) — new *primary* data that duplicates nothing.
- The **unresolved-references register** and the **coverage report** are
  computed on demand.

Why chosen: it is the only option that structurally enforces the roadmap's
anti-drift stance. No audit artifact can drift from the bibliography because no
audit artifact is *stored* — it is recomputed each run. It leaves the closed
`SOURCE_LIFECYCLE_STATUS` vocab untouched (pre-discovery states become properties
of *derived* register entries, not `Source.status` values), so it adds no
title-less `Source` stubs. Cost: report/register logic must be derived each run
(cheap at this corpus size).

### Rejected — Separate hand-maintained register file(s)

A standalone `unresolved-references.yml` (and/or a coverage document) authored
and edited by hand alongside the bibliography.

Why rejected: this is a second source of truth by construction — exactly the
legacy-CSV drift trap the roadmap forbids. A citation would be recorded both on
the acquiring source and in the register; the two inevitably diverge. Committing
a coverage document invites future agents to hand-edit a generated artifact as if
it were SSOT.

### Rejected — Extend the `Source` lifecycle vocab with the pre-discovery states

Add `referenced-but-unidentified` and `suspected` to
`SOURCE_LIFECYCLE_STATUS_VALUES`; a cited-but-unfound work becomes a `Source`
stub with a placeholder title.

Why rejected: it strains the `Source` invariants — a `Source` is an *identified*
work requiring a real, non-empty title and a `kind` that fits; a bare citation
has neither. It pollutes the "things we have identified" set with "things we have
only heard cited," and forces title-less stubs with no repository record. The
intent of roadmap item (b) is realized instead as *derived register states*,
which needs no vocab change.

## Decisions

**D1 — One store, generated views.** The bibliography is the single source of
truth. Audit views (register, report) are generated to **stdout** (`--json`
available) and **never committed**. Promoted to a first-class feature invariant:
derived documents are not written into the repo, so no future agent mistakes one
for SSOT.

**D2 — SSOT map (each fact authored once):**

| Fact | Authored on | Committed |
|---|---|---|
| Citation of an unfound work | acquiring `Source` (`references[]`) | yes |
| Resolution of a citation | same reference (`resolvedTo` edge) | yes |
| Suspected (inferred) gap | campaign source-group (`suspected[]`) | yes |
| Genre / evidence class | `Source.evidenceClass` | yes |
| Known-count + explicit unknown | source-group (`expectedMembers`) | yes |
| Search event (repo × campaign × date) | `bibliography/search-log.yml` | yes |
| Unresolved-references register | *derived* from `references[]` + `suspected[]` | **no — stdout** |
| Coverage report | *derived* from all of the above | **no — stdout** |

**D3 — `Source.evidenceClass` (roadmap a).** New optional field, orthogonal to
`kind`. Validated against a new **closed-but-extensible** vocab
`EVIDENCE_CLASS_VALUES` in `src/bibliography/vocab.ts` (`book`, `pamphlet`,
`prospectus`, `newspaper`, `trial-record`, `gov-report`, `map`, …). Closed so it
stays disciplined; adding a class is a one-line edit.

**D4 — `Source.references[]` (roadmap b/e).** Each entry: `citedAs` (text),
`citedKind?` (e.g. `journal`, `book`), `resolvedTo?` (a `sourceId`, set once the
cited work is identified), `notes?`. A reference **without** `resolvedTo` is the
`referenced-but-unidentified` population; the `resolvedTo` edge is the provenance
trail for "how this source was found." No change to `SOURCE_LIFECYCLE_STATUS`.

**D5 — source-group `suspected[]` + `expectedMembers` (roadmap b/c).**
`suspected[]` entries (`description`, `evidenceClass?`, `notes?`) are the
*inferred* pre-discovery population. `expectedMembers?: number | 'unknown'`
records the known-count; `'unknown'` is first-class and **distinct from
incomplete**. Both are valid only on `kind: source-group`.

**D6 — `bibliography/search-log.yml` (roadmap d).** New append-only,
date-ordered, **structured YAML** file. Each entry: `date`, `repository`,
`campaign` (source-group id), `scope`, `coverage`, `remainingQuestions[]`,
`notes?`. Structured (not free markdown) so the report aggregates it into the
repository × campaign matrix. Authored primary data → committed.

**D7 — `bib coverage` subaction (roadmap f).** New bib CLI subaction
(alongside `show`, `validate`, `inventory`, …), `--json` for machine output.
Derives and prints: per-campaign counts (members by lifecycle state;
`expectedMembers` vs actual; gap as a number **or the literal `unknown`**);
evidence-class distribution; the unresolved-references register (unresolved
`references[]` + `suspected[]`, grouped by campaign); the repository × campaign
search-history matrix (last-searched date, open questions). **Explicit unknowns
throughout; no headline coverage %.**

**D8 — Validation extensions.** Loader/validator gain: `evidenceClass` checked
against `EVIDENCE_CLASS_VALUES`; `references[].resolvedTo` must resolve to an
existing `sourceId`; `expectedMembers` / `suspected` valid only on
`kind: source-group`.

## Open questions

- **Search-log writer.** Hand-edit `search-log.yml`, or add a small
  `bib log-search` convenience verb to append an entry safely? Leaning
  hand-edit to stay minimal; captured for the scoping pass, not yet decided.
- **`sources.csv` precedent.** The repo commits a derived `sources.csv` (via
  `bib regenerate`). Our new derived views deliberately break from that by
  staying stdout-only. Worth a one-line note in the implementation so the
  inconsistency is intentional, not accidental — and a possible follow-up to
  reconcile the older derived CSV under the same rule.
- **Register grouping.** Group unresolved references by campaign only, or also
  surface a flat global list for references not tied to any campaign?
- **Report surface home.** Confirmed as a `bib` subaction (`bib coverage`);
  captured alternative was a top-level `stackctl` verb — deferred unless a
  cross-tool consumer appears.

## Provenance

- **Roadmap item:** `impl:feature/corpus-coverage-audit`
  (`docs/engineering-roadmap.md`), status `planned`, depends-on
  `impl:feature/canonical-source-metadata`. Scoped-down capture (2026-07-11)
  from a third-party "Corpus Coverage & Discovery Audit" proposal; the roadmap
  entry's in-scope (a)–(f) and out-of-scope bullets are the authority for this
  design's scope.
- **Design phase:** opened via `/stack-control:design` under house-rules block
  `stack-control-design-v1` (capture-over-YAGNI; ≥2 solution-space alternatives;
  required sections; handoff to `/stack-control:define`).
- **Existing model surveyed:** `src/model/source.ts`,
  `src/model/repository-record.ts`, `src/bibliography/vocab.ts`,
  `src/bibliography/derive.ts`, `src/cli/bibliography.ts`,
  `bibliography/sources/PB-P004.yml` (source-group / campaign),
  `bibliography/sources/PB-P007.yml` (member citing *la Nouvelle France*).
- **Dependency specs:** `specs/004-canonical-source-metadata`,
  `specs/005-source-groups`, `specs/006-source-group-acquisition`.
- **Design conversation:** operator-driven brainstorming (2026-07-11); the
  divergence concern drove the reframe from a stored register to derived views,
  and the search-log to a structured-YAML sibling file.
- **Next step:** on operator approval (the `design-approved:` node marker),
  hand off to `/stack-control:define` to author the Spec Kit spec.
