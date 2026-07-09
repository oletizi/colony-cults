---
description: "Task list for Archive Object Store (Backblaze B2)"
---

# Tasks: Archive Object Store (Backblaze B2)

**Input**: Design documents from `specs/003-archive-object-store/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/object-store.md, quickstart.md

**Tests**: INCLUDED — the project has an established `vitest` suite and the contract
defines a fake `ObjectStore` for unit testing; unit tests are written before the
code they cover. Live-B2 integration tests are opt-in (gated on credentials).

**Organization**: Tasks are grouped by user story (US1–US4 from spec.md) so each
story is independently implementable and testable.

## Format: `[ID] [P?] [Story] [tier:label] Description with file path`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US4; setup/foundational/polish carry no story label
- **[tier:label]**: model tier for dispatch — `fast`=haiku (mechanical), `balanced`=sonnet (standard impl/tests), `powerful`=opus (safety-critical correctness). Resolved via `.stack-control/config.yaml` `tier_map`.
- Exact file paths are in each description

## Path Conventions

Single project: `src/` and `tests/` at the tool repo root
(`colony-cults-work/archive-object-store`). The archive repo is a **separate**
git worktree of `colony-cults-archive` (never the shared clone) — see T002.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies and the isolated archive worktree the whole feature is tested against.

- [ ] T001 [tier:fast] Add `@aws-sdk/client-s3` to `package.json` dependencies and install (`npm install`); confirm `npm run typecheck` still passes.
- [ ] T002 [tier:fast] Create the isolated archive worktree per quickstart.md step 1: `git -C ../colony-cults-archive worktree add ../colony-cults-archive-object-store -b wt/object-store`, and append the image-master ignores (`archive/cases/**/*.jpg|jpeg|png`) to that worktree's `.gitignore`. Never touch the shared clone (FR-014).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared modules every user story depends on — the ObjectStore contract, config/creds, object-key, provenance extension, archiveRoot override, and the S3 backend.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T003 [P] [tier:balanced] Define the `ObjectStore` interface + `ObjectHead`/`PutOptions` result types in `src/archive/object-store.ts` per contracts/object-store.md.
- [ ] T004 [P] [tier:balanced] Implement `objectKeyForAsset(archiveRoot, targetPath)` (POSIX archive-relative key, no leading slash) in `src/archive/object-key.ts`.
- [ ] T005 [P] [tier:balanced] Unit test object-key mirroring (nested path → key, cross-OS separators) in `tests/unit/archive/object-key.test.ts`.
- [ ] T006 [P] [tier:balanced] Implement `src/archive/b2-config.ts`: parse `~/.config/backblaze/b2-credentials.txt` (strip leading whitespace **including tabs**; map `keyID`→accessKeyId, `applicationKey`→secretAccessKey) and resolve bucket/endpoint/region from `COLONY_S3_*` env; fail loud on any missing required value (FR-009/010/011).
- [ ] T007 [P] [tier:balanced] Unit test b2-config: the tab-after-colon `applicationKey` parses correctly, and missing creds/config throws a clear error, in `tests/unit/archive/b2-config.test.ts`.
- [ ] T008 [tier:powerful] Extend `ProvenanceFields` with `size` (integer) and a nullable nested `object_store` block `{provider,bucket,key,endpoint}`; extend the deterministic serializer + round-trip parser (fixed sub-key order) in `src/archive/provenance.ts` per data-model.md. Re-serialization MUST stay byte-identical.
- [ ] T009 [P] [tier:balanced] Unit test provenance round-trip: `size` + `object_store` serialize/parse byte-identically, and `object_store: null` round-trips, in `tests/unit/archive/provenance-object-store.test.ts`.
- [ ] T010 [tier:balanced] Add an overridable archive root: `resolveArchiveRoot` honors an explicit override (`--archive-root` value / `COLONY_ARCHIVE_ROOT`), falling back to the fixed `../colony-cults-archive` sibling only when neither is set, in `src/archive/location.ts` (FR-014).
- [ ] T011 [P] [tier:fast] Create an in-memory fake `ObjectStore` (`Map<string,{bytes,sha256}>`) for unit tests in `tests/unit/archive/fake-object-store.ts` per contracts/object-store.md.
- [ ] T012 [tier:powerful] Implement `S3ObjectStore` (head/put/get, sha256 stored as `x-amz-meta-sha256`, upload-before-record semantics) against B2 using `@aws-sdk/client-s3`, constructed from b2-config, in `src/archive/s3-object-store.ts`. Fail loud on transport/auth errors; `head` returns `{exists:false}` (no throw) for an absent key.

**Checkpoint**: Contract, config, provenance schema, archiveRoot override, and the S3 backend exist and are unit-tested (fake) — user stories can begin.

---

## Phase 3: User Story 1 - Image masters land in object storage, not git (Priority: P1) 🎯 MVP

**Goal**: On capture, masters upload to B2 + a local gitignored cache; provenance records object_store + sha256 + size; no image bytes enter git.

**Independent Test**: Fetch one issue against the worktree; `git status` shows no image bytes to stage, B2 holds each master at its mirrored key, each `f###.yml` records the object_store block + size.

- [ ] T013 [P] [US1] [tier:balanced] Unit test (fake ObjectStore): `storeAsset` uploads bytes via `put(key,bytes,{sha256})`, records `object_store`+`size` in provenance, updates the manifest, and returns a non-skipped result — in `tests/unit/archive/store-object-store.test.ts`.
- [ ] T014 [US1] [tier:powerful] Extend `storeAsset` in `src/archive/store.ts`: accept an injected `ObjectStore` (via `StoreOptions`/param), compute sha256+size, `put` to the store, then write provenance (with `object_store`) and the manifest — upload strictly before any provenance write (research.md §8). Keep the write-guard first.
- [ ] T015 [US1] [tier:balanced] Wire `src/fetch/issue.ts` to build the `ObjectStore` from b2-config once and pass it (plus the recorded `size`) into `storeAsset`; keep writing the local cache file for OCR.
- [ ] T016 [US1] [tier:balanced] Surface backend wiring + `--archive-root` in the fetch CLI (`src/cli/fetch-issue.ts`, `src/cli/fetch-shared.ts`, `src/cli/fetch-source.ts`): resolve archiveRoot via the override and construct the store from config; fail loud when config/creds are missing.
- [ ] T017 [US1] [tier:balanced] Verify (manual per quickstart step 4 + assertion in an integration-style test) that a capture adds zero `.jpg/.jpeg/.png` to git in the worktree (SC-001), AND that the OCR path still reads the master from the local cache after the write-path change (FR-013).

**Checkpoint**: US1 is a working MVP — captures write to B2 with git tracking only provenance.

---

## Phase 4: User Story 2 - Resumable, idempotent capture (Priority: P2)

**Goal**: Skip already-uploaded masters (B2 head + recorded sha256); `--force` re-uploads; `--verify` re-checks against B2.

**Independent Test**: Re-run a completed capture → zero uploads; corrupt/delete one object → `--verify` flags exactly it; `--force` → re-uploads.

- [ ] T018 [P] [US2] [tier:balanced] Unit test (fake): skip when `head(key).exists && head.sha256===sha256` and not `--force`; re-upload under `--force`; a present-but-different object is surfaced, not skipped — in `tests/unit/archive/store-skip.test.ts`.
- [ ] T019 [US2] [tier:balanced] Implement the B2-head skip path in `storeAsset` (`src/archive/store.ts`): before upload, `head(key)`; skip (return `skipped:true`) on exists+matching sha256 unless `force`.
- [ ] T020 [US2] [tier:balanced] Implement `--verify` against B2: fetch each recorded master by its provenance `object_store.key`, compare sha256 to the recorded value, report mismatch/missing — in `verifyAsset` (`src/archive/store.ts`) and the verify sweep in `src/cli/fetch-shared.ts`.
- [ ] T021 [P] [US2] [tier:balanced] Unit test (fake): `--verify` detects a mismatch and a missing object, and passes clean matches, in `tests/unit/archive/verify-object-store.test.ts`.

**Checkpoint**: US1 + US2 both work — capture is idempotent and verifiable.

---

## Phase 5: User Story 3 - The archive stays verifiable and restorable (Priority: P2)

**Goal**: From git-tracked provenance alone, resolve every master's key, fetch it, and prove sha256 identity; manifest ↔ provenance agree.

**Independent Test**: From a records-only checkout, resolve keys from provenance, fetch from B2, confirm 100% sha256 match for a full issue.

- [ ] T022 [P] [US3] [tier:balanced] Opt-in integration test (gated on creds/`COLONY_S3_IT`): real B2 put→head→get→delete round-trip via `S3ObjectStore`, asserting sha256 metadata + byte identity, in `tests/integration/s3-object-store.test.ts`.
- [ ] T023 [P] [US3] [tier:balanced] Opt-in integration test: given provenance for an issue, resolve `object_store.key` → `get` from B2 → sha256 matches recorded, in `tests/integration/restore-from-provenance.test.ts`.
- [ ] T024 [US3] [tier:balanced] Ensure the verify/audit sweep confirms `MANIFEST.sha256` and per-asset provenance agree for object-store-backed masters (`src/cli/fetch-shared.ts`).

**Checkpoint**: The git+B2 split preserves the archive's integrity guarantee end to end.

---

## Phase 6: User Story 4 - Fetch the straggler issues via the new backend (Priority: P3)

**Goal**: Capture the ~5 sleep-interrupted PB-P001 issues through the backend (masters → B2, provenance → git, no image bytes in git).

**Independent Test**: Capture the stragglers against the worktree; confirm masters in B2, provenance in git, zero image bytes added to git.

- [ ] T025 [US4] [tier:balanced] Identify the ~5 straggler PB-P001 issues (incomplete under the old path) and capture each via the backend against the worktree; validate per quickstart steps 4–5 (SC-006). Record the issue arks handled in the PR description.

**Checkpoint**: All four user stories independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T026 [P] [tier:fast] Update `docs/` and confirm quickstart.md commands match the shipped CLI flags/env names.
- [ ] T027 [tier:balanced] Run the full quickstart.md validation end to end against the worktree.
- [ ] T028 [tier:fast] Record the follow-up to **rotate the B2 application key** (exposed in the design transcript) via `stackctl backlog` — post-migration, not a code task.
- [ ] T029 [tier:fast] Run `npm run typecheck` and `npm test` (unit; integration opt-in) — all green; no `any`/`as`/`@ts-ignore`, `@/` imports only.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately.
- **Foundational (Phase 2)**: depends on Setup — BLOCKS all user stories.
- **US1 (Phase 3)**: depends on Foundational. MVP.
- **US2 (Phase 4)**: depends on Foundational; builds on US1's `storeAsset` changes (same file — sequence T019 after T014).
- **US3 (Phase 5)**: depends on Foundational + a working `S3ObjectStore` (T012); independent of US2 logically but shares the backend.
- **US4 (Phase 6)**: depends on US1 (+US2 skip is convenient) being functional.
- **Polish (Phase 7)**: after the desired stories.

### Within/Across Stories

- Tests are written before the code they cover; verify they fail first.
- `src/archive/store.ts` is touched by T014 (US1) and T019/T020 (US2) — sequence those (not [P] against each other).
- `src/archive/provenance.ts` (T008) blocks anything recording provenance (T014+).
- `object-store.ts` (T003) blocks `s3-object-store.ts` (T012), the fake (T011), and `storeAsset` (T014).

### Parallel Opportunities

- Foundational [P] tasks on distinct files run together: T003, T004, T006, T011 (and their tests T005, T007, T009).
- Within US2, T018 and T021 (distinct test files) are [P].
- US3 integration tests T022/T023 are [P] against each other.

---

## Parallel Example: Foundational

```bash
# Distinct files, no interdependencies — can run together:
Task: "Define ObjectStore interface in src/archive/object-store.ts"        # T003
Task: "Implement object-key derivation in src/archive/object-key.ts"       # T004
Task: "Implement b2-config parsing in src/archive/b2-config.ts"            # T006
Task: "Create fake ObjectStore in tests/unit/archive/fake-object-store.ts" # T011
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup (deps + worktree).
2. Phase 2 Foundational (contract, config, provenance, archiveRoot override, S3 backend).
3. Phase 3 US1 — capture writes masters to B2, git tracks provenance only.
4. **STOP and VALIDATE** against the worktree (quickstart steps 4).

### Incremental Delivery

US1 (MVP) → US2 (resumable/verify) → US3 (restore/verify integrity) → US4
(straggler capture) → Polish. Each story is independently testable and adds value
without breaking the previous ones.

---

## Notes

- [P] = different files, no incomplete-task dependency.
- Do all archive-repo work in the dedicated worktree (T002), never the shared clone.
- The one-time git-history purge (reclaim ~2 GB; subsumes TASK-6) is OUT OF SCOPE —
  blocked on the translation session quiescing.
- Commit after each task or logical group; push promptly.
