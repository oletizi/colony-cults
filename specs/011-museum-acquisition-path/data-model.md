# Phase 1 Data Model: New Italy Museum acquisition path

Extends the shipped model (`src/model/*`, `src/bibliography/*`). New/changed shapes only; unchanged fields are elided.

## Source (extended)

`src/model/source.ts` — add a structural kind.

| Field | Change | Notes |
|---|---|---|
| `kind` | `periodical \| monograph \| source-group` → **`+ 'archival-item'`** | `archival-item` = a discrete non-serial archival work or object (photograph, letter, postcard, certificate); neither serial nor monographic. A museum member is `kind: 'archival-item'`, `partOf: 'PB-P006'`. |

Vocabulary invariant: `periodical` (serial) · `monograph` (monographic textual work) · `archival-item` (discrete non-serial archival work) · `source-group` (non-fetchable work bundle). `archival-item` is orthogonal to `evidenceClass` (e.g. `kind: archival-item` + `evidenceClass: photograph`).

**Validation**: `archival-item` is a valid member kind; a museum object MUST NOT be authored as `monograph`. `partOf`/`knownExtent`/`suspected` remain valid only on `source-group` (unchanged rule).

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

## SuspectedLead.resolution (extended) — discriminated union

`src/bibliography/load-coverage-fields.ts` — `SUSPECTED_KEYS` gains `resolution`, modeled as a discriminated union keyed on `state` (state-specific payloads; invalid combinations unrepresentable):

```ts
type LeadResolution =
  | { state: 'unexamined' }
  | { state: 'identified';  candidate: RepositoryCandidateRef; resolvedAt: string }
  | { state: 'inventoried'; sourceId: string;                  resolvedAt: string }
  | { state: 'excluded';    reason: string;                    resolvedAt: string }
  | { state: 'unavailable'; reason: string;                    resolvedAt: string };
```

**Migration**: PB-P006's two leads move from free-text `RESOLVED -> identified` in `notes` into `{ state: 'identified', candidate, resolvedAt }`.

## KnownExtent (discriminated union) — replaces bare `unknown` + scalar `knownMemberCount`

`src/bibliography/load-coverage-fields.ts:121-133` (`validateKnownMemberCount`). The scalar `knownMemberCount` + optional `extentBasis` is replaced by a discriminated `knownExtent`:

```ts
type KnownExtent =
  | { state: 'measured';    count: number; basis: string }
  | { state: 'unexamined' }
  | { state: 'irreducible'; basis: string };
```

The literal `'unknown'` and the old scalar shape are **removed**; loading either fails loud. PB-P006's extent is set to its explicit state (leaning `{ state: 'irreducible', basis }`) at inventory. (Supersedes 009's scalar three-state sketch, never built.)

## Coverage render (behavior)

- `coverage-render.ts` / `coverage-register.ts`: a suspected entry renders its `resolution.status` distinctly (resolved leads are not open bullets); an `excluded`/`unavailable` lead shows its reason; an `inventoried` lead references its Source.
- Extent renders the three-state value distinctly with its basis; never a bare `unknown`.

## State transitions

- **RepositoryRecord acquisition status** (unchanged vocab `wanted → to-collect → collecting → collected → archived`) advanced by `bib reconcile` after `adapter.acquire`.
- **Source lifecycle** (unchanged `discovered → approved-for-acquisition → excluded`) advanced by the existing group-member `promote` (museum items are members).
- **Rights** — `uncertain`/absent → (operator rights-assessment) → `public-domain` | `restricted`. Only `public-domain` unblocks `acquire`.
- **SuspectedLead.resolution** — `unexamined → identified → inventoried`, or `→ excluded` / `→ unavailable` (reason required). Reconsideration re-records the state + reason + timestamp (no separate history log at n=1).
