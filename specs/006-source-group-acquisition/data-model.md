# Phase 1 Data Model: Source-Group Acquisition

Reuses the shipped canonical-metadata model (`src/model/source.ts`, `src/model/repository-record.ts`, `src/bibliography/vocab.ts`). All additions are **additive optional fields** — no breaking change. Amendments to `specs/004-canonical-source-metadata` are flagged where a field extends its interfaces.

## Entities

### Source (member) — reused, no new required fields

| Field | Source | Notes |
|-------|--------|-------|
| `sourceId` | shipped | Flat opaque `PB-P###`, allocated atomically (D-06). No group prefix. |
| `kind` | shipped | `monograph` (default) or `periodical`; never `source-group` for a member. |
| `partOf` | shipped | The **sole** membership edge → the group's `sourceId`. Authoritative; never re-supplied by `promote`. |
| `status` | shipped | `SourceLifecycleStatus`: `discovered` → (`approved-for-acquisition` \| `excluded`). Alternatives, not a chain. |
| `titles`, `creator`, `identifiers`, `case`, `language`, `notes` | shipped | Populated from the discovery/OAI record at inventory. |

**No change to the `Source` interface's required fields.** Membership and lifecycle already exist (shipped by source-groups).

### RepositoryRecord — reused + additive optional fields

Keyed by `(sourceId, sourceArchive)` (shipped). Created at inventory.

| Field | Source | Notes |
|-------|--------|-------|
| `sourceId`, `sourceArchive` | shipped | Composite key; `sourceArchive` is the `--archive` selector value (D-05). |
| `identifiers` (`CopyIdentifier[]`) | shipped | Holds the ark. |
| `rights` | shipped | Extended below with raw+normalized (D-07). |
| `catalogUrl` / `originalUrl` / `retrievedAt` | shipped | Populated at inventory. |
| `status` | shipped | `RepositoryAcquisitionStatus`: `wanted` at inventory → `to-collect` at promote → … |
| **`metadataSnapshot`** (optional) | **NEW (additive)** | Reference to the immutable snapshot (below). *Candidate 004 amendment.* |
| **`verification`** (optional) | **NEW (additive)** | The recorded verdict from promote's rerun (below). *Candidate 004 amendment.* |

### Rights (on RepositoryRecord) — raw + normalized (D-07)

| Field | Notes |
|-------|-------|
| `rightsRaw` | The archive's verbatim rights statement (evidence). |
| `rightsStatus` | Normalized `public-domain` \| `other` (shipped `RIGHTS_VALUES`). Only `public-domain` is acquirable. |

If the shipped `Rights` type does not already carry both, the raw field is the additive extension (candidate 004 amendment).

### MetadataSnapshot — NEW immutable entity (D-07)

One raw repository response, written once and never overwritten. Re-inventory appends a new snapshot.

| Field | Notes |
|-------|-------|
| `path` | Location of the stored raw response, under `bibliography/` (exact subpath decided in tasks). |
| `retrievedAt` | ISO timestamp of retrieval. |
| `endpoint` | The discovery/repository endpoint used. |
| `normalizationVersion` | The normalization scheme version applied to derive normalized fields. |

Referenced by `RepositoryRecord.metadataSnapshot`. Immutability is a write-once invariant enforced by exclusive-create (never overwrite).

### VerificationVerdict — NEW value recorded by promote (D-03, rerun+record)

| Field | Notes |
|-------|-------|
| `result` | `passed` (promote only records on pass; failure aborts and records nothing). |
| `verifiedAt` | ISO timestamp of the rerun. |
| `checks` | Per-check outcomes: `identifierResolved`, `rights`, `requiredMetadata`, `hardDuplicate`, `possibleDuplicate` (`passed` \| `review-required`). |
| `snapshotRef` | The `metadataSnapshot` the verdict was computed against (ties verdict to evidence). |

Stored as `RepositoryRecord.verification` (additive optional).

### DiscoveryCandidate — transient (not persisted until inventory)

| Field | Notes |
|-------|-------|
| `identifier` | The ARK/record id surfaced by the discovery helper. |
| `titleHint`, `creatorHint`, `dateHint` | For the researcher's relevance judgment. |
| `endpoint` | Which (single) mechanism produced it. |

Becomes a member Source + RepositoryRecord only when the researcher runs `inventory`.

## State transitions

### Source lifecycle (`SourceLifecycleStatus`)

```
                 ┌────────────────────────► approved-for-acquisition   (promote, rerun-verify passes)
discovered ──────┤
                 └────────────────────────► excluded                   (exclude-member --reason)
```

- `promote` requires `status == discovered` and a passing rerun verification; failure leaves `discovered`.
- `exclude-member` requires `status == discovered`; records a reason.
- Reconsidering an `excluded` member is an explicit operation (not implicit). *(v1: out of the happy path; surfaced in tasks whether to include a reconsider verb.)*

### RepositoryRecord acquisition (`RepositoryAcquisitionStatus`, disjoint vocab)

```
wanted ──(promote)──► to-collect ──(acquire/fetcher)──► collecting ──► collected ──► archived
```

- Cross-domain values (a Source-lifecycle value on a RepositoryRecord status, or vice-versa) are rejected by the shipped `validateVocab` (FR-022).
- Inventory writes `wanted`; promote advances only the **selected** record to `to-collect`.

## Validation rules (from requirements)

- **FR-002/FR-005**: `partOf` MUST resolve to an existing `kind: source-group`; else inventory fails loud.
- **FR-001**: `sourceId` allocation atomic (exclusive-create + retry).
- **FR-003**: RepositoryRecord created at `wanted`.
- **FR-006–008**: verification is deterministic; duplicate classes per D-04.
- **FR-009a**: `--archive` required when >1 RepositoryRecord; infer when exactly 1.
- **FR-010a/b**: promote reruns verification and records the verdict on pass; aborts on fail.
- **FR-017**: acquire refuses members not `approved-for-acquisition`; only `public-domain` acquired.
- **FR-022**: two vocabularies stay disjoint (shipped validation).

## 004 amendment surface (open operator item, D-07)

Additive optional fields that extend `004-canonical-source-metadata` interfaces: `RepositoryRecord.metadataSnapshot`, `RepositoryRecord.verification`, and `rights.raw` (if not already present). **Default**: implement as additive optional fields on the shipped interfaces and cross-reference 004; the explicit-amendment-to-004 decision is surfaced in tasks. No field here is breaking.

**T006 decision (recorded 2026-07-10):** land these as **feature-local additive optional fields** on the shipped `RepositoryRecord`/`Rights` interfaces (implemented in T007), cross-referenced from here to `specs/004-canonical-source-metadata` — **not** as a separate 004 spec amendment. Rationale: the fields are additive and optional (zero breaking impact on 004's existing sources), they are consumed only by this feature's pipeline, and a separate 004 amendment would add process overhead without changing the on-disk shape. If a future feature needs these fields as first-class 004 model concepts, promote them to 004 then. The canonical type home is `src/model/repository-record.ts` (`MetadataSnapshotRef`, `VerificationVerdict`); `src/sourcegroup/snapshot.ts` imports the ref type rather than redefining it.
