# Design: Canonical Source Metadata Model (`impl:feature/canonical-source-metadata`)

- Date: 2026-07-08
- Roadmap item: `impl:feature/canonical-source-metadata`
- Depends-on: `impl:feature/archive-object-store` (edge to add once that merges to main)
- Status: designing (awaiting operator approval) — **handed off for a fresh session**
- Origin: a third-party design brief ("Canonical Source Metadata Model"), evaluated
  and refined for this project.

## Problem domain

Acquisition is expanding across multiple archives (Gallica, SLQ, Trove, Internet
Archive, HathiTrust, …). Each exposes different metadata and identifiers. The
project has stable internal IDs (`PB-P###`) but no model that (a) unifies a work
across archives while (b) preserving per-archive provenance.

**This is already biting us.** *La Nouvelle France* (`PB-P001`) exists at **both
SLQ and Gallica**. The current per-source stub (`archive/.../PB-P001.yml`) has a
**singular** `source_archive` field, so when acquisition moved from SLQ to Gallica
the SLQ record was **overwritten and lost**. That is the exact duplicate/ambiguity
failure a work-vs-copy separation prevents.

The project also currently carries **five overlapping metadata representations**:
`bibliography/sources.csv`, `bibliography/acquisition-tracker.csv`, the archive's
`acquisition-register.csv`, the per-source `PB-P00X.yml` stubs, and the fetcher's
per-asset provenance YAML. There is no single source of truth.

## Solution space

### Chosen — the third-party two-level model, EXTENDED to this project's realities

Adopt the brief's core separation — **Source** (intellectual work) vs **Repository
Record** (one archive's copy) — with five refinements the brief lacks:

1. **Multi-level, not two-level.** For us it is
   `Source → Repository Record → [Issue] → Asset`:
   - **Source** — the intellectual work. Stable `PB-###`. Work/edition-level
     identifiers only (**ISBN, ISSN, OCLC**). Titles as data (canonical / archive /
     alternate / translated), none authoritative.
   - **Repository Record** — one **source archive's** copy (Gallica, SLQ, IA…).
     Copy-level identifiers (**ARK, IIIF manifest, scan-DOI**), rights, catalog/
     source URL, retrieval date, acquisition status.
   - **Issue** — for serials (our first source is a **78-issue periodical**), a
     Repository Record enumerates issues (this is the existing **census**).
   - **Asset** — one mirrored file (page image / OCR text / translation), each with
     its own `sha256` — already emitted as **per-asset provenance YAML** by the
     shipped fetcher + object-store feature.
   A Repository Record therefore references an **asset set / `MANIFEST.sha256`**, not
   a single `checksum` (the brief's flat single-hash is wrong for periodicals).

2. **Identifier placement fixed.** ARK / IIIF manifest / scan-DOI are **copy-level**
   → Repository Record. Only ISBN/ISSN/OCLC are **work-level** → Source. (The brief
   and its example put ARK at *both* levels — reintroducing the duplication it aims
   to remove.)

3. **Source archive ≠ storage backend.** The brief's `local_archive_path` + single
   `checksum` conflate *where we acquired from* with *where our mirror lives*. The
   **archive-object-store** feature already separates these at the asset level:
   `source_archive`/`original_url`/`catalog_url` (acquisition) vs an `object_store`
   nested block `{provider, bucket, key, endpoint}` (storage), with `local_path` as
   the git-cache fallback and `object_store: null` for legacy assets. The canonical
   model must keep both axes: a Repository Record's *mirror location* is a storage
   reference (B2 object keys or git path), distinct from the archive it came from.

4. **Sits ABOVE the existing per-asset provenance — does not replace it.** The
   fetcher/object-store provenance (`src/archive/provenance.ts`, `ProvenanceFields`)
   stays the ground truth per file. Source + Repository Record are an **aggregation/
   index layer** over it. Decide direction (see open questions): author Source records
   and let assets link up, vs derive Repository Records from asset provenance.

5. **Consolidation is in scope.** Declare **one SSOT** and migrate/derive the other
   four representations from it (don't add a sixth). Candidate: the Source YAML as
   SSOT in the public repo; `sources.csv`/registers become derived/generated views.

### Rejected — adopt the brief verbatim

Its single-`checksum` Repository Record breaks for periodicals; its ARK-at-both-levels
reintroduces duplication; it ignores the storage-vs-archive axis the object-store
feature already established; and it offers no consolidation of the five existing
representations. Adopting as-is would create conflicting metadata.

### Rejected — keep the current flat model

Status quo already lost the SLQ record for PB-P001 and fragments across five files.
Does not scale to multi-archive Phase 2. Rejected.

## Decisions

1. Adopt **Source vs Repository Record** separation, extended to
   `Source → Repository → [Issue] → Asset`.
2. **Work-level identifiers** (ISBN/ISSN/OCLC) on Source; **copy-level** (ARK/IIIF/
   scan-DOI) on Repository Record.
3. Keep **acquisition axis** (`source_archive`, URLs) distinct from **storage axis**
   (`object_store` block / git path), reusing the object-store feature's provenance.
4. Repository Record references an **asset manifest**, not a single checksum.
5. New model **layers over** existing per-asset provenance; pick one **SSOT** and
   consolidate the five current representations.
6. **Scope: sources only.** People / organizations / ships / places / events /
   citations / graph relationships are the separate Phase 3 evidence model.

## Open questions

_Carry into `/stack-control:define`; none are blockers._

- **SSOT + direction**: is the Source YAML authored (assets/repos link up), or is the
  Repository Record *derived* from the asset provenance the fetcher already writes?
  Likely a hybrid: authored Source (bibliographic) + derived Repository/asset roll-up.
- **File layout**: where Source records live (public `bibliography/sources/PB-###.yml`?)
  vs the private archive's per-copy provenance; and how `sources.csv` / registers are
  regenerated from the SSOT.
- **Migration**: fold the five existing representations into the model (esp. restore
  the lost SLQ Repository Record for PB-P001).
- **Serials**: how the Issue layer references the census (`data/census/PB-###-*.json`).
- **Controlled vocabularies**: `status`, `rights` (align to Gallica `dc:rights` +
  SLQ), `provider`, `ocr_status`; required vs optional fields; cardinalities.
- **Validation/tooling**: a schema (JSON Schema / zod) + a lint that checks referential
  integrity (every asset → a Repository Record → a Source) and that copy-level IDs
  don't leak to Source.

## Provenance

- Origin: third-party "Canonical Source Metadata Model" design brief (proposal).
- Evaluation + refinements: this session, 2026-07-08 — grounded against the actual
  artifacts (`bibliography/sources.csv`, `AGENTS.md` source-ID scheme, the archive's
  `acquisition-register.csv` + `PB-P001.yml`, and the shipped fetcher provenance).
- Alignment: the **archive-object-store** feature (branch `feature/archive-object-store`,
  spec `003`) already implemented the per-asset `object_store` provenance block this
  model layers over — see its `specs/003-archive-object-store/data-model.md`.
- Handoff target: `/stack-control:define`.
