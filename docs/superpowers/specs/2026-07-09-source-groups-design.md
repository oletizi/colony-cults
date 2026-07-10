# Design: Source Groups (`impl:feature/source-groups`)

- Date: 2026-07-09
- Roadmap item: `impl:feature/source-groups`
- Depends-on: `impl:feature/canonical-source-metadata` (shipped)
- Resolves: backlog **TASK-3** (`pb-p004-source-layout`)
- Status: designing (awaiting operator approval) — **handed off for a fresh session**
- Origin: a third-party "Handling PB-P004 and Multi-Document Historical Sources"
  design-guidance doc, evaluated and refined against the shipped canonical model.

## Problem domain

The shipped canonical model assumes every `PB-###` identifier is a single fetchable
work. That is false for many historical sources, which are **research-defined
collections** discovered before they can be acquired: trial corpora, correspondence,
parliamentary papers, manuscript collections.

**PB-P004 is the live example.** Its shipped record (`bibliography/sources/PB-P004.yml`)
is `kind: monograph`, `creator: various`, with a single `to-collect` repository
record — it describes *a body of evidence* (the Marquis de Rays legal corpus), not an
archival object. Any fetch of PB-P004 must fail: there is no ARK behind it. The model
needs a first-class way to say "this is a collection; discover its members, don't
fetch it."

## Solution space

### Chosen — add a `source-group` kind + a discovery pipeline (third-party guidance, refined)

Extend the shipped model with a **Source Group**: a Source whose kind marks it as a
container of member Sources, never itself fetchable.

1. **`Source.kind` becomes `periodical | monograph | source-group`** (`src/model/source.ts`).
   A `source-group` is a container.

2. **Do NOT add `repository-record` to the `kind` enum.** The guidance proposes
   `kind: source | source-group | repository-record`, but **RepositoryRecord is already
   a separate entity** in the shipped model (`Source.repositoryRecords[]`,
   `src/model/repository-record.ts`). Folding it into `kind` would undo the two-axis
   separation the canonical feature just established. The guidance's own three-way is
   really *Source-kind* `{monograph, periodical, source-group}` + the existing
   RepositoryRecord entity.

3. **A source-group has `members`, not `repositoryRecords`.** Validation
   (`src/bibliography/validate*.ts`) enforces: `kind: source-group` → has members, has
   **no** `repositoryRecords`, and is **never fetchable**; the other kinds → have
   repository records, no members. (PB-P004's current single `to-collect` repository
   record migrates into a members list.)

4. **Member identity — stable IDs + a `part_of` edge, not composite hierarchical IDs.**
   The guidance bakes structure into IDs (`PB-P004-001`). The canonical model's own
   principle is *IDs are permanent and opaque; structure is a relationship, not encoded
   in the ID.* So a member gets its own stable id and a `part_of: PB-P004` edge (mirrors
   how the roadmap models `part-of`). **Open decision** — readable hierarchical IDs
   (`PB-P004-001`) are a defensible alternative if the team prefers legibility over the
   opaque-ID principle; see open questions.

5. **Fetcher / acquisition guardrail (the concrete TASK-3 fix).** Keyed on `kind`, a
   fetch of a `source-group` **fails loud and informatively**: *"PB-P004 is a Source
   Group — discover and inventory its members, then fetch the members."* This replaces
   today's opaque unregistered-source error (TASK-3). General rule implemented: a source
   lacking a stable archival identity (ARK/DOI/ISBN/OCLC/repository id) is assumed to
   require **discovery, not acquisition**.

6. **Status vocab extension** (`src/bibliography/vocab.ts` `STATUS_VALUES`): add
   `discovered` and `approved-for-acquisition` for the pipeline
   **Discover → Inventory → Verify → Promote → Acquire → Preserve**.

7. **Reclassify PB-P004** as the project's first source-group; seed member records
   (indictment / proceedings / sentencing / appeal / government report) as they are
   discovered — each an independently fetchable Source once it has an ARK.

### Rejected — adopt the guidance verbatim

Its `kind: source | source-group | repository-record` conflates a separate entity
(RepositoryRecord) with a Source kind, undoing the shipped two-axis model; and its
composite member IDs encode structure into permanent IDs against the model's own
principle. Adopt the intent, not the letter.

### Rejected — keep PB-P004 as a `monograph, to-collect`

Status quo: an unfetchable placeholder that fails opaquely and mis-describes a corpus
as a single work. Rejected.

## Decisions

1. Add `source-group` to `Source.kind`; keep RepositoryRecord a separate entity.
2. `source-group` → `members` (via `part_of`), no `repositoryRecords`, never fetchable;
   validation enforces the split.
3. Fetcher/acquisition **fails loud + informatively** on a `source-group`, keyed on kind.
4. Extend `STATUS_VALUES` with `discovered`, `approved-for-acquisition`.
5. Reclassify PB-P004 as the first source-group; members discovered over time.
6. Trial **newspaper** coverage → the `PB-N###` series (different evidence class), not
   PB-P004 members. Candidate `ark:/12148/bpt6k5785971m` stays a *candidate needing
   verification* (likely a later account, not an original court record), not auto-promoted.

## Open questions

_Carry into `/stack-control:define`; none are blockers._

- **Member ID scheme**: stable flat id + `part_of` edge (recommended, model-consistent)
  vs readable hierarchical `PB-P004-001` (guidance's form). Pick one.
- **Group ↔ member representation**: does the group list `members: [...]`, or do members
  carry `part_of`, or both (bidirectional, validated for consistency)?
- **Discovery record shape**: the Phase-1/2 candidate inventory (title/creator/ark/
  repository/rights/relevance/status:discovered) — where it lives before promotion
  (a `discovered/` area, or `status: discovered` repository records on member stubs).
- **Migration**: rewrite `PB-P004.yml` from `monograph`+repository-record to
  `source-group`+members without breaking the shipped CSV-derivation/validation.
- **Vocab/agent-behavior**: encode the "never fetch a source-group" + "no stable id ⇒
  discovery" rules so the acquisition engine keys on `kind`, not naming conventions.

## Provenance

- Origin: third-party design-guidance doc (Recommendation), 2026-07-09.
- Evaluation + refinements: this session — grounded against the shipped
  `bibliography/sources/PB-P004.yml`, `src/model/source.ts` (`kind: periodical|monograph`),
  `src/model/repository-record.ts`, and `src/bibliography/vocab.ts` (`STATUS_VALUES`).
- Builds on the shipped `impl:feature/canonical-source-metadata`; resolves TASK-3.
- Handoff target: `/stack-control:define`.
