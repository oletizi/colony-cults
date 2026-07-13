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

| Field | Type | Notes |
|---|---|---|
| `knownMemberCount` | number \| `unknown` | believed extent; `unknown` is a valid, explicit value |
| `extentBasis` | string | required when a number is set — the research basis; for `unknown`, why it is unknowable |

Coverage `gap` = `knownMemberCount − actualMemberCount` when numeric, else `unknown` (never `0`/blank).

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
- `unknown` is always **explicit** — never rendered as blank, `0`, or a fabricated number (FR-006).
- An identifier is **never fabricated**; an unverifiable candidate fails loud (FR-008).
- Only `public-domain` rights permit mirroring; `restricted`/`uncertain` block it but keep the catalog entry (FR-007, Principle IV).
