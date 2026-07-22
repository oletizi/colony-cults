# Quickstart: Archive-Direct PDF Rendering

**Feature**: `specs/014-archive-direct-pdf`

Runnable validation scenarios proving the archive-direct reader works end to end. Each maps to a
User Story / Success Criterion. Contract: [`contracts/archive-edition-reader.md`](contracts/archive-edition-reader.md);
shapes: [`data-model.md`](data-model.md).

## Prerequisites

- A local archive clone at the pinned ref, `COLONY_ARCHIVE_ROOT` set to it (e.g. the
  `colony-cults-archive-translate` clone / a pinned worktree).
- `CORPUS_CDN_BASE` set (for the `b2` image provider) — or B2 credentials for the object-store
  fetch path.
- The pin sidecar `site/data/archive-source.json` present.
- Source layouts registered/derivable for the target sources (PB-P054/P055/P002).

Fast validation (no network) uses fixture archive dirs + fake image fetch + fake TypstRunner.

## Scenario 1 — Build a non-Gallica source end-to-end (US1 / SC-001, SC-006)

```
npm run pdf:build -- PB-P055 --no-french    # archive.org source, fully translated
```

**Expect**: a facing-page english-only edition PDF for PB-P055; the build reads only the archive
(no snapshot), parses no `archive.org`/Gallica catalog URL, sources every page image from
`object_store` (sha256-verified), and records the pin in the colophon. (`--no-french` →
english-only recto; omit for the parallel FR│EN recto.)

## Scenario 2 — Page-range extract aligns correctly (US2 / SC-002, SC-006)

```
npm run pdf:build -- PB-P054                 # Gallica page-range extract, pages 48-50
```

**Expect**: folios `f048/f049/f050` pair with translations `p001/p002/p003` in order; no
missing-page error; the three-page edition reads correctly.

## Scenario 3 — Untranslatable page renders blank; a gap fails loud (US3 / SC-004)

Fixture A: a source with one folio whose translation artifact is labeled `untranslatable`
(empty). Fixture B: a source with one folio whose `pNNN.en.txt` is absent.

**Expect**: A builds — the marked page renders facsimile + FR OCR with a blank EN column, the
rest intact. B fails loud, naming the page, and produces no PDF.

## Scenario 4 — Missing / corrupt master fails loud (Edge / SC-003)

Fixture: a folio whose `object_store` master is absent (or whose bytes mismatch the recorded
sha256).

**Expect**: the build fails loud naming the page; no IIIF fallback; no partial PDF.

## Scenario 5 — Reproducibility pin recorded (US4 / SC-005)

```
npm run pdf:build -- PB-P055 --no-french
```

**Expect**: the colophon records `archiveRef` = the pin's `.ref`; rebuilding from the same
archive commit yields identical edition content. (If the archive-clone-at-pin assertion is
implemented, a clone not at the pin fails loud.)

## Verification checklist (verification-before-completion)

- [ ] `npm run typecheck` clean; `npm test` green (new `tests/unit/pdf/archive-*` + integration).
- [ ] SC-002 proven: a fixture extract (folios `f048–f050` ↔ `p001–p003`) aligns (positional map).
- [ ] SC-003 proven: `FakeObjectStore`/fake-fetch asserts sha256 verification + fail-loud on
      missing/mismatch master.
- [ ] SC-004 proven: `untranslatable`-labeled → blank EN; absent translation → fail loud.
- [ ] SC-006 proven: real end-to-end build of PB-P055 (archive.org) and PB-P054 (Gallica extract)
      — the two sources unbuildable before this feature.
