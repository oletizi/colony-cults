# Phase 1 Data Model: Archive Object Store (Backblaze B2)

Entities and their fields/relationships. This feature extends the existing
provenance record and adds an object-store location; it introduces no database.

## Provenance record (companion YAML) — EXTENDED

The per-asset companion YAML (`src/archive/provenance.ts`, `ProvenanceFields`).
Existing fields are unchanged; two additions:

| Field | Type | New? | Notes |
|-------|------|------|-------|
| id, title, type, case, language, source_archive | string | no | unchanged |
| catalog_url, original_url, rights_status, retrieved | string | no | unchanged |
| local_path | string | no | archive-relative cache path (unchanged) |
| sha256 | string (64 hex) | no | derived from bytes (unchanged) |
| format, ocr_status | string | no | unchanged |
| notes | string \| null | no | unchanged |
| rights_raw | string (block) | no | unchanged; stays last |
| **size** | integer (bytes) | **yes** | byte length of the master |
| **object_store** | nested block \| null | **yes** | present when the master was uploaded; see below |

### `object_store` nested block

| Sub-field | Type | Notes |
|-----------|------|-------|
| provider | string | e.g. `backblaze-b2` |
| bucket | string | e.g. `colony-cults` |
| key | string | object key = archive-relative path (see Object key) |
| endpoint | string | e.g. `https://s3.us-west-004.backblazeb2.com` |

- **Determinism**: emitted in fixed sub-key order (`provider`, `bucket`, `key`,
  `endpoint`) so re-serialization is byte-identical. `size` slots in a fixed
  position; the round-trip parser is extended to read a nested block and an
  integer.
- **Nullability**: `object_store` is `null` for assets not stored in the object
  store (e.g. legacy local-only assets); code must handle both.
- **Validation**: when `object_store` is present, `sha256` and `size` MUST be
  present; `key` MUST equal the derived object key for `local_path`.

## Object key — NEW

- **Definition**: the object key mirrors the master's archive-relative path.
  Example: `archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k5603637g/f001.jpg`.
- **Derivation**: `objectKeyForAsset(archiveRoot, targetPath)` = the POSIX-style
  path of `targetPath` relative to `archiveRoot`. No leading slash. Stable across
  OSes (always `/` separators).
- **Uniqueness**: one master ↔ one key. Re-capturing the same page yields the same
  key (idempotent overwrite under `--force`).

## ObjectStore backend — NEW (behavioral contract)

See `contracts/object-store.md`. Injected dependency; no persisted state of its
own beyond what lives in B2.

| Operation | Input | Output | Failure |
|-----------|-------|--------|---------|
| head | key | `{ exists: boolean, sha256?: string, size?: number }` | throws on transport/auth error (not on "absent" — absent is `{exists:false}`) |
| put | key, bytes, `{ sha256 }` | void | throws on upload/auth error |
| get | key | `Uint8Array` | throws on missing object or transport/auth error |

## Object-store configuration — NEW

Resolved once at startup when the backend is enabled.

| Field | Source | Required | Notes |
|-------|--------|----------|-------|
| provider | constant `backblaze-b2` | — | recorded in provenance |
| bucket | env `COLONY_S3_BUCKET` | yes | e.g. `colony-cults` |
| endpoint | env `COLONY_S3_ENDPOINT` | yes | B2 S3 endpoint URL |
| region | env `COLONY_S3_REGION` | yes | e.g. `us-west-004` |
| credentialsPath | env `COLONY_B2_CREDENTIALS` | no | default `~/.config/backblaze/b2-credentials.txt` |
| accessKeyId | parsed from creds file (`keyID`) | yes | never logged/argv |
| secretAccessKey | parsed from creds file (`applicationKey`, tab-safe) | yes | never logged/argv |

- **Validation**: missing bucket/endpoint/region/credentials → fail loud (FR-011).

## Archive root — CHANGED resolution

| Field | Type | Notes |
|-------|------|-------|
| archiveRoot | absolute path | resolved from `--archive-root` / `COLONY_ARCHIVE_ROOT`, else the fixed `../colony-cults-archive` sibling. Points at the dedicated worktree during dev/test (FR-014). |

## State transitions (per master, capture path)

```
absent ──fetch bytes──▶ hashed ──put(key,bytes,{sha256})──▶ uploaded
   ▲                                                            │
   │                                            write provenance (+object_store,size)
   │                                            + update manifest
   └────────────────── skip (head.exists && head.sha256==sha256, no --force)
```

Failure at `put` throws before provenance is written → master stays "absent" from
the record → clean resumable re-run.
