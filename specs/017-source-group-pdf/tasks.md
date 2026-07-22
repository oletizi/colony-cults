# Tasks: Source-Group Facsimile PDF (Papers Past NZ press)

**Feature**: `specs/017-source-group-pdf` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Extend the shipped archive-direct build (spec 014) + english-only recto (spec 015)
to render source-group members (PB-P060 / PB-P061–P092) as facsimile PDFs — both
per-member and one combined group edition. Tier tags (`[tier:fast]`→haiku,
`[tier:balanced]`→sonnet, `[tier:powerful]`→opus) size each task's dispatch model.
No task needs `powerful` — additive over an existing pattern; logic tasks are
`balanced`, tests/investigation `fast`.

Files touched: NEW `src/archive/issue-text-materialize.ts`, NEW
`src/pdf/render/group-edition.ts`; edits to `src/pdf/render/batch.ts`
(member-layout registration + discovery), `src/pdf/render/build.ts`
(segment-stacking verso member render), `scripts/build-pdf.ts` (source-group
selector detection); `pdf/template/` (segment-stacking verso layout, via
`/frontend-design`); fixture helpers + tests under `tests/unit/pdf`,
`tests/integration/pdf`. Reader (`src/pdf/load/archive-source.ts`) unchanged.

## Phase 1: Setup / Investigation

- [x] T001 [tier:fast] Confirm the real member shape against the pinned archive clone + bibliography: a member's `ocr-text` asset (role/objectStoreKey/sha256/sourceRepresentation), its page-image segment `sequence` ordering, and the object-store reader used to fetch asset text. Verify the derived archive slug matches the on-disk dir for PB-P061. Record findings inline in `specs/017-source-group-pdf/research.md`.

## Phase 2: Foundational (blocking — shared by all stories)

- [x] T002 [tier:balanced] Wire `ensureMemberLayoutRegistered` (`@/archive/member-layout`) into `src/pdf/render/batch.ts`: call it in `buildSource` before `resolveArchiveSource`, and in `discoverBuildableSourceIds` for every bibliography source before the `hasArchiveDir` filter, so members resolve and are `--all`-discoverable. Keep the file ≤500 lines.
- [x] T002b [tier:balanced] **(discovered during execution — plan gap)** A source-group member is filed FLAT on disk (verified: `f001..fNNN.yml` directly in `cases/<case>/newspapers/<slug>/`, no dated issue subdirs), but `deriveSourceLayout` mirrored `Source.kind` and emitted `kind: 'periodical'`, routing the PDF reader's `resolveArchiveSource` to `resolvePeriodical` (dated-issue enumeration) → "no issue directories found", never reaching the flat folios + materialized `issue.txt`. Fix `deriveSourceLayout` (`@/archive/location`) so a MEMBER (`source.partOf !== undefined`) derives `kind: 'monograph'` (flat resolution via `monographDir`) while keeping `type: 'newspapers'` (dir naming) — realizing the plan's stated "monograph-shaped like PB-P057, reader unchanged" intent. Update `src/archive/location.test.ts`. This also correctly aligns `resolveFetchedDir`/`bib-sourcegroup-acquire`/companion resolution with the actual flat on-disk shape (a latent bug that had not bitten ocr/translate because members were acquired flat + OCR'd into a detached asset).
- [x] T003 [tier:fast] Extend the pdf fixture helpers (e.g. `tests/integration/pdf/*fixture*` / `tests/unit/pdf/archive-fixture.ts`) to emit: (a) a source-group MEMBER fixture — flat page-image segment folios (N segments, `ocr_status: none`), a detached `ocr-text` asset, NO inline `issue.txt`; and (b) a source-group fixture with ≥2 members carrying distinct article dates. Reuse `writeFixtureArchive`, the fake Typst runner, and the fixture fetch.

## Phase 3: User Story 1 — Build a facsimile PDF for one member (Priority: P1)

**Goal**: A source-group member (flat segments + detached ocr-text) builds one english-only facsimile PDF (stacked-segment verso │ English OCR recto).

**Independent test**: Build the member fixture → one PDF; verso = stacked segments in order, recto = English OCR, honest OCR colophon; no "no archive layout registered" error.

- [x] T004 [tier:fast] [US1] Unit tests (test-first) for a new `materializeIssueText` in `tests/unit/pdf/issue-text-materialize.test.ts`: from an `ocr-text` fixture it writes `issue.txt` + `issue.txt.yml` (provenance: object-store key, sha256, `source_representation`); it is idempotent (identical re-write = no-op); a conflicting existing `issue.txt` throws; a missing/ambiguous ocr-text asset throws; a checksum mismatch throws; it is a NO-OP when an inline `issue.txt` already exists (FR-004/FR-005/FR-012).
- [x] T005 [tier:balanced] [US1] Implement `src/archive/issue-text-materialize.ts`: `materializeIssueText(member, archiveRoot, objectStoreReader)` — resolve the single `role: ocr-text` asset, fetch bytes, verify sha256, write `issue.txt` + `issue.txt.yml` provenance into the member's archive dir; idempotent; skip when inline `issue.txt` exists; fail loud (id-naming) on the T004 error cases. Keep < 300 lines.
- [x] T006 [tier:balanced] [US1] **Design the segment-stacking verso layout via `/frontend-design`** (Principle XI — layout work MUST go through the design skill) BEFORE editing the Typst template: N segments stacked vertically as one reconstructed clipping on the verso, facing the english-only recto. Capture the direction in `specs/017-source-group-pdf/research.md`, then implement it in `pdf/template/` (the sole template change).
- [x] T007 [tier:fast] [US1] Unit test in `tests/unit/pdf/…`: a member assembles to a single item whose verso stacks its N page-image segments in ascending `sequence`, faces the English OCR recto, and carries the honest OCR-transcription colophon (no MT claim). The `ocr-text` asset (sequence 0) is excluded from the image stack.
- [x] T008 [tier:balanced] [US1] Implement the member render in `src/pdf/render/build.ts` (and/or the member path): compose the stacked-segment verso (per T006 template) + english-only recto (reuse the `--no-french` variant + FR-013 colophon), with `materializeIssueText` (T005) invoked before the reader consumes `issue.txt`. Extract a helper if the file nears 500 lines.
- [x] T009 [tier:balanced] [US1] Integration test in `tests/integration/pdf/…`: build the member fixture end-to-end (fake Typst runner + fixture fetch) → exactly one PDF; assert Typst received the stacked segments (ascending) and the English recto text; assert `issue.txt` was materialized with provenance.

## Phase 4: User Story 2 — Build the combined PB-P060 group edition (Priority: P1)

**Goal**: A source-group selector yields one PDF with every member as a date-ordered section + one edition-level colophon.

**Independent test**: Build the ≥2-member group fixture → one PDF; sections in ascending article-date order; one edition-level colophon + pinned archive ref.

- [x] T010 [tier:fast] [US2] Unit tests (test-first) in `tests/unit/pdf/group-edition.test.ts`: members ordered chronologically by article date (ties by member id); an empty group throws (fail loud); a source-group is never fetched as an archival object (FR-008/FR-009/FR-010).
- [x] T011 [tier:balanced] [US2] Implement `src/pdf/render/group-edition.ts`: `buildGroupEdition(groupId, opts)` — enumerate members via `partOf`, order chronologically, render each as a section reusing the member render (Phase 3), emit ONE PDF with an edition-level colophon + pinned archive ref. Keep < 500 lines.
- [x] T011b [tier:balanced] [US2] **(discovered during execution — plan gap / analyze finding I1)** A member's ARTICLE (publication) date — used for chronological group ordering (FR-009/SC-002) and the facsimile title-page date — was resolved from the folio provenance `retrieved` field, which is the ACQUISITION timestamp (real PB-P061: `2026-07-18`), not the 1884 article date. The real corpus carries no clean machine-readable date field; the date lives in the Papers Past identifier (`HNS18840103.2.19.3` → `1884-01-03`). Fixed `resolveMemberDate`/member-edition to derive the article date from the Papers Past identifier (parse+validate `YYYYMMDD`, fail loud if absent — no `retrieved` fallback), and reverted the fixture's `retrieved`=articleDate masking hack (+ removed a wall-clock non-determinism), giving synthetic members an identifier that encodes their date. Backlog: add a first-class publication-date field to the bibliography model (cleaner long-term source) — see [[pdf-titlepage-imprint-date]].
- [x] T012 [tier:balanced] [US2] Add source-group selector detection to `scripts/build-pdf.ts`: when the selector resolves to `kind: source-group`, route to `buildGroupEdition`; otherwise the existing member/source/`--all` paths. Update the CLI usage note.
- [x] T013 [tier:balanced] [US2] Integration test: build the group fixture end-to-end → one PDF containing each member as a date-ordered section; assert order and single edition-level colophon.

## Phase 5: User Story 3 — Existing builds unchanged (Priority: P1)

**Goal**: Pre-existing sources build byte-identically; no archive dir is mutated for a source that already has `issue.txt`.

**Independent test**: Build an unchanged non-member fixture → identical output; a French missing-translation still fails loud.

- [x] T014 [tier:fast] [US3] Regression tests: (a) an English monograph fixture (PB-P057 shape, inline `issue.txt`) builds unchanged and `materializeIssueText` is NOT invoked / does not alter its dir (FR-005); (b) a French source with a genuinely missing translation still fails loud (safety net intact); (c) a standalone source's output is unchanged.

## Phase 6: User Story 4 — Batch discovery + attributable failure (Priority: P2)

**Goal**: `--all` discovers buildable members; a broken member is an attributable failure that does not abort siblings.

**Independent test**: Batch over a fixture with members + one broken member → healthy build, broken listed by id, non-zero exit.

- [x] T015 [tier:fast] [US4] Integration test on `buildAll`: buildable members are discovered (via the T002 registration) and built; one member with an unresolvable required input is recorded as `FAIL <id>: <reason>`, siblings still build, and the summary reports "built N, failed M" with a non-zero exit when M > 0 (FR-013, G-4).

## Phase 7: Polish & Cross-Cutting

- [x] T016 [tier:fast] Fail-loud coverage sweep (FR-012): assert id-naming errors for a missing ocr-text asset, a missing/unresolvable page-image segment (B2 object absent), and an empty group — no PDF with fabricated/blank reading content is produced.
- [x] T017 [tier:fast] Principle VII check: new modules (`issue-text-materialize.ts`, `group-edition.ts`) stay within 300–500 lines; no `any`/`as`/`@ts-ignore`; `npx tsc --noEmit` clean; `npx vitest run tests/unit/pdf tests/integration/pdf` green.
- [~] T018 [tier:balanced] Operator acceptance: build PB-P061 (member) and PB-P060 (group edition) end-to-end against the real `edition-publishing-archive` + B2 (`COLONY_ARCHIVE_ROOT`, `set -a; source .env; set +a`); confirm the stacked-segment verso, English OCR recto, honest OCR-transcription colophon, and pinned-archive reference; serve on the tailnet for inspection. Operator-verified; excluded from the tasks-complete gate.

## Dependencies

- Setup (T001) → Foundational (T002–T003) → user-story phases.
- **T002** (member-layout registration) blocks every build task (US1/US2/US4).
- **T003** (fixtures) blocks all test tasks.
- US1 (T004–T009) is the reusable member render; **US2 (T010–T013) depends on the member render** (the group edition iterates it).
- US3 (T014) and US4 (T015) depend only on Foundational + the member/discovery wiring.
- Polish (T016–T018) last; T018 needs a real archive + B2.
- Within US1: T004→T005 (test→impl materializer); T006→T008 (design→impl verso); T007 before/with T008; T009 after T005+T008.

## Parallel Opportunities

- T004 [P] and T010 [P] (unit tests for independent modules) can be written in parallel.
- T005 (materializer) [P] and T006 (verso design) [P] touch different files — parallelizable after T003.
- US3 (T014) and US4 (T015) [P] are independent once Foundational is done.

## Implementation Strategy

- **MVP = User Story 1** (Phase 1–3): a single member (PB-P061) builds to a real facsimile PDF — proves member-layout registration, issue.txt materialization, and the stacked-segment verso end-to-end.
- Then US2 (the combined PB-P060 edition — the headline deliverable), then US3 (no-regression) and US4 (batch), then Polish + operator acceptance.
