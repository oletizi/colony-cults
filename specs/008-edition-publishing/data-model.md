# Phase 1 Data Model: Edition Publishing

**Feature**: `specs/008-edition-publishing` | **Date**: 2026-07-12

Entities the publish pipeline reads/writes. New types extend the existing SSOT model
(`@/model`, `@/bibliography`); nothing here replaces `RepositoryRecord`.

## Entity relationship (text)

```
Source (existing, extended)
  ├─ rights: SourceRights          NEW — affirmative, controlled, work-level
  ├─ repositoryRecords[]           existing — other archives' held copies (unchanged)
  └─ publications[]: Publication   NEW — per-edition derivatives WE published
        └─ manifest → path ─────▶ PublicationManifest (separate file)
                                     └─ issues[]: PublishedArtifactRef
```

A `Publication` is to `publications[]` what a `RepositoryRecord` is to `repositoryRecords[]`:
a lean entry on the Source whose per-issue integrity lives in a referenced manifest file
(mirroring `RepositoryRecord.manifest` → `AssetManifestRef.manifestPath`).

---

## 1. SourceRights (NEW) — the affirmative publish-gate determination

The controlled, work-level rights value the publish gate requires. Distinct from the
copy-level `Rights` (`@/model/rights`, per-ark Gallica `dc:rights` classification on a
`RepositoryRecord`).

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `status` | `SourceRightsStatus` | yes | controlled vocab; only affirmative distributable values clear the gate |
| `basis` | `string` | yes | free-text justification recorded on the cleared publication (`rightsBasis`), e.g. "1881 imprint; author d. <1900; French public domain" |
| `determinedAt` | `string` (ISO date) | no | when the determination was made |

**`SourceRightsStatus` controlled vocabulary** (new, in `@/bibliography/vocab`):

- `public-domain` — **v1 affirmative/distributable.** Clears the gate.
- (extensible, non-blocking for v1: `openly-licensed`, `gov-reusable`.)
- Any absent / non-affirmative state (no `rights`, or a free-text "likely" note) → **NOT
  distributable → publish refused** (FR-002, Constitution IV, fail-closed).

**Validation**:
- `status` MUST be a member of the closed vocab (rejected by the loader otherwise).
- The publish gate treats ONLY affirmative-distributable members as clearing; every other
  state (including absent `rights`) fails closed with a descriptive refusal.
- **Migration**: PB-P001's current free-text `notes` fragment `"Public domain: likely"` is
  upgraded to `rights: { status: public-domain, basis: "…" }` as a captured task before it
  can publish. The free-text note is not consulted by the gate.

**State transitions**: none — a hand-authored determination edited in place (like the source's
other authored fields). Absent → present is a plain field edit, not a state machine.

---

## 2. Publication (NEW) — a per-edition entry on `Source.publications[]`

One published derivative edition (one variant, from one pinned snapshot).

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `variant` | `'parallel' \| 'english-only'` | yes | which edition variant was published (FR-012) |
| `publishedAt` | `string` (ISO date) | yes | publish date (FR-005) |
| `snapshot` | `string` | yes | the FULL pinned archive-commit ref the build came from (`site/data/archive-source.json` `.ref`); the key uses its short form |
| `snapshotShort` | `string` | yes | the short form embedded in the versioned key (the version token, FR-003) |
| `cdnBase` | `string` | yes | the recorded canonical CDN base (`${CORPUS_CDN_BASE}`), so per-issue URLs are reconstructable and a future custom-domain move is a base rewrite (FR-014) |
| `keyScheme` | `'versioned' \| 'legacy-flat'` | yes | `versioned` for new publications; `legacy-flat` for the reconciled 72 (FR-013) — makes the two coexisting URL shapes explicit in the record |
| `rightsBasis` | `string` | yes | the `SourceRights.basis` that cleared the gate (FR-005) |
| `machineAssist` | `MachineAssistLabel` | no | engine + date for machine-assisted (translated) editions; REQUIRED for `english-only` (translated), absent for a pure-facsimile edition (Constitution IV) |
| `manifest` | `PublicationManifestRef` | yes | reference to the per-issue integrity manifest file (FR-006) |

`MachineAssistLabel`: reuse the existing shape from `@/pdf/model` (`MachineAssistLabel` — the
translation engine label already carried through the build colophon), keeping the "translations
are labeled machine-assisted" invariant (Constitution IV) consistent between the PDF and its
publication record.

`PublicationManifestRef` (mirrors `AssetManifestRef`):

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `manifestPath` | `string` | yes | repo-relative path to the manifest file under `bibliography/publications/` |
| `issueCount` | `number` | yes | derived count of published issues in the manifest |

**Identity / idempotency**: a publication is identified by `(variant, snapshotShort)`. A
re-publish of the identical version is a no-op (the entry already exists; FR-004). A changed
rebuild produces a new `snapshotShort` → a new `Publication` entry (never a mutation of the old
one; FR-009). Uniqueness of `(variant, snapshotShort)` within `publications[]` is validated.

---

## 3. PublicationManifest (NEW) — the per-issue integrity file

A standalone file (NOT inlined in the source YAML), referenced by `Publication.manifest.manifestPath`.
Keeps the source YAML lean; one manifest per published version.

**Location**: `bibliography/publications/<sourceId>-<variant>-<snapshotShort>.yml` (for the
reconciled 72: `<sourceId>-<variant>-legacy.yml`, since they have no snapshot version).

**Shape**:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `sourceId` | `string` | yes | owning source (FK) |
| `variant` | `'parallel' \| 'english-only'` | yes | matches the publication entry |
| `snapshot` | `string` | yes (versioned) | full ref; absent/`legacy` for reconciled flat set |
| `issues` | `PublishedArtifactRef[]` | yes | one entry per published issue PDF |

### PublishedArtifactRef (element of `issues[]`)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `issueId` | `string` | yes | the built item id (`build/pdf/<sourceId>/<issueId>.pdf`) |
| `url` | `string` | yes | canonical public CDN URL `${cdnBase}/${key}` (FR-006/FR-014) |
| `key` | `string` | yes | the object-store key (versioned or legacy-flat) |
| `sha256` | `string` | yes | lowercase-hex sha256 of the published PDF bytes (FR-007) |
| `pages` | `number` | yes | page count of the PDF |

**Validation**:
- Every `sha256` is 64 lowercase hex chars (reuses the archive's checksum invariant).
- `url === cdnBase + '/' + key` (the URL is derived, never free-typed).
- Deterministic serialization (fixed key order, sorted by `issueId`) so a re-run yields a
  byte-identical manifest (idempotency, SC-004) — mirroring `serializeProvenance` /
  `serializeSource`.

---

## 4. PublishedArtifact (conceptual) — the immutable object in the store

Not a persisted TS record beyond `PublishedArtifactRef`; it is the object at `key` in the
public bucket, fronted by the CDN.

- **Versioned key** (new): `editions/<variant>/<sourceId>/<issueId>__<snapshotShort>.pdf`.
- **Legacy-flat key** (the reconciled 72): `editions/english-only/PB-P001/<issueId>.pdf`.
- **Immutability**: a distinct build → a distinct `snapshotShort` → a distinct key. The publish
  gate's idempotent skip (`head(key).sha256 === computed` → skip) means an existing versioned
  key is expected to already hold the identical bytes; a present-but-DIFFERENT sha256 at a
  versioned key is an integrity contradiction → **fail loud** (never overwrite; FR-009/FR-011).
- **ContentType**: `application/pdf` on `put`.

---

## 5. Source (existing) — extension summary

`@/model/source.ts` `Source` gains two OPTIONAL fields (additive; existing files stay valid):

- `rights?: SourceRights`
- `publications?: Publication[]`

**Loader impact** (`@/bibliography/load.ts`): both keys MUST be added to the closed
`SOURCE_KEYS` allow-list (`load.ts:41`) with matching per-element validators (mirroring the
`repositoryRecords` parse path, `load.ts:200-223`), or the loader rejects the new keys.

**Serializer impact** (`@/bibliography/migrate-serialize.ts`): `serializeSource` gains ordered
emission of `rights` and `publications[]` (mirroring `orderedRecord`), emitted only when
present, in a fixed key order for idempotent re-serialization. A small "write one source file"
helper (`writeFileSync(bibliography/sources/<id>.yml, serializeSource(...))`, per `migrate.ts:454`)
is added since no standalone single-source writer is exported today.

**Validation impact** (`@/bibliography/validate*.ts`): add publication checks — `(variant,
snapshotShort)` uniqueness, manifest-file existence, and `rightsBasis` present when a
publication exists.
