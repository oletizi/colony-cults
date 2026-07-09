# Contract: Source Record SSOT file format

**Path**: `bibliography/sources/PB-###.yml` (one file per Source, public repo).
**Reader**: `bibliography/load.ts` (parses via `yaml`, then narrows via validators).
**Authoritative for**: bibliographic Source fields + authored Repository-Record overrides. Everything else is derived.

## Shape (example — PB-P001, the two-copy fix)

```yaml
sourceId: PB-P001
kind: periodical
case: port-breton
language: French
creator: Marquis de Rays / colonial enterprise
titles:
  - text: "La Nouvelle France : journal de la colonie libre de Port-Breton, Océanie"
    role: canonical
  - text: "La Nouvelle-France"
    role: alternate
identifiers:
  - type: issn
    value: "0000-0000"          # work-level only (ISBN/ISSN/OCLC)
repositoryRecords:
  - sourceArchive: "Gallica / BnF"
    status: collected
    catalogUrl: "https://gallica.bnf.fr/ark:/12148/cb328261098/date"
    retrievedAt: "2026-07-08"
    identifiers:
      - type: ark
        value: "ark:/12148/cb328261098/date"   # copy-level only (ARK/IIIF/scan-DOI)
    census: data/census/PB-P001-la-nouvelle-france.json
  - sourceArchive: "State Library of Queensland"   # RESTORED — was overwritten (SC-005)
    status: collected
    catalogUrl: "https://onesearch.slq.qld.gov.au/..."
    identifiers:
      - type: iiif-manifest
        value: "https://.../manifest.json"
```

## Rules (enforced by `load.ts` + `validate.ts`)

1. `sourceId` MUST match `^PB-[A-Z]?\d{3}$` and equal the filename stem.
2. `titles` MUST have ≥1 entry; each `role` ∈ {canonical, archive, alternate, translated}; no `authoritative` key permitted.
3. `identifiers` on a Source MUST be work-level types only; a copy-level type here is a **leak** finding (FR-018).
4. Each `repositoryRecords[]` entry MUST carry `sourceArchive` + `status`; `identifiers` MUST be copy-level types only.
5. `(sourceId, sourceArchive)` MUST be unique across all records (no duplicate copies).
6. `census` (serials) MUST point to an existing `data/census/*.json`; issues are derived from it, never inlined.
7. Storage fields (`manifest`/`objectStore`/`localPath`) are **derived** and SHOULD NOT be hand-authored; if present they are treated as overrides and validated against the derived roll-up.
8. Unknown top-level keys are a validation finding (fail loud — no silent drop).

## Serialization (writes)

Authored files are human-owned (free formatting). **Generated** artifacts (the derived views) are hand-serialized in fixed field order — see `validation.md` §Determinism and `regenerate.ts`.
