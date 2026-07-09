# Contract: `ObjectStore` backend + provenance schema

This feature's external contracts are (1) the `ObjectStore` interface the
archive-writer depends on and (2) the extended provenance schema. Both are
internal-to-the-tool contracts (this is a CLI/library, not a network service).

## `ObjectStore` interface (`src/archive/object-store.ts`)

```ts
/** Result of a HEAD against an object key. `exists:false` is NOT an error. */
export interface ObjectHead {
  exists: boolean;
  /** sha256 stored as object metadata on PUT, when present. */
  sha256?: string;
  /** object size in bytes, when the store reports it. */
  size?: number;
}

/** Options for a PUT. */
export interface PutOptions {
  /** sha256 to persist as object metadata (drives idempotent skip). */
  sha256: string;
  /** MIME type, e.g. image/jpeg. */
  contentType?: string;
}

/** S3-compatible object store the archive-writer depends on (injected). */
export interface ObjectStore {
  /** Metadata for a key; { exists:false } when absent. Throws on transport/auth error. */
  head(key: string): Promise<ObjectHead>;
  /** Upload bytes at key with metadata. Throws on failure (no silent success). */
  put(key: string, bytes: Uint8Array, options: PutOptions): Promise<void>;
  /** Fetch bytes at key. Throws when the object is missing or on transport error. */
  get(key: string): Promise<Uint8Array>;
}
```

### Behavioral guarantees (must hold for any implementation)

1. `head` distinguishes "absent" (`{exists:false}`, no throw) from an error (throw).
2. `put` is create-or-overwrite; after it resolves, `head(key).exists === true` and
   `head(key).sha256 === options.sha256`.
3. `get(key)` after a successful `put(key, bytes, …)` returns byte-identical `bytes`.
4. No operation writes to git, the working tree, or stdout; failures throw typed
   `Error`s with actionable messages (no fallbacks — FR-011).

### Test double

`tests/unit/archive/fake-object-store.ts`: an in-memory `Map<string,{bytes,sha256}>`
implementing `ObjectStore`, used by all unit tests. No network. The real
`S3ObjectStore` (`src/archive/s3-object-store.ts`) is exercised only by the opt-in
integration test (gated on credentials).

## Extended provenance schema (companion YAML)

Adds to the existing fixed-order record:

```yaml
# ... existing fields (id, title, ..., sha256, format, ocr_status) ...
size: 123456
object_store:
  provider: "backblaze-b2"
  bucket: "colony-cults"
  key: "archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k5603637g/f001.jpg"
  endpoint: "https://s3.us-west-004.backblazeb2.com"
# notes, rights_raw stay last
```

- `object_store: null` when the asset is not in the object store.
- Serialization is deterministic (fixed key + sub-key order); the round-trip
  parser reads its own output byte-for-byte.

## CLI surface (unchanged flags, new behavior + new flags)

| Flag | Behavior |
|------|----------|
| (default capture) | masters upload to B2 + local gitignored cache; provenance records `object_store` |
| `--force` | re-upload even when B2 already holds a matching object |
| `--verify` | fetch each recorded master from B2 by key and compare sha256; report mismatch/missing |
| `--archive-root <path>` | override the archive root (dev/test worktree); else `COLONY_ARCHIVE_ROOT`, else fixed sibling |

Environment: `COLONY_S3_BUCKET`, `COLONY_S3_ENDPOINT`, `COLONY_S3_REGION`,
`COLONY_B2_CREDENTIALS`, `COLONY_ARCHIVE_ROOT`.
