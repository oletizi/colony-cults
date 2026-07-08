# Phase 1 Data Model: Gallica Fetcher

Types are TypeScript interfaces in `src/model/` (no logic, no inheritance). All identifiers are stable Gallica arks (e.g. `bpt6k5603637g`) or periodical arks (e.g. `cb328261098`).

## Source

A Gallica-held work being mirrored.

| Field | Type | Notes |
|---|---|---|
| `sourceId` | string | Colony Cults ID, e.g. `PB-P001` |
| `title` | string | e.g. *La Nouvelle France* |
| `gallicaArk` | string | periodical ark (`cb…`) or monograph ark (`bpt6k…`) |
| `kind` | `'periodical' \| 'monograph'` | determines whether a census is built |

Validation: `gallicaArk` non-empty; `sourceId` matches the archive's ID scheme.

## Census

The enumerated issues of a periodical source (public artifact).

| Field | Type | Notes |
|---|---|---|
| `sourceId` | string | back-reference |
| `gallicaArk` | string | periodical ark |
| `builtAt` | string (ISO date) | passed in (deterministic runs stamp externally) |
| `totalIssues` | number | from `Issues` service |
| `issues` | `CensusIssue[]` | ordered by `date` ascending |

`CensusIssue`:

| Field | Type | Notes |
|---|---|---|
| `ark` | string | issue ark |
| `date` | string (`YYYY-MM-DD`) | normalized from the human date |
| `label` | string | host's human date, e.g. `15 juillet 1879` |
| `pageCount` | number | from `Pagination` (`nbVueImages`) |

**Serialization rule (FR-002)**: JSON with keys emitted in a fixed order and `issues` sorted by `date`; 2-space indent; trailing newline. Re-running on unchanged holdings yields a byte-identical file.

## Issue

One fascicle (periodical) or the whole document (monograph) being fetched.

| Field | Type | Notes |
|---|---|---|
| `ark` | string | |
| `date` | string | |
| `pageCount` | number | |
| `rights` | `Rights` | resolved before any download |

## Rights

Result of the OAIRecord gate.

| Field | Type | Notes |
|---|---|---|
| `ark` | string | |
| `status` | `'public-domain' \| 'other'` | derived from `dc:rights` |
| `rawResponse` | string | full OAIRecord XML, stored in provenance |
| `dcRights` | string[] | the parsed `dc:rights` values |

Rule (FR-004): only `status === 'public-domain'` permits download; anything else → throw. Absent/ambiguous `dc:rights` → `other`.

## Asset

A single mirrored file in the private archive.

| Field | Type | Notes |
|---|---|---|
| `type` | `'page-image' \| 'pdf-a' \| 'ocr-text'` | |
| `localPath` | string | absolute, MUST be inside `../colony-cults-archive` |
| `sourceUrl` | string | origin URL (IIIF image URL for pages; empty for derived PDF/text) |
| `sha256` | string | content checksum |
| `format` | string | `image/jpeg`, `application/pdf`, `text/plain` |
| `pageOrdinal` | number \| null | for page images |

## Provenance record

Per-asset JSON sidecar written next to the asset (`<asset>.provenance.json`).

| Field | Type | Notes |
|---|---|---|
| `asset` | `Asset` | the described asset |
| `retrievedAt` | string (ISO) | retrieval timestamp |
| `sourceId` | string | e.g. `PB-P001` |
| `issueArk` | string | owning issue |
| `ocrStatus` | `'none' \| 'searchable' \| 'failed'` | |
| `rights` | `Rights` | includes `rawResponse` (raw OAIRecord) — FR-005 |
| `tool` | string | `gallica-fetcher@<version>` |

## On-disk layout (default; conform to archive-repo convention once cloned)

```text
../colony-cults-archive/
└── PB-P001-la-nouvelle-france/
    └── 1879-07-15_bpt6k5603637g/
        ├── f001.jpg  + f001.jpg.provenance.json
        ├── …
        ├── issue.pdf + issue.pdf.provenance.json      # when OCR run
        └── issue.txt + issue.txt.provenance.json      # when OCR run
```

## Relationships

`Source 1—* Census(issues) 1—1 Issue 1—* Asset 1—1 Provenance`. Rights attaches to an Issue and is copied into every Provenance record under it.
