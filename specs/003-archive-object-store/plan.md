# Implementation Plan: Archive Object Store (Backblaze B2)

**Branch**: `feature/archive-object-store` | **Date**: 2026-07-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-archive-object-store/spec.md`

## Summary

Give the fetcher's archive-writer (`src/archive/`) a pluggable, S3-compatible
object-store backend targeting Backblaze B2. On capture, page-image masters are
uploaded to B2 and their bytes are kept in a **local, gitignored cache** (the
existing archive tree, with image masters newly gitignored) for OCR and verify to
read; the git-tracked companion provenance records the object-store location
(provider/bucket/key/endpoint) plus the existing sha256 and a new size. Git keeps
census + provenance + OCR text + manifest only — no new image bytes are tracked.
Uploads are idempotent (skip when B2 already holds the object with the recorded
sha256), `--force` re-uploads, and `--verify` re-checks against B2. Everything
fails loud (no fallbacks). All dev/test against the archive repo runs in a
dedicated git worktree, never the shared clone the translation session owns —
which requires making the currently-fixed `archiveRoot` overridable.

## Technical Context

**Language/Version**: TypeScript 5.3 on Node 20, run via `tsx` (ESM, `@/` path alias).

**Primary Dependencies**: `@aws-sdk/client-s3` (v3) for the S3-compatible client
against B2's endpoint; existing `fast-xml-parser`. No new runtime deps beyond the
AWS SDK S3 client.

**Storage**: Backblaze B2 (S3-compatible) bucket `colony-cults`, endpoint
`https://s3.us-west-004.backblazeb2.com`, region `us-west-004`. Local gitignored
cache = the archive tree on disk. Git tracks provenance YAML + `MANIFEST.sha256`.

**Testing**: `vitest`. Unit tests for the S3 backend against an in-memory/faked
`ObjectStore` (no network); an opt-in integration test that does a real
put/head/get/delete round-trip against B2, gated on credentials being present.

**Target Platform**: macOS/Linux dev workstation (CLI tool).

**Project Type**: Single-project CLI/library (`src/`, `tests/`).

**Performance Goals**: Not latency-sensitive; capture is I/O-bound on Gallica +
B2. Idempotent skip must avoid re-uploading already-present masters (the 945
PB-P001 masters are already in B2).

**Constraints**: No fallbacks / fail loud (CLAUDE.md). No `any` / `as` /
`@ts-ignore`. `@/` imports. Composition over inheritance; interface-first DI.
Files 300–500 lines max. Secrets never in git; credentials passed to the SDK
in-process (never as argv).

**Scale/Scope**: ~6 Port Breton sources, ~945 masters for PB-P001 alone; the
backend must scale to many thousands of objects.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution (`.specify/memory/constitution.md`) is an unpopulated
template, so the de-facto governance is the CLAUDE.md guidelines. Checked against
those:

- **No fallbacks / fail loud** — PASS. Missing creds/config, auth failure, upload
  failure, checksum mismatch all throw with actionable messages; no mock/fallback
  path (FR-011).
- **Never bypass typing** (no `any`/`as`/`@ts-ignore`) — PASS by design; the
  `ObjectStore` interface and typed config carry all shapes.
- **`@/` imports** — PASS; new modules use the alias like the rest of `src/`.
- **Composition over inheritance / interface-first / DI** — PASS. The backend is
  an injected `ObjectStore` interface; `storeAsset`/`verifyAsset` receive it by
  parameter injection, no class hierarchy.
- **File size 300–500 lines** — PASS; new modules are small and single-purpose
  (`object-store.ts`, `b2-config.ts`, `s3-object-store.ts`).
- **No new image bytes in git** — PASS; masters go to a gitignored cache + B2.

No violations → Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/003-archive-object-store/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (ObjectStore interface + provenance schema)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
src/archive/
├── object-store.ts       # NEW: ObjectStore interface + result types (the contract)
├── s3-object-store.ts    # NEW: @aws-sdk/client-s3 impl against B2 (head/put/get)
├── b2-config.ts          # NEW: parse creds file (tab-safe) + resolve bucket/endpoint/region
├── object-key.ts         # NEW: archive-relative path -> object key (mirrors path)
├── store.ts              # CHANGED: storeAsset/verifyAsset accept an optional ObjectStore
├── provenance.ts         # CHANGED: ProvenanceFields += size + object_store block; serializer/parser
├── location.ts           # CHANGED: resolveArchiveRoot honors an override (env/param) for the worktree
├── checksum.ts           # unchanged
└── source-registry.ts    # unchanged

src/fetch/issue.ts        # CHANGED: build + pass the ObjectStore into storeAsset; record size
src/ocr/run.ts            # UNCHANGED read path (reads local cache); provenance passthrough
src/cli/fetch-shared.ts   # CHANGED: --verify pulls from B2; wire backend + --archive-root/env
src/cli/fetch*.ts         # CHANGED: surface backend enable + archive-root override flags

tests/
├── unit/archive/         # ObjectStore fake, b2-config parsing (tab gotcha), object-key, provenance
└── integration/          # opt-in real B2 round-trip (gated on creds)
```

**Structure Decision**: Single project. The backend is added as small, injected
modules under `src/archive/` behind an `ObjectStore` interface; existing call
sites (`src/fetch/issue.ts`, `src/cli/fetch-shared.ts`) receive the backend via
parameter injection. No new top-level package.

## Key design decisions (see research.md for rationale)

1. **`ObjectStore` interface** with `head(key) → {exists, sha256?, size?}`,
   `put(key, bytes, {sha256}) → void`, `get(key) → Uint8Array`. Injected into
   `storeAsset`/`verifyAsset`. A fake implements it for unit tests.
2. **Skip via B2 head + recorded sha256** (FR-006): on put, store the sha256 as
   object metadata; skip when head returns a matching sha256. B2 is the authority.
3. **Local cache = archive tree, images gitignored** (FR-013 / go-forward-only):
   the archive worktree's `.gitignore` newly ignores image masters, so new masters
   sit on disk (cache) but are never tracked; already-tracked masters are untouched.
4. **Provenance += `size` + nested `object_store` block** (FR-004): serializer and
   round-trip parser gain minimal fixed-order nested-map support.
5. **Overridable `archiveRoot`** (FR-014): `resolveArchiveRoot` honors an explicit
   override (env `COLONY_ARCHIVE_ROOT` and/or a `--archive-root` CLI flag) so
   dev/test targets the dedicated worktree, not the fixed sibling clone.
6. **Config + creds** (FR-009/010): non-secret bucket/endpoint/region from env
   (with the known defaults documented, not committed); credentials parsed from
   `~/.config/backblaze/b2-credentials.txt` (tab-after-colon safe) and handed to
   the SDK in-process, never argv.

## Complexity Tracking

No constitution violations — no entries.
