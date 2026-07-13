# Phase 1 Data Model: Corpus Gap Closure

Extends the shipped canonical-source-metadata + coverage-audit model; does not replace it. Existing types (Source, RepositoryRecord, source-group/campaign, search-log) are consumed as shipped and noted as **(reused)**.

## SearchLogRecord (reused shape, new authoring path)

One search event, in `bibliography/search-log.yml`.

| Field | Type | Notes |
|---|---|---|
| `repository` | string | e.g. Gallica, Trove/NLA, Internet Archive, New Italy Museum |
| `campaign` | source-group id | e.g. PB-P004; or a case-level entry for un-grouped scope |
| `date` | ISO date | last search of this repository × campaign |
| `coverage` | string | short descriptor of what was searched/covered |
| `remaining-questions` | string | what is still open at this repository for this campaign |
| `outcome` | `candidates-found` \| `dry` | drives the dry-round counter (R1) |

Validation (reused): unknown repository/campaign fails loud. New: an **append-safe authoring path** (never rewrites others' entries; per-session clone).

## CampaignExtent (new fields on a campaign / source-group)

A campaign's believed extent is **never the bare word `unknown`** — that overloads "we haven't looked" with "we looked and it's unbounded". It is exactly one of three explicit states (R9):

| State | Meaning | `extentBasis` |
|---|---|---|
| `<number>` | a measured, bounded extent | **required** — the research basis for the number |
| `unexamined` | not yet researched (baseline); no extent claim is made | not required — the honesty is in naming it un-researched |
| `irreducible` | researched and genuinely unbounded/unknowable | **required** — why it cannot be bounded |

| Field | Type | Notes |
|---|---|---|
| `knownMemberCount` | number \| `unexamined` \| `irreducible` | never a bare `unknown`, `0`, blank, or a fabricated number |
| `extentBasis` | string | required for a number and for `irreducible`; omitted for `unexamined` |

Coverage `gap` = `knownMemberCount − actualMemberCount` when numeric, else the state's own word (`unexamined` / `irreducible`) — never `0`, blank, or bare `unknown`.

## DiscoveryCandidate (new, pre-inventory)

A surfaced-but-not-yet-inventoried lead. Transient input to `bib inventory`; not committed as a Source until inventoried.

| Field | Type | Notes |
|---|---|---|
| `repository` | string | where it was found |
| `identifierHints` | string[] | ark/oclc/trove-id/url candidates — never fabricated |
| `title` / `creator` / `date` | string? | hints for the researcher's relevance judgment |
| `leadProvenance` | string | which search (R3 record) or which acquired source's bibliography surfaced it |
| `resolution` | `unexamined` \| `identified` \| `inventoried` \| `excluded` \| `unavailable` | with reason when excluded/unavailable |

## EvidenceClass (new facet on Source)

Open controlled list (R2). One value per Source. Absent → counted `unclassified` by the audit (target: empty).

## SuspectedLead (reused; resolution tracked)

Existing `suspected[]` / `references[]` on a Source/campaign, extended with a `resolution` state (as DiscoveryCandidate above) so none stays `unexamined` (SC-004).

## RepositoryAdapterConfig (new)

Per-repository capability descriptor: `name`, `kind`, `searchMechanism` (`automated` | `manual`), `acquireMechanism` (`iiif` | `bespoke` | `none-yet`), `rightsSource`. `none-yet` is a tracked capability gap (FR-013), not a silent skip.

## Reused (unchanged)

- **Source** — intellectual work; lifecycle `discovered → approved-for-acquisition → excluded`.
- **RepositoryRecord** — a held copy; acquisition status `wanted → to-collect → collecting → collected → archived`; carries the object-store handle (derived at read time from provenance).
- **Campaign / source-group** — members via `partOf` edges.

## Invariants

- A single intellectual **work is counted once** in coverage; multiple repository copies are separate RepositoryRecords (FR-015).
- A "no number yet" extent is always an **explicit named state** — `unexamined` (not yet researched) or `irreducible` (researched, unbounded, with basis) — never a bare `unknown`, blank, `0`, or a fabricated number (FR-006).
- An identifier is **never fabricated**; an unverifiable candidate fails loud (FR-008).
- Only `public-domain` rights permit mirroring; `restricted`/`uncertain` block it but keep the catalog entry (FR-007, Principle IV).
