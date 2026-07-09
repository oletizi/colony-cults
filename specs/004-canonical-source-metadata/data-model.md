# Phase 1 Data Model: Canonical Source Metadata Model

Types live in `src/model/`. TypeScript interfaces (no classes, no inheritance). "SSOT" fields are hand-authored in `bibliography/sources/PB-###.yml`; "derived" fields are computed from per-asset provenance and never hand-edited.

## Entity: Source *(SSOT — hand-authored)*

Generalizes the current `src/model/source.ts` (which is Gallica-specific with a single `gallicaArk`). The `gallicaArk` moves down to the Repository Record.

| Field | Type | Req | Level | Notes |
|-------|------|-----|-------|-------|
| `sourceId` | string (`PB-###`) | yes | — | Stable internal id. Primary key. |
| `titles` | `Title[]` | yes (≥1) | work | Titles-as-data; none authoritative (FR-003). |
| `kind` | `'periodical' \| 'monograph'` | yes | — | Drives whether an Issue layer exists. |
| `creator` | string | no | work | e.g. "Marquis de Rays / colonial enterprise". |
| `language` | string | no | work | Primary language. |
| `identifiers` | `WorkIdentifier[]` | no | work | ISBN/ISSN/OCLC only (FR-007). Copy-level id here = leak (FR-018). |
| `case` | string | no | — | Existing corpus grouping, e.g. `port-breton`. |
| `notes` | string | no | — | Free text. |

### Value: Title

| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `text` | string | yes | The title string. |
| `role` | `'canonical' \| 'archive' \| 'alternate' \| 'translated'` | yes | Classification; **no** `authoritative` flag exists (FR-003). |
| `language` | string | no | For translated/alternate titles. |

### Value: WorkIdentifier

| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `type` | `'isbn' \| 'issn' \| 'oclc'` | yes | `classifyIdentifier(type) === 'work'` (R-004). |
| `value` | string | yes | The identifier. |

## Entity: Repository Record *(derived from provenance; SSOT may carry authored overrides)*

One source archive's copy of a Source. **A Source has one-to-many Repository Records** (FR-002) — the fix for the PB-P001 overwrite. Keyed by `(sourceId, sourceArchive)`.

| Field | Type | Req | Level | Notes |
|-------|------|-----|-------|-------|
| `sourceId` | string | yes | — | FK → Source. |
| `sourceArchive` | string | yes | acquisition | Archive label, e.g. `Gallica / BnF`, `State Library of Queensland`. Part of the key. |
| `identifiers` | `CopyIdentifier[]` | no | copy | ARK/IIIF-manifest/scan-DOI only (FR-008). Work-level id here = leak. |
| `rights` | `Rights` | no | copy | Per-copy rights (reuses `src/model/rights.ts`). |
| `catalogUrl` | string | no | acquisition | Human catalog page. |
| `originalUrl` | string | no | acquisition | Machine/source URL. |
| `retrievedAt` | string (ISO) | no | acquisition | Retrieval date. |
| `status` | vocab `status` | yes* | acquisition | Acquisition status (*required when the copy exists). |
| `manifest` | `AssetManifestRef` | no | storage | Reference to the asset set (NOT a single checksum — FR-006). |
| `issues` | `IssueRef[]` | no | — | Present only for `kind === 'periodical'`; derived from census (R-005). |

### Value: CopyIdentifier

| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `type` | `'ark' \| 'iiif-manifest' \| 'scan-doi'` | yes | `classifyIdentifier(type) === 'copy'` (R-004). |
| `value` | string | yes | The identifier. |

### Value: AssetManifestRef *(storage axis)*

Points at the asset set, keeping acquisition (`sourceArchive`/URLs above) distinct from storage (here) — FR-010/FR-011.

| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `manifestPath` | string | no | e.g. `MANIFEST.sha256` for the copy's asset set. |
| `assetCount` | number | derived | Count of assets rolled up from provenance. |
| `objectStore` | `ObjectStoreRef \| null` | no | Reuses spec-003 block `{provider, bucket, key, endpoint}`; `null` for legacy/local-only assets (FR-011). |
| `localPath` | string | no | git-cache fallback when `objectStore` is null. |

`ObjectStoreRef` is **imported/reused** from the archive-object-store model (`specs/003-archive-object-store/data-model.md`), not redefined here (FR-012).

## Entity: Issue *(derived from census)*

Reuses `src/model/issue.ts` + `src/model/census.ts`. Present only for serials. Derived from `data/census/<sourceId>-<slug>.json` (R-005).

| Field | Type | Source | Notes |
|-------|------|--------|-------|
| `ark` | string | census | Issue ark. |
| `date` | string | census | Issue date. |
| `label` | string | census | e.g. "15 juillet 1879". |
| `pageCount` | number | census | Pages. |
| `assets` | `Asset[]` | provenance | The issue's mirrored files (may be empty = known-but-unacquired issue, an edge case, not an error). |

## Entity: Asset *(ground truth — unchanged)*

Reuses `src/model/asset.ts` + `src/model/provenance.ts` **as-is** (FR-012). Each has its own `sha256`, `type`, `localPath`, and per-asset provenance (acquisition + storage axes). This model **indexes** assets; it does not restate their provenance.

## Derived collection: CanonicalModel

The in-memory aggregate `bibliography/derive.ts` produces and `regenerate.ts`/`validate.ts` consume:

```
CanonicalModel = {
  sources: Source[],                         // from SSOT
  repositoryRecords: RepositoryRecord[],     // derived + authored overrides, keyed (sourceId, sourceArchive)
}
```

## Controlled vocabularies *(closed sets — `bibliography/vocab.ts`)*

Per FR-019 (closed vocab + minimal required core). Initial sets — finalized here, extendable by editing `vocab.ts`:

| Field | Allowed values (initial) |
|-------|--------------------------|
| `status` | `wanted`, `to-collect`, `collecting`, `collected`, `archived` |
| `rights` | `public-domain`, `other` (reconciled to Gallica `dc:rights`; SLQ mapped in) |
| `provider` | `backblaze-b2`, `git-cache` (storage providers; extends with object-store providers) |
| `ocr_status` | `none`, `searchable`, `failed` (matches `Provenance.ocrStatus`) |

**Required-field core** (FR-019): `Source.sourceId`, `Source.titles[0]`, `Source.kind`; and for any Repository Record that exists: `sourceArchive`, `status`. All other fields optional so `wanted`/`to-collect` sources with no copy yet remain valid (edge case: a Source with zero Repository Records).

## Relationships & integrity rules

- Source **1 — 0..N** Repository Record (FR-002; adding one never mutates another).
- Repository Record **1 — 0..N** Issue (serials only) / **0..N** Asset (monographs, direct).
- Issue **1 — 0..N** Asset.
- Every Asset MUST resolve to a Repository Record; every Repository Record MUST resolve to a Source (FR-017; orphans are findings).
- Work-level identifiers appear **only** on Source; copy-level **only** on Repository Record (FR-007/008; violation = leak finding, FR-018).
- `manifest` replaces any single-`checksum` notion (FR-006).

## State transitions (acquisition `status`)

`wanted → to-collect → collecting → collected → archived`. Transitions are advisory (not enforced by this feature); `status` is validated against the closed vocab only.

## Migration mapping (5 representations → SSOT)

| Current representation | Folds into |
|------------------------|-----------|
| `bibliography/sources.csv` | Source core (id, titles, creator, year→notes, language, case) — then becomes a derived view |
| `bibliography/acquisition-tracker.csv` | Repository Record `status`/`catalogUrl`/notes — then derived view |
| archive `acquisition-register.csv` | Repository Record acquisition fields — then derived view |
| `PB-P00X.yml` stubs | Source/Repository Record overrides — then derived view |
| per-asset provenance YAML/JSON | Asset ground truth (unchanged); source of the derived roll-up |

**PB-P001 restoration**: migration adds a **second** Repository Record for `PB-P001` with `sourceArchive = 'State Library of Queensland'` alongside the existing `Gallica / BnF` one (SC-005), reconstructed from the pre-overwrite record / notes.
