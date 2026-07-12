# Phase 0 Research: Edition Publishing

**Feature**: `specs/008-edition-publishing` | **Date**: 2026-07-12

All four *material* scope decisions were resolved in `/speckit-clarify` (see `spec.md`
§ Clarifications) and in the design record (`docs/superpowers/specs/2026-07-12-edition-publishing-design.md`
§ Decisions). This file records the **technical** resolutions the plan depends on — the
concrete existing surfaces `pdf:publish` reuses, and the small number of remaining
implementation-shaped choices — so Phase 1 has no `NEEDS CLARIFICATION` left.

## Decision 1 — Reuse the shipped object-store layer for upload + idempotency

**Decision**: Publish uploads through the existing `@/archive` object-store surface, not a
new client. The idempotent "upload-only-if-changed" behavior (FR-004) is implemented over
`ObjectStore.head(key)` + `ObjectStore.put(key, bytes, { sha256, contentType })` directly.

- `S3ObjectStore` (`src/archive/s3-object-store.ts`) is the real B2 backend: `put`, `head`
  (returns `{ exists, sha256, size, etag }`), `get`, `attachSha256Metadata`. Path-style,
  adaptive retry — battle-tested by the fetcher.
- `resolveObjectStoreConfig(env)` (`src/archive/b2-config.ts`) resolves bucket/endpoint/region
  from `COLONY_S3_BUCKET` / `COLONY_S3_ENDPOINT` / `COLONY_S3_REGION` and credentials from
  `~/.config/backblaze/b2-credentials.txt` (overridable via `COLONY_B2_CREDENTIALS`). Fails
  loud on any missing value.
- `sha256OfFile` / `sha256OfBytes` (`src/archive/checksum.ts`) — lowercase-hex sha256 (FR-007).

**Rationale**: The publish idempotency contract is precisely "does the versioned key already
hold this exact sha256?" — one `head(key)` answers it (`head.sha256 === computed` → skip;
absent → put; present-but-different is *impossible* under the immutable versioned scheme and
is treated as fail-loud, not overwrite). Reuses proven, fail-loud code.

**Alternatives rejected**: `storeAsset` (`src/archive/store.ts`) — it is scoped to the
*private archive root* (`assertInsideArchive`, companion `.yml`, `MANIFEST.sha256`) and models
preservation masters, not public derivative editions in the `editions/` keyspace. Its
head-then-put *pattern* is the reference; its archive-root machinery is not applicable.

## Decision 2 — Versioned key scheme and canonical CDN URL

**Decision**:
- Versioned object key (new publications): `editions/<variant>/<sourceId>/<issueId>__<snapshotShort>.pdf`
  where `<snapshotShort>` is the pinned archive commit truncated to its short form.
- Un-versioned key (the 72 reconciled PB-P001 issues, FR-013): `editions/english-only/PB-P001/<issueId>.pdf`
  (recorded at their existing served keys — no re-upload).
- Canonical recorded URL: `${CORPUS_CDN_BASE}/<key>` — reads resolve through the Cloudflare
  read-through CDN (`https://colony-cults-cdn.oletizi.workers.dev`), matching the archive's
  `object_store.key`-as-CDN-path contract (`infra/cloudflare-cdn/README.md`, FR-014).

**Rationale**: The versioned key ties each artifact to its reproducible corpus version; a
re-pin/rebuild yields a new `<snapshotShort>` → a new key → a new record, and the old URL is
never overwritten (FR-003/FR-009), so **no CDN purge is ever required** (sidesteps the
`workers.dev` no-per-URL-purge limitation). The two key shapes coexist by design.

**Alternatives rejected** (design record § Rejected): stable URL + `CACHE_VERSION` bump (serves
stale content briefly — unacceptable for an integrity artifact); PDF-sha prefix in the key
(the snapshot short is the *reproducibility* identifier scholars can act on, not an opaque hash).

## Decision 3 — The version token comes from the existing archive pin

**Decision**: `<snapshotShort>` is derived from `site/data/archive-source.json`'s `.ref`
(currently `3b8b1fd6a0d7f76f3c5f9a2b3da94252bbb5dd10`), truncated to its short form
(`3b8b1fd6`). The pin is already read by `src/pdf/config.ts` (`resolvePin`) and recorded in
every built PDF's colophon (`ColophonMeta.archiveRef`, `src/pdf/model.ts`).

**Rationale**: The build already pins and records this exact ref; publishing must record the
*same* pin so a publication is reproducible from its record. Reusing the pin resolver keeps
build and publish provenance-consistent. Truncation length: use the git-conventional short
(matches the design's `3b8b1fd6` example — 8 hex chars); assert non-empty (no pin → fail loud,
Constitution V, mirroring the build's own guard).

**Open (non-blocking, plan-time)**: whether to record the FULL ref alongside the short in the
publication entry (short in the key for readability, full ref in the record for exactness). The
data model carries the full `snapshot` ref in the record; the key uses the short.

## Decision 4 — Publication record placement and the SSOT write path

**Decision**: A publication is a per-edition entry in a new `publications[]` array on the
`Source` (distinct from `repositoryRecords[]`), with per-issue integrity in a **separate
manifest file** referenced by path — mirroring the existing `RepositoryRecord.manifest`
(`AssetManifestRef` → `manifestPath` + count) pattern.

- Read: `loadSourceFile(filePath): LoadedSource` / `loadAllSources(dir)` (`src/bibliography/load.ts`).
- Write: the deterministic serializer `serializeSource(migrated): string`
  (`src/bibliography/migrate-serialize.ts`, `yaml` `stringify`, fixed key order, absent
  optionals omitted → byte-idempotent re-serialize). It must learn to emit `rights` and
  `publications[]` in the fixed key order.

**Rationale**: A published PDF edition is a *derivative WE made and host* — semantically
distinct from the source (the work) and from `repositoryRecords[]` (other archives' copies).
It belongs *on* the source (one place to read a source's full provenance). Per-issue integrity
in a manifest keeps the source YAML lean (the ~144-entries-inline alternative was rejected in
the design record).

**Manifest location** (design open question, resolved to informed default): a dedicated
`bibliography/publications/<sourceId>-<variant>-<snapshotShort>.yml`, named stably across
re-publishes of the *same* version (a new version → a new snapshotShort → a new manifest file,
never an overwrite — consistent with immutable artifacts).

## Decision 5 — The publish rights gate is NEW and source-level, distinct from the fetch gate

**Decision**: Add an affirmative, controlled `Source.rights` field. The publish gate refuses
unless it holds an affirmative distributable value (v1 vocabulary: `public-domain`; extensible
to `openly-licensed`, `gov-reusable`, …). This is a DIFFERENT gate from the existing
per-issue fetch-time rights gate (`src/rights/gate.ts` / `assertPublicDomain`), which resolves
Gallica `dc:rights` at *download* time and lives on `RepositoryRecord.rights` (`Rights`).

**Rationale**: The design and clarification decided the publish determination is *source-level*
(a published edition derives from the source as a whole), affirmative, and fail-closed
(Constitution IV). The fetch gate answers "may we mirror this master?"; the publish gate answers
"may we distribute this derivative edition?" — related but separate determinations, so a new
field, not an overload of `RepositoryRecord.rights`.

**Consequence**: PB-P001's current free-text `Public domain: likely` note must be upgraded to a
structured affirmative `rights: public-domain` before it can publish (US2 / reconciliation
depend on it). This is a data edit, captured as a task.

**Alternatives rejected**: reusing `RepositoryRecord.rights` (`Rights`) — it is copy-level and
carries fetch-time `dc:rights` evidence + an `other`/`public-domain` *classification*, not an
affirmative distributability decision for the work; conflating them would let a per-copy fetch
note stand in for a publish clearance.

## Decision 6 — Composable verb, over pre-built PDFs; input resolution + variant

**Decision**: `pdf:publish` is a sibling npm/CLI verb (`scripts/publish-pdf.ts`, wired as
`"pdf:publish": "tsx scripts/publish-pdf.ts"`), operating over the `pdf:build` output tree
`build/pdf/<sourceId>/<issueId>.pdf`. It does NOT build (FR-001).

- **`--variant <english-only|parallel>` is REQUIRED** (not inferable): `pdf:build` writes both
  variants to the *same* `<issueId>.pdf` path (`src/pdf/render/build.ts` — variant is not
  encoded in the filename), so the operator must declare which variant the built tree holds.
  The variant is recorded on the publication and is part of the versioned key.
- Selector shape mirrors `pdf:build`: `<sourceId>` (whole source) — v1 need not support
  single-issue publish, but the arg parser should be the same shape for consistency.
- A **reconcile mode** (`--reconcile`, FR-013) records already-served un-versioned PB-P001
  URLs without upload (back-fill only).

**Rationale**: Matches the shipped composable split (`site:snapshot` / `site:export-public` /
`pdf:build`) and the CLI conventions of `scripts/build-pdf.ts` (fail-loud arg parsing, unknown
flag → throw, `main().catch` non-zero exit).

**Alternatives rejected** (design record): a single `publish` that builds-then-uploads (couples
concerns, rebuilds every publish).

## Decision 7 — CDN warming is best-effort and non-fatal (FR-015, SHOULD)

**Decision**: After a successful publish, optionally prime each new URL with an anonymous GET
through the CDN (reusing the `defaultHttpGet` / `publicObjectUrl` pattern from
`src/archive/public-cache.ts`). A warm/verify read is the download-capped transaction class:
a `403 download_cap_exceeded` (or any warm failure) is **surfaced, not fatal** — the recorded
publication stands regardless (the upload is a separate, uncapped write class).

**Rationale**: Edge/config-only concern; warming is an optimization, not part of the integrity
contract. Constitution V's fail-loud applies to the *publication*, not to a best-effort cache
prime — hence explicit non-fatal handling, clearly reported.

## Testing approach

- Reuse `tests/unit/archive/fake-object-store.ts` (`FakeObjectStore implements ObjectStore`,
  in-memory, with the counting-subclass pattern from `store-idempotent.test.ts` /
  `store-skip.test.ts`) to assert idempotency (SC-004: zero puts on unchanged re-run) and
  immutability (SC-005) with no network.
- vitest, layout `tests/unit/**` + `tests/integration/**`; add a `pdf:test`-adjacent
  `tests/unit/publish/**` group. Rights-gate refusal (US2/SC-003) and reconcile back-fill
  (US4/SC-006) are pure/unit-testable with the fake store + a temp SSOT dir.

## Consolidated open items (all non-blocking, carried as informed defaults)

| Item | Resolution |
|------|------------|
| Manifest file location | `bibliography/publications/<sourceId>-<variant>-<snapshotShort>.yml` (Decision 4) |
| Record full ref vs short | Key uses short; record carries full `snapshot` ref (Decision 3) |
| CDN URL canonicalization across a future custom-domain move | Record `${CORPUS_CDN_BASE}/<key>`; a future zone move rewrites the base — plan-time, not a v1 blocker (spec Assumptions) |
| Single-issue publish selector | Parser shape supports it; v1 scope is whole-source (Decision 6) |
