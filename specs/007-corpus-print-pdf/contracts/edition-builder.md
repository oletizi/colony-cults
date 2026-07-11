# Contract: Edition builder

Assembles the `Edition` view model for one item from the pinned snapshot + bibliography SSOT.
Pure data assembly — no image bytes, no Typst.

```ts
// src/pdf/load/edition.ts
export interface EditionBuilder {
  build(sourceId: string, itemId: string): Edition; // itemId = issueId | sourceId (monograph)
}
export function makeEditionBuilder(deps: {
  snapshot: CorpusSnapshotReader;   // @/browser/load/snapshot
  sourceMeta: SourceMetaReader;     // @/bibliography (creator, catalogUrl, source ark)
  pin: ArchivePinReader;            // site/data/archive-source.json → { ref }
}): EditionBuilder;
```

## Guarantees

- **G-1 (page-count coherence)**: `Edition.pages.length` equals the snapshot issue's page count;
  pages are ordered by source sequence; an item with zero pages throws naming the item.
- **G-2 (per-page EN required)**: every `EditionPage.english` is non-empty; a page whose snapshot
  `english` is empty throws naming source/issue/page — no issue-level or placeholder fallback (FR-011).
- **G-3 (required layers)**: every page has non-empty `ocrFrench` (`correctedFrench ?? ocrFrench`) and
  a non-null `objectStoreKey` + `sha256`; a missing layer throws naming the page (FR-009).
- **G-4 (front matter completeness)**: `TitlePageMeta.title` and `.rights` are non-empty (throw if
  absent); `creator`/`ark`/`catalogUrl` may be `null` without throwing.
- **G-5 (colophon provenance)**: `ColophonMeta.archiveRef` is the pin's `.ref` (throw if the pin file
  is missing/empty); `images` lists every page's `{folioId, objectStoreKey, sha256}`;
  `translation` carries the machine-assist `{engine, retrieved}` (throw if absent — Principle III).
- **G-6 (no re-derivation)**: the builder reads only the snapshot + SSOT + pin file; it never reads
  the raw archive or re-runs OCR/translation (research Decision 2).
- **G-7 (determinism)**: `build()` is a pure function of its inputs — same snapshot + SSOT + pin →
  structurally identical `Edition` (supports reproducible output, SC-004).

**Fixture**: `tests/integration/pdf/edition.test.ts` builds a real PB-P001 issue and asserts
G-1..G-5 on the happy path, plus a deliberately-blanked-`english` copy asserting the G-2 throw.
