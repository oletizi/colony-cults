# Quickstart / Validation: Source-Group Facsimile PDF

Runnable scenarios that prove the feature works end-to-end. See
[contracts/cli.md](./contracts/cli.md) and [data-model.md](./data-model.md) for
details.

## Prerequisites

- A resolvable archive root at latest main: `COLONY_ARCHIVE_ROOT` (or
  `--archive-root`) — e.g. the `edition-publishing-archive` clone.
- Object-store (B2) access for asset bytes (`COLONY_S3_*` + B2 credentials).
- The `typst` binary on PATH.
- Load env once per shell: `set -a; source .env; set +a`.

## Scenario 1 — one Papers Past member (US1, SC-001)

```bash
npx tsx scripts/build-pdf.ts PB-P061 --no-french --out build/pdf
```

Expected: one PDF at `build/pdf/...PB-P061...pdf`; verso is the reconstructed
clipping (its 3 segments stacked); recto is the English OCR reading text; colophon
states OCR transcription (no MT claim) + pinned archive ref. No
"no archive layout registered" error.

## Scenario 2 — the combined PB-P060 group edition (US2, SC-002)

```bash
npx tsx scripts/build-pdf.ts PB-P060 --no-french --out build/pdf
```

Expected: exactly one PDF containing every acquired member as a date-ordered
section, with one edition-level colophon + pinned archive ref.

## Scenario 3 — no regression (US3, SC-003)

```bash
npx tsx scripts/build-pdf.ts PB-P057 --out build/pdf   # English monograph, unchanged
```

Expected: output identical to pre-feature; the member's existing `issue.txt` is
untouched (no materialization runs for a source that already has one).

## Scenario 4 — batch discovery + attributable failure (US4, SC-004/SC-005)

```bash
npx tsx scripts/build-pdf.ts --all --out build/pdf
```

Expected: buildable members are discovered and built alongside standalone sources;
any member with an unresolvable input is listed as `FAIL <id>: <reason>` in the
summary; siblings still build; the run prints "built N, failed M" and exits
non-zero when M > 0.

## Automated validation

- Unit: `npx vitest run tests/unit/pdf` — member-layout registration in
  discovery, `materializeIssueText` (from an ocr-text fixture; idempotency +
  conflict + no-op-when-issue.txt-exists), segment-stacking verso assembly, group
  ordering.
- Integration: `npx vitest run tests/integration/pdf` — member end-to-end and group
  edition against a fixture archive (fake Typst runner + fixture fetch).
