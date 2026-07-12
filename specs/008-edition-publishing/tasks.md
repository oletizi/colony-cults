---
description: "Task list for Edition Publishing (spec 008)"
---

# Tasks: Edition Publishing

**Input**: Design documents from `specs/008-edition-publishing/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Included — this project develops test-first (spec 007 precedent) and the quickstart's
verification checklist requires unit proof of SC-003/004/005/006 via `FakeObjectStore`.

**Organization**: grouped by user story (spec.md priorities). Each task carries a `[tier:…]`
tag for `/stack-control:execute` model-sized dispatch (`fast` = mechanical, `balanced` =
standard implementation, `powerful` = careful design/orchestration).

## Format: `[ID] [P?] [Story] [tier:…] Description`

- **[P]**: parallelizable (different files, no dependency on an incomplete task)
- **[Story]**: US1–US4 (user-story phases only)
- All paths are repo-relative and exact.

## Path Conventions

Single TypeScript project: `src/`, `scripts/`, `tests/` at repo root; `@/*` → `src/*`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: verb wiring + directory skeleton.

- [x] T001 [tier:fast] Add `"pdf:publish": "tsx scripts/publish-pdf.ts"` and `"publish:test": "vitest run tests/unit/publish tests/integration/publish"` scripts to `package.json`
- [x] T002 [P] [tier:fast] Create the directory skeleton: `src/pdf/publish/`, `tests/unit/publish/`, `tests/integration/publish/` (add `.gitkeep` where empty)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: model + SSOT + vocab + key/version primitives every story depends on.

**⚠️ CRITICAL**: no user-story work begins until this phase is complete.

- [x] T003 [tier:powerful] Define the publication view-model types in `src/model/publication.ts` exactly per `data-model.md`: `SourceRights`, `SourceRightsStatus`, `Publication`, `PublicationManifestRef`, `PublicationManifest`, `PublishedArtifactRef`; reuse `MachineAssistLabel` from `@/pdf/model`; `@/` imports, no `any`/`as`/`@ts-ignore`
- [x] T004 [tier:balanced] Extend `src/model/source.ts` `Source` with additive OPTIONAL `rights?: SourceRights` and `publications?: Publication[]`; re-export the new types from `src/model/index.ts` (existing SSOT files stay valid)
- [x] T005 [P] [tier:balanced] Add the `SourceRightsStatus` controlled vocabulary (`public-domain`; affirmative-distributable set) to `src/bibliography/vocab.ts` following the existing `*_VALUES` + `validateVocab`/`isAllowed` pattern
- [x] T006 [tier:powerful] Extend `src/bibliography/load.ts`: add `'rights'` and `'publications'` to the closed `SOURCE_KEYS` allow-list and parse+validate them (mirror the `repositoryRecords` parse path ~load.ts:200-223) — `rights.status` against the T005 vocab; each `publications[]` element per `contracts/ssot-publications.md`; return them on `LoadedSource`
- [x] T007 [tier:balanced] Extend `serializeSource` in `src/bibliography/migrate-serialize.ts` to emit `rights` and `publications[]` in a fixed key order (mirror `orderedRecord`), omitting absent optionals so re-serialize is byte-identical
- [x] T008 [P] [tier:balanced] Add a small single-source writer `src/bibliography/source-writer.ts` (`writeSourceFile(dir, migrated)` → `writeFileSync(sources/<id>.yml, serializeSource(...))`) since no standalone single-source write helper is exported today (per `migrate.ts:454`)
- [x] T009 [P] [tier:balanced] Implement `src/pdf/publish/version.ts`: derive `snapshotShort` (git-conventional short) from the full pin ref via `resolveArchiveRef()`/`makeArchivePinReader` (`@/pdf/config`); fail loud on an empty/missing pin (not reproducible without it)
- [x] T010 [P] [tier:balanced] Implement `src/pdf/publish/key.ts`: versioned key builder `editions/<variant>/<sourceId>/<issueId>__<snapshotShort>.pdf`, legacy-flat builder `editions/english-only/<sourceId>/<issueId>.pdf`, and `cdnUrl(cdnBase, key)` = `${cdnBase}/${key}` (require `CORPUS_CDN_BASE`, fail loud if unset)
- [x] T011 [P] [tier:balanced] Extend `src/bibliography/validate-checks.ts` (+ wire into `validate.ts`): `(variant, snapshotShort)` uniqueness within `publications[]`, referenced manifest file exists, and `rightsBasis` present on every publication entry

**Checkpoint**: model, SSOT read/write, vocab, and key/version primitives ready.

---

## Phase 3: User Story 1 — Publish a source's editions and record them (Priority: P1) 🎯 MVP

**Goal**: `pdf:publish <sourceId> --variant <v> --confirm` uploads each built PDF to its
immutable versioned key and records the publication (entry + manifest) in the SSOT.

**Independent Test**: publish one source's built edition; every issue PDF is retrievable at its
recorded CDN URL, its bytes match the recorded sha256, and the source's metadata carries the
publication entry naming variant, URLs, and the pinned snapshot (SC-001/SC-002).

### Tests for User Story 1 ⚠️ (write first, ensure they FAIL)

- [x] T012 [P] [US1] [tier:balanced] Unit test `tests/unit/publish/upload.test.ts`: idempotent uploader over `FakeObjectStore` — uploads a new key (`put` called), skips when `head(key).sha256` matches (no `put`), and throws on a versioned key present with a DIFFERENT sha256 (G-3/G-4, never overwrite)
- [x] T013 [P] [US1] [tier:fast] Unit test `tests/unit/publish/key.test.ts`: versioned/legacy key + `cdnUrl` derivation and the `url === cdnBase + '/' + key` invariant (G-3)
- [x] T014 [P] [US1] [tier:balanced] Unit test `tests/unit/publish/record.test.ts`: build a `Publication` + `PublicationManifest` from upload results and round-trip through `serializeSource`/`loadSourceFile` + manifest write/read; assert deterministic (byte-identical) re-serialization (G-5)
- [x] T015 [P] [US1] [tier:balanced] Integration test `tests/integration/publish/publish.test.ts`: end-to-end whole-source publish against a temp `build/pdf/<src>/` fixture + `FakeObjectStore` + temp SSOT dir → asserts uploads, `publications[]` entry, manifest file, and the printed report (SC-001)

### Implementation for User Story 1

- [x] T016 [P] [US1] [tier:balanced] Implement `src/pdf/publish/resolve.ts`: resolve source + `--variant` + built-PDF dir (`build/pdf/<sourceId>/`), enumerate issue ids (reuse `@/pdf/render/batch` `enumerateItemIds`/`listSnapshotSourceIds`), and fail loud (attributably) on a missing built PDF for an enumerated issue (FR-011)
- [x] T017 [US1] [tier:powerful] Implement `src/pdf/publish/upload.ts`: idempotent uploader over an injected `ObjectStore` — `sha256OfFile` (`@/archive/checksum`) → `head(key)` → skip on match / `put(key, bytes, {sha256, contentType:'application/pdf'})` on absent / throw on versioned-key sha mismatch (G-4)
- [x] T018 [US1] [tier:powerful] Implement `src/pdf/publish/record.ts`: assemble the `Publication` entry (variant, publishedAt via injected clock, snapshot+snapshotShort, cdnBase, keyScheme, rightsBasis, and a REQUIRED `machineAssist` label for any translation-carrying variant — both in-scope variants qualify, Constitution IV) + the `PublicationManifest` (per-issue url/key/sha256/pages, where `pages` is read from the build's `<issueId>.input.json`, not by parsing PDF bytes), write the manifest under `bibliography/publications/` and upsert the entry via `source-writer.ts` (idempotent — no duplicate for an existing `(variant,snapshotShort)`)
- [x] T019 [P] [US1] [tier:balanced] Implement `src/pdf/publish/warm.ts`: best-effort CDN warm — anonymous GET each new URL (reuse the `defaultHttpGet` pattern from `@/archive/public-cache`); a `403`/any failure is surfaced but NON-fatal (FR-015, G-9)
- [x] T020 [US1] [tier:powerful] Implement `src/pdf/publish/publish.ts` orchestration: dry-run (no `--confirm`, plan+print only) vs confirmed publish; record-and-continue over issues; `published N, failed M, skipped K` summary; print canonical CDN URLs (FR-010, G-7/G-10); commit the SSOT + manifest changes (FR-008, G-6)
- [x] T021 [US1] [tier:balanced] Implement `scripts/publish-pdf.ts` verb: `parseArgs` (positional `<sourceId>`, `--variant`, `--confirm`, `--out`, `--no-warm`; fail loud on unknown flag), eager preflight (`resolveObjectStoreConfig()` + `S3ObjectStore`, assert `CORPUS_CDN_BASE`, assert pin), delegate to `publish.ts`, `main().catch` non-zero exit — mirroring `scripts/build-pdf.ts` + `scripts/export-public.ts`

**Checkpoint**: a source's built edition publishes end-to-end and is recorded (needs US2's gate wired for a real run — see Dependencies).

---

## Phase 4: User Story 2 — Rights-gated, fail-closed publishing (Priority: P2)

**Goal**: publishing refuses unless the Source carries an affirmative distributable-rights
determination, and says exactly why; nothing is uploaded or recorded on refusal.

**Independent Test**: attempt to publish a source whose rights are "likely"/absent/
non-distributable → refused with a message naming the gap; `FakeObjectStore` shows zero `put`
and the SSOT is unchanged (SC-003).

### Tests for User Story 2 ⚠️

- [x] T022 [P] [US2] [tier:balanced] Unit test `tests/unit/publish/rights-gate.test.ts`: absent `rights` → refuse; `status` not affirmative-distributable → refuse; affirmative `public-domain` → pass and yield the `rightsBasis`; refusal path asserts ZERO `put` on `FakeObjectStore` and an unchanged temp SSOT (SC-003, G-2)

### Implementation for User Story 2

- [x] T023 [US2] [tier:powerful] Implement `src/pdf/publish/rights-gate.ts`: `assertPublishable(source)` — throws a descriptive refusal naming the source + the missing/insufficient determination unless `source.rights.status` is affirmative-distributable; returns the `rightsBasis` on pass (reuse the `'public-domain'` value + fail-closed shape of `@/rights/gate`, but source-level, no `OaiRecordClient`)
- [x] T024 [US2] [tier:balanced] Wire the gate into `src/pdf/publish/publish.ts` as the FIRST step (before any upload/record), on both the dry-run and confirmed paths (design pipeline step 2)
- [x] T025 [US2] [tier:balanced] Upgrade PB-P001's rights to an affirmative determination in `bibliography/sources/PB-P001.yml`: add `rights: { status: public-domain, basis: "…", determinedAt: … }` and remove/keep the free-text "Public domain: likely" note as prose only (the gate does not consult notes); validate the file loads

**Checkpoint**: publishing is fail-closed; US1 + US2 together are the true runnable MVP.

---

## Phase 5: User Story 3 — Idempotent, immutable re-publishing (Priority: P3)

**Goal**: an unchanged edition re-publishes as a no-op; a changed rebuild publishes as a NEW
immutable version without breaking prior citable URLs.

**Independent Test**: publish; re-run with no rebuild → zero uploads + no metadata change;
rebuild changed + re-publish → new versioned artifact + new record, prior URL still resolves
(SC-004/SC-005).

### Tests for User Story 3 ⚠️

- [x] T026 [P] [US3] [tier:balanced] Unit test `tests/unit/publish/idempotent.test.ts`: unchanged whole re-run → `put` count 0 (counting `FakeObjectStore`) AND byte-identical SSOT + manifest (SC-004)
- [x] T027 [P] [US3] [tier:balanced] Unit test `tests/unit/publish/immutable.test.ts`: a changed rebuild (new `snapshotShort`) adds a NEW `publications[]` entry + new manifest while the prior version's key bytes are untouched and its entry unchanged (SC-005, FR-009)

### Implementation for User Story 3

- [x] T028 [US3] [tier:balanced] Harden `src/pdf/publish/record.ts` upsert: idempotent for an existing `(variant, snapshotShort)` (no duplicate, no churn) and additive for a new `snapshotShort` (new entry, prior entries untouched); ensure manifest re-emit is byte-identical on an unchanged re-run
- [x] T029 [US3] [tier:balanced] Confirm/adjust `src/pdf/publish/upload.ts` immutability guard (versioned key present with a different sha256 → fail loud) and that an unchanged run performs zero `put` end-to-end via the orchestration (FR-004/FR-009)

**Checkpoint**: re-publish is safe and citation-stable.

---

## Phase 6: User Story 4 — Reconcile already-published editions into the SSOT (Priority: P3)

**Goal**: record the 72 hand-published PB-P001 english-only PDFs at their existing un-versioned
URLs (back-fill only, no re-upload).

**Independent Test**: run reconcile over the 72; the source's metadata records the published
edition (per-issue legacy-flat URLs + checksums) consistent with the served artifacts (SC-006).

### Tests for User Story 4 ⚠️

- [x] T030 [P] [US4] [tier:balanced] Unit test `tests/unit/publish/reconcile.test.ts`: reconcile records legacy-flat keys/URLs with `keyScheme: legacy-flat` and a `…-legacy.yml` manifest, performs ZERO `put` (back-fill only), and the recorded url/sha256 match seeded served bytes (SC-006, G-8)

### Implementation for User Story 4

- [x] T031 [US4] [tier:powerful] Implement reconcile mode in `src/pdf/publish/publish.ts` (`--reconcile`): for each already-served issue, fetch its bytes via the injected HTTP GET at the legacy-flat CDN URL, compute sha256 + page count, and record (no upload); mark the entry `keyScheme: legacy-flat`; fail loud attributably on an issue missing from the store
- [x] T032 [US4] [tier:fast] Add `--reconcile` to `scripts/publish-pdf.ts` `parseArgs` (requires `--confirm` to write) and route to the reconcile path

**Checkpoint**: the already-published 72 are under the record; versioned + legacy-flat coexist.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T033 [P] [tier:fast] Add a `pdf:publish` section to `README.md` (usage, flags, env, the versioned-vs-legacy URL schemes)
- [x] T034 [tier:balanced] Run `npm run typecheck` and `npm run publish:test` (+ full `npm test`) green; fix any fallout
- [~] T035 [tier:powerful] [operator live-prod acceptance] Execute `quickstart.md` Scenarios 1–6 against a real build of PB-P001 english-only (behind `--confirm`) and confirm a recorded URL's fetched bytes sha256-match its manifest entry (SC-002 end-to-end); record the outcome. Marked `[~]` (excluded from the tasks-complete gate): it writes real artifacts to the production public B2 bucket + CDN and requires live B2 credentials + a real Typst build — an operator acceptance run AFTER the cross-model govern audit (audit-before-acceptance), not an in-session agent step.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)** → no deps.
- **Foundational (P2)** → after Setup; **blocks all user stories**.
- **US1 (P1)** → after Foundational.
- **US2 (P2)** → after Foundational. **US1's real end-to-end publish path integrates US2's gate
  (T024 wires it into T020)** — so the true runnable MVP is **US1 + US2 together** (Constitution
  IV makes the fail-closed gate non-optional for any real publish). US2's refusal guarantee is
  still independently testable (T022) without US1's upload path.
- **US3 (P3)** → after US1 (hardens US1's upload/record for idempotency/immutability).
- **US4 (P3)** → after Foundational + US1's `publish.ts` orchestration (adds a reconcile branch);
  independent of US2/US3.
- **Polish (P7)** → after the desired stories.

### Within each story

- Tests first (write, ensure FAIL), then implementation (models → key/version → upload/record →
  orchestration → verb wiring).

### Parallel opportunities

- Setup: T002 ∥ (after T001).
- Foundational: T005, T008, T009, T010, T011 are `[P]` (distinct files) once T003/T004 land.
- US1 tests T012–T015 all `[P]`; impl T016 and T019 `[P]`; T017/T018/T020/T021 chain.
- US3 tests T026 ∥ T027; US4 test T030 `[P]`.

---

## Parallel Example: User Story 1 tests

```bash
Task: "Unit test upload idempotency in tests/unit/publish/upload.test.ts"
Task: "Unit test key/url derivation in tests/unit/publish/key.test.ts"
Task: "Unit test record round-trip in tests/unit/publish/record.test.ts"
Task: "Integration test end-to-end publish in tests/integration/publish/publish.test.ts"
```

---

## Implementation Strategy

### MVP (User Stories 1 + 2)

1. Phase 1 Setup → Phase 2 Foundational.
2. Phase 3 US1 (publish + record) **and** Phase 4 US2 (fail-closed rights gate) — delivered
   together, since a real publish must not distribute un-cleared material (Constitution IV).
3. **STOP & VALIDATE**: publish PB-P001 english-only; confirm records + integrity; confirm an
   un-rights'd source is refused with zero side effects.

### Incremental delivery

- + US3 → idempotent/immutable re-publish (test independently).
- + US4 → reconcile the already-published 72 (test independently).
- Each story adds value without breaking prior stories.

---

## Notes

- `[P]` = different files, no incomplete-task dependency.
- `[tier:…]` drives `/stack-control:execute` model-sized dispatch.
- Fail-loud, no fallbacks/mock outside `tests/` (Constitution V); `@/` imports; no `any`/`as`/
  `@ts-ignore` (VII); modules ≤ 300–500 lines (VII); inject `ObjectStore`/HTTP-GET/clock (VI).
- Commit after each task or logical group; verify tests fail before implementing.
