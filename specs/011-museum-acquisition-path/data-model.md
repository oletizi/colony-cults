# Phase 1 Data Model: New Italy Museum acquisition path

Extends the shipped model (`src/model/*`, `src/bibliography/*`). New/changed shapes only; unchanged fields are elided.

## Source (extended)

`src/model/source.ts` — add a structural kind.

| Field | Change | Notes |
|---|---|---|
| `kind` | `periodical \| monograph \| source-group` → **`+ 'item'`** | `item` = a discrete archival work (photograph, letter, postcard, certificate); neither serial nor monographic. A museum member is `kind: 'item'`, `partOf: 'PB-P006'`. |

**Validation**: `item` is a valid member kind; a museum object MUST NOT be authored as `monograph`. `partOf`/`knownMemberCount`/`suspected` remain valid only on `source-group` (unchanged rule).

## CopyLevelIdentifierType (extended)

`src/model/identifiers.ts:12` — `ark | iiif-manifest | scan-doi` → **`+ 'accession'`**.

- A museum `RepositoryRecord` carries an `accession` copy identifier as durable identity. `sourceUrl` (locator) is separate and non-identity.

## RepositoryRecord (extended)

`src/model/repository-record.ts` — add authoritative rights fields + assets.

| Field | Type | Notes |
|---|---|---|
| `sourceUrl` | `string?` | catalogue detail-page locator (not identity) |
| `assets` | `AcquiredAsset[]?` | acquired representations of this copy (see below) |
| `rights` | `Rights` (extended) | authoritative judgment (below) |

### Rights (extended) — `src/model/rights.ts`

| Field | Type | Notes |
|---|---|---|
| `rightsRaw` | `string?` | verbatim stated rights/credit text collected from the page |
| `rightsStatus` | `'public-domain' \| 'restricted' \| 'uncertain'` | the authoritative status; only `public-domain` permits mirroring |
| `rightsBasis` | `string` (required when status set) | e.g. "Photograph created before 1955; Australian pre-1969 term" |
| `rightsJurisdiction` | `string?` | e.g. `AU` |
| `assessedBy` | `'operator'` | never the model |
| `assessedAt` | ISO timestamp | when the judgment was recorded |

### AcquiredAsset (new)

One preserved representation of a `RepositoryRecord`. Multiple assets per record (front/back, page scans); a thumbnail is never a master.

| Field | Type | Notes |
|---|---|---|
| `sourceUrl` | `string` | original asset URL (locator) |
| `mediaType` | `string` | e.g. `image/jpeg` |
| `objectStoreKey` | `string` | B2 key |
| `checksum` | `string` | sha256 |
| `byteLength` | `number` | |
| `provenancePath` | `string` | git-tracked provenance record |
| `role` | `string?` | e.g. `front` / `reverse` / `page` |
| `sequence` | `number?` | order within the item |
| `representationChoice` | `string?` | how "best representation" was chosen (e.g. `max-resolution`) |

## SuspectedLead (extended)

`src/bibliography/load-coverage-fields.ts` — `SUSPECTED_KEYS` gains `resolution`.

| Field | Type | Notes |
|---|---|---|
| `resolution.status` | `unexamined \| identified \| inventoried \| excluded \| unavailable` | default `unexamined` |
| `resolution.candidate` | `string?` | required-ish when `identified` — a repository candidate reference |
| `resolution.sourceId` | `string?` | required when `inventoried` — the resulting Source id |
| `resolution.reason` | `string?` | **required** when `excluded` / `unavailable` |
| `resolution.resolvedAt` | timestamp? | when the state was recorded |

**Migration**: PB-P006's two leads move from free-text `RESOLVED -> identified` in `notes` into `resolution.status: identified` with a candidate reference.

## KnownExtent (three-state) — replaces bare `unknown`

`src/bibliography/load-coverage-fields.ts:121-133` (`validateKnownMemberCount`).

| Value | Meaning | `extentBasis` |
|---|---|---|
| `<number>` | measured, bounded | **required** |
| `unexamined` | not yet researched | not required |
| `irreducible` | researched, unbounded | **required** |

The literal `'unknown'` is **removed**; loading it fails loud. PB-P006's extent is set to its explicit state (leaning `irreducible` with basis) at inventory.

## Coverage render (behavior)

- `coverage-render.ts` / `coverage-register.ts`: a suspected entry renders its `resolution.status` distinctly (resolved leads are not open bullets); an `excluded`/`unavailable` lead shows its reason; an `inventoried` lead references its Source.
- Extent renders the three-state value distinctly with its basis; never a bare `unknown`.

## State transitions

- **RepositoryRecord acquisition status** (unchanged vocab `wanted → to-collect → collecting → collected → archived`) advanced by `bib reconcile` after `adapter.acquire`.
- **Source lifecycle** (unchanged `discovered → approved-for-acquisition → excluded`) advanced by the existing group-member `promote` (museum items are members).
- **Rights** — `uncertain`/absent → (operator rights-assessment) → `public-domain` | `restricted`. Only `public-domain` unblocks `acquire`.
- **SuspectedLead.resolution** — `unexamined → identified → inventoried`, or `→ excluded` / `→ unavailable` (reason required). Reconsideration re-records the state + reason + timestamp (no separate history log at n=1).
