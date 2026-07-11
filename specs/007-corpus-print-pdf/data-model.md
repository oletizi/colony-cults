# Data Model: Corpus Print PDF (spec 007)

The PDF builder produces an in-memory **`Edition`** view model from the pinned snapshot + bibliography
SSOT, then serializes it to the Typst input JSON. These are pure types (`src/pdf/model.ts`, no
runtime). Inputs reused verbatim: `CorpusSnapshot` / `RawSource` / `RawIssue` / `RawPage` /
`ProvenanceRecord` from `@/browser/model`; `Source` / `Rights` / `CopyIdentifier` from `@/model`.

## Entities

### Edition

The complete artifact model for **one** bibliographic item (one PDF).

- `itemId: string` — the built unit's id (issue id for a periodical issue; source id for a monograph).
- `kind: 'issue' | 'monograph'` — drives front-matter wording and the built-unit rule.
- `titlePage: TitlePageMeta` — front-matter metadata.
- `pages: EditionPage[]` — ordered facing-page spreads (one per source page).
- `colophon: ColophonMeta` — reproducibility + framing back matter.

**Validation**: `pages.length ≥ 1` (an item with zero pages fails loud); `pages` ordered by source
sequence; `itemId` non-empty. `kind` derived from `RawSource.kind` (`periodical` → per-issue `issue`;
`monograph` → `monograph`).

### TitlePageMeta

Front-matter source metadata (FR-004).

- `title: string` — canonical title (snapshot `RawSource.title`).
- `creator: string | null` — from bibliography SSOT `Source.creator`; `null` only if the SSOT omits it.
- `date: string` — issue date (`RawIssue.date`) for an issue; source date for a monograph.
- `rights: string` — `RawSource.rights` (must be present).
- `ark: string | null` — stable identifier (`RawPage.ark` is issue-level; source ark via SSOT).
- `catalogUrl: string | null` — from SSOT `RepositoryRecord.catalogUrl`.

**Validation**: `title` and `rights` non-empty (fail loud if absent). `creator`/`ark`/`catalogUrl` may
be `null` and render as "—"; they never block the build (catalog completeness is not this feature's job).

### EditionPage

One facing-page spread: verso facsimile, recto FR OCR │ EN translation (FR-002, FR-011).

- `pageId: string` — snapshot `RawPage.pageId`.
- `folioId: string` — `RawPage.folioId` (e.g. `f001`), used for the image request + running head.
- `image: ImageAsset` — the fetched print-resolution scan (verso).
- `ocrFrench: string` — `RawPage.correctedFrench ?? RawPage.ocrFrench` (recto left column).
- `english: string` — `RawPage.english`, the **per-page** translation (recto right column).
- `ocrCondition: string | null` — `RawPage.ocrCondition` (surfaced as an apparatus note).

**Validation**: `english` non-empty — a page without per-page EN **fails loud** (FR-011; no issue-level
fallback). `ocrFrench` non-empty. `image` present and sha256-verified (see ImageAsset).

### ImageAsset

The print-resolution page scan embedded on the verso.

- `objectStoreKey: string` — B2 key (snapshot `RawPage.objectStoreKey`; **must be non-null**).
- `sha256: string` — expected checksum (`RawPage.provenance.sha256`).
- `bytesPath: string` — local path to the fetched, verified image (build temp dir).
- `provider: 'b2-cdn' | 'source-iiif'` — which source served the bytes.
- `width: number | null`, `height: number | null` — pixel dimensions if known.

**Validation**: `objectStoreKey` non-null/non-empty (a page with no key fails loud — FR-009); the
fetched bytes' sha256 **must equal** `sha256` (mismatch fails loud — Principle III).

### ColophonMeta

Reproducibility + critical framing back matter (FR-005, FR-016).

- `archiveRef: string` — the pinned archive commit (`site/data/archive-source.json` `.ref`).
- `snapshotSourceId: string` — the built source id.
- `images: ColophonImage[]` — per embedded image: `{ folioId, objectStoreKey, sha256 }`.
- `translation: MachineAssistLabel` — `{ engine, model, retrieved }` (the machine-assisted label;
  from the snapshot-carried per-page translation provenance — research Decision 3).
- `framing: string` — the fixed critical-framing statement (propaganda held as evidence).

**Validation**: `archiveRef` non-empty (no pin → fail loud, the build is not reproducible without it);
`images` covers every embedded image; `translation.engine` + `translation.retrieved` present (the
machine-assist label is mandatory — Principle III / IV translation policy).

### MachineAssistLabel

- `engine: string` — e.g. `claude-code-cli` / `codex-cli` (snapshot per-page translation provenance).
- `model: string | null` — model id if recorded.
- `retrieved: string` — ISO date the translation was produced.

## Relationships

```text
Edition (1 item → 1 PDF)
 ├── titlePage : TitlePageMeta         (snapshot RawSource + bibliography SSOT)
 ├── pages[]   : EditionPage           (one per RawPage, ordered)
 │      ├── image   : ImageAsset        (B2/IIIF bytes, sha256-verified)
 │      ├── ocrFrench : string          (RawPage.correctedFrench ?? ocrFrench)
 │      └── english   : string          (RawPage.english — per-page, required)
 └── colophon : ColophonMeta            (pin + per-image key/sha256 + machine-assist label + framing)
```

Source of each field:
- **Snapshot** (`@/browser/load/snapshot`): title, rights, ark(issue), page structure, ocrFrench,
  english, objectStoreKey, sha256, machine-assist label (post-extension).
- **Bibliography SSOT** (`@/bibliography`): creator, catalogUrl, source-level ark.
- **Pin file** (`site/data/archive-source.json`): archiveRef.
- **B2 / IIIF at build**: ImageAsset.bytesPath (+ width/height), sha256-verified.

## Fail-loud rules (summary)

1. Item with zero pages → error naming the item (Edition validation).
2. Page with empty `english` (no per-page EN) → error naming source/issue/page (FR-011).
3. Page with empty `ocrFrench` → error naming the page.
4. Page with null/empty `objectStoreKey` → error (FR-009).
5. Fetched image sha256 ≠ recorded sha256 → error naming the folio (Principle III).
6. Missing `title` / `rights` / `archiveRef` → error (front matter / reproducibility incomplete).
7. Typst binary absent or `typst compile` non-zero → error surfaced verbatim (Principle V/VIII).

No fallback, mock, or placeholder substitutes for any of the above (Constitution V).
