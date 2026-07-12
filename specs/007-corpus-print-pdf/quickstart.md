# Quickstart: Corpus Print PDF (spec 007)

A validation guide proving the facing-page facsimile edition builds end-to-end. Implementation
details live in `tasks.md`; contracts in `contracts/`; entities in `data-model.md`.

## Prerequisites

- Node 20 + repo deps installed (`npm install`).
- **Typst CLI** on `PATH` (`typst --version`) — documented build dependency (research Decision 1).
- The committed snapshot present: `site/data/PB-P001.json.gz` and the pin `site/data/archive-source.json`.
- B2 access for image bytes: `COLONY_S3_BUCKET` / `COLONY_S3_ENDPOINT` / `COLONY_S3_REGION` set and
  `~/.config/backblaze/b2-credentials.txt` present (reuses `@/archive` `resolveObjectStoreConfig`).
  Or pass `--provider iiif` to fetch full-size scans from the public IIIF endpoint instead.

## Build a single issue (US1 — the MVP)

```bash
npm run pdf:build -- PB-P001/1879-08-15_bpt6k56068358 --out build/pdf
```

**Expected**: one PDF at `build/pdf/PB-P001/1879-08-15_bpt6k56068358.pdf` that opens and contains,
in order:

1. A **title page** — canonical title, creator, issue date, rights, ARK/catalog URL (FR-004).
2. A **facing-page spread per source page** — verso = the facsimile scan; recto = that page's French
   OCR (left column) │ English translation (right column), with the OCR/translation visibly labeled
   machine-derived (FR-002, FR-003, FR-011).
3. A **colophon** — pinned archive commit, each embedded image's B2 key + sha256, the machine-assisted
   translation label (engine + date), and the critical-framing statement (FR-005).

## Build a whole source / the corpus (US2)

```bash
npm run pdf:build -- PB-P001            # 78 issue PDFs
npm run pdf:build -- --all              # full v1 corpus (PB-P001 issues + PB-P008–011 monographs)
```

**Expected**: exactly one PDF per bibliographic item (FR-001, SC-001). Re-running against the same
pin produces content-identical PDFs (SC-004).

## Fail-loud checks (Constitution V — these MUST error, not degrade)

| Scenario | Expected |
|----------|----------|
| A page with empty per-page English | Aborts naming source/issue/page (FR-011) — no issue-level fallback. |
| A page with a null object-store key | Aborts naming the page (FR-009). |
| A fetched image whose sha256 ≠ recorded | Aborts naming the folio + both hashes (Principle III). |
| `typst` binary absent | Aborts naming the missing dependency (G-6). |
| Missing pin file `archive-source.json` | Aborts — build is not reproducible without the pin. |

## Automated validation

```bash
npm run pdf:test        # vitest run tests/unit/pdf tests/integration/pdf
npm run typecheck       # tsc --noEmit — no any/as/@ts-ignore
```

The integration test builds a real PB-P001 issue to a Typst *input document* (JSON) with an
in-memory `ObjectStore` fake + fake `TypstRunner` — no network, no Typst binary required — and
asserts the edition-builder and typst-input guarantees (`contracts/edition-builder.md`,
`contracts/typst-template.md`).

## Design gate (Constitution XI — do before authoring the template)

The Typst template's typography and layout (`pdf/template/edition.typ`, fonts) are designed through
`/frontend-design:frontend-design` **before** any template markup is written, reusing the
Prospectus/Dossier tokens. This is a hard prerequisite task, not an afterthought (FR-013).
