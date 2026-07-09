# Phase 0 Research: Archive Object Store (Backblaze B2)

All spec ambiguities were resolved in the clarify session (see spec.md
§ Clarifications). This document records the technical decisions the plan rests
on. Format per decision: Decision / Rationale / Alternatives considered.

## 1. S3 client library

- **Decision**: `@aws-sdk/client-s3` (AWS SDK for JavaScript v3), pointed at B2's
  S3-compatible endpoint (`endpoint`, `region: us-west-004`, `forcePathStyle` as
  needed). Use `HeadObjectCommand` (existence + metadata), `PutObjectCommand`
  (upload), `GetObjectCommand` (read/verify).
- **Rationale**: B2 exposes a documented S3-compatible API; the AWS v3 client is
  the best-supported, tree-shakeable, typed client and was the design's lean. The
  put/get/delete round-trip against this exact endpoint was verified live in the
  design session.
- **Alternatives considered**: a hand-rolled SigV4 signer + `fetch` (rejected:
  reimplements signing, error-prone, no upside at this scale); Backblaze's native
  B2 API (rejected: the S3 surface is simpler and already verified); `rclone` as a
  subprocess (rejected for the in-tool write path — it is fine for the one-off bulk
  migration already done, but shelling out per object couples the tool to an
  external binary and loses typed error handling).

## 2. Credentials: source, parsing, and passing

- **Decision**: Parse `~/.config/backblaze/b2-credentials.txt` (YAML-ish:
  `keyID` / `keyName` / `applicationKey`). Strip leading whitespace **including
  tabs** from each value (the `applicationKey` line uses a tab after the colon).
  Map `keyID → accessKeyId`, `applicationKey → secretAccessKey`. Hand the pair to
  the `S3Client` constructor's `credentials` in-process. Never place secrets on
  argv.
- **Rationale**: FR-009. The tab-after-colon gotcha caused a `bad_auth_token`
  in the design session when only spaces were stripped; the parser must trim `\t`
  too. Passing credentials to the SDK constructor (or via the process env the SDK
  reads) keeps them off the command line and out of logs.
- **Alternatives considered**: relying solely on the SDK default provider chain
  reading `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` from the environment
  (acceptable, and we MAY set those from the parsed file, but explicit constructor
  credentials are more testable and avoid leaking into child processes); a generic
  YAML parser (unnecessary — the file is three known fields; a tiny tab-safe
  line parser avoids a dependency and matches the existing hand-rolled provenance
  parser style).

## 3. Non-secret configuration (bucket / endpoint / region)

- **Decision**: Read bucket, endpoint, and region from environment variables
  (`COLONY_S3_BUCKET`, `COLONY_S3_ENDPOINT`, `COLONY_S3_REGION`) plus the
  credentials-file path (`COLONY_B2_CREDENTIALS`, default
  `~/.config/backblaze/b2-credentials.txt`). Fail loud if any required value is
  missing when the backend is enabled. Document the known values
  (`colony-cults`, `https://s3.us-west-004.backblazeb2.com`, `us-west-004`) in
  quickstart.md — not committed as code defaults.
- **Rationale**: FR-010 — secrets never in git, and even non-secret config stays
  out of the committed source so the tool is not wedded to one operator's bucket.
  Env vars compose cleanly with the worktree/dev workflow and CI.
- **Alternatives considered**: a gitignored `.archive-store.yml` in the archive
  repo (viable and design-mentioned; env vars are lighter and avoid a second file
  format — a config file can be layered later without changing the interface);
  committing bucket/endpoint as code defaults (rejected: ties the open-source tool
  to a private bucket).

## 4. Idempotent skip against B2

- **Decision**: On `put`, attach the sha256 as object metadata
  (`x-amz-meta-sha256`). `head(key)` returns `{exists, sha256?, size?}`. Skip an
  upload (FR-006) when the object exists **and** its metadata sha256 equals the
  master's freshly computed sha256. `--force` (FR-007) bypasses the skip.
  Mismatch (object exists, different sha256) is surfaced, not silently skipped.
- **Rationale**: Makes B2 the authority for "already uploaded," mirroring the
  existing local skip-if-recorded logic. Storing the sha256 as metadata avoids
  trusting ETag semantics (which are MD5/multipart-dependent and not sha256).
- **Alternatives considered**: trust the local companion YAML's recorded sha256
  without a head call (rejected: would skip even if the object were deleted from
  B2 — the spec wants "exists in the object store with the recorded sha256");
  compare ETag (rejected: ETag is not sha256 and is unreliable for multipart).

## 5. Provenance representation

- **Decision**: Extend `ProvenanceFields` with `size` (integer byte count) and a
  nested `object_store` block `{ provider, bucket, key, endpoint }`. Extend the
  deterministic serializer/parser (`src/archive/provenance.ts`) with minimal,
  fixed-order nested-map support so re-serialization stays byte-identical and the
  round-trip parser still reads its own output.
- **Rationale**: FR-004; the design specified the nested shape. Reusing the
  existing companion YAML keeps one provenance record per asset (no second
  manifest to keep in sync). Fixed key order preserves the determinism guarantee
  the module already documents.
- **Alternatives considered**: flat keys (`object_store_provider`, …) — simpler
  serializer but diverges from the design's stated shape and reads worse; a
  separate `object-manifest.yml` (rejected: a second source of truth to reconcile).

## 6. Local cache + gitignore strategy

- **Decision**: The local cache is the existing archive tree on disk. In the
  archive worktree, add image-master globs (`*.jpg`, `*.jpeg`, `*.png` scoped
  under `archive/cases/**`) to `.gitignore`. New masters are written there (cache)
  but never tracked; OCR/verify read them locally (unchanged read path). Because
  gitignore does not untrack already-tracked files, masters committed by prior
  git-writing captures remain tracked — consistent with the go-forward-only scope.
- **Rationale**: FR-013 + the go-forward-only clarification. Reuses the current
  fetch→write→OCR flow with the smallest change: images stop being *added* to git,
  while remaining on disk for the pipeline. B2 is the durable copy.
- **Alternatives considered**: write the cache to a separate gitignored directory
  outside the archive tree (rejected: OCR/verify and `issueDir` layout assume the
  archive path; a parallel tree duplicates path logic); stream every OCR/verify
  read from B2 (rejected by the operator in clarify — network in the OCR hot path).

## 7. Overridable archive root (worktree isolation)

- **Decision**: `resolveArchiveRoot(repoRoot)` currently returns the fixed sibling
  `../colony-cults-archive` with no override. Add an explicit override: an
  `archiveRoot` value resolved from `--archive-root <path>` (CLI) or
  `COLONY_ARCHIVE_ROOT` (env), falling back to the fixed sibling only when neither
  is set. Dev/test point this at a dedicated git worktree of `colony-cults-archive`.
- **Rationale**: FR-014 — the shared clone is dirty and owned by the translation
  session; we must never write there during development. The current hard-coded
  path makes isolated testing impossible, so the override is a prerequisite.
- **Alternatives considered**: create the worktree AT `../colony-cults-archive`
  (rejected: that IS the shared clone); a per-run temp clone (rejected: a 2.1 GB
  clone per run is prohibitive; a worktree shares the object store cheaply).

## 8. Failure atomicity (upload vs provenance)

- **Decision**: Order operations so a crash never leaves provenance claiming an
  upload that did not happen: compute sha256 → `put` to B2 (with metadata) →
  **only then** write the companion YAML (with `object_store` + sha256 + size) and
  update the manifest. An upload failure throws before any provenance is written,
  so a re-run re-attempts cleanly (resumable). The write-guard
  (`assertInsideArchive`) still runs first.
- **Rationale**: Edge cases in the spec require no half-recorded provenance and
  clean resumability. Provenance is the "this was durably stored" record, so it
  must be written last.
- **Alternatives considered**: write provenance first then upload (rejected: a
  failed upload would leave a lie in git); a two-phase/pending marker (rejected as
  over-engineered — throw-before-record already gives clean resumability).
