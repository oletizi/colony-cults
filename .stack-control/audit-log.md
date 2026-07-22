# Audit Log

Durable record of audit findings + their dispositions. Status values: `open` → `fixed-<sha>` → `verified-<date>`, or `acknowledged-<date>` with a substantive reason.

---

## impl:feature/edition-publishing (govern --mode implement, 2026-07-12)

The cross-model audit-barrage (claude / sonnet / codex-gpt-5.5) was **killed by the
harness before convergence** (the known environmental limitation in this session — it
cannot complete the multi-round barrage; same as impl:feature/corpus-print-pdf). Findings
were **harvested from the partial fleet output** and from a controller whole-feature review,
fixed, and re-verified; convergence was then recorded via `govern --override` after
extensive live validation (64 publish tests + full suite green + typecheck clean + all
`src/pdf/publish/*` modules ≤ 500 lines).

- **AUDIT-BARRAGE-codex-01** — HIGH — `validatePublicationRightsBasis` accepted a
  whitespace-only `rightsBasis` (checked `!== ''` without trimming), so a provenance-empty
  published record could validate as clean while the publish rights-gate (which trims) would
  have refused it. **fixed-f992e09** (trim before the emptiness check + whitespace-only test).
- **CONTROLLER-01** — MEDIUM — `publishIssue` uploaded the PDF to the store *before* reading
  the build `input.json` for the page count; a missing/malformed `input.json` then failed the
  issue *after* the upload, orphaning an unrecorded artifact. **fixed-f992e09** (read build
  metadata before the side-effecting upload).

Fleet coverage note (US2 observability): the barrage was a **degraded/killed** run — claude
lane stalled at 57 events, sonnet mid-review, codex emitted one HIGH finding. Not a
full-convergence quiet round; the override records this explicitly rather than treating the
killed run as clean.

---

## impl:feature/archive-direct-pdf (govern --mode implement, 2026-07-17)

The cross-model audit-barrage was again **killed by the harness before convergence** (same
environmental limitation) — this run died very early (claude 10 / sonnet 20 events, codex
emitted nothing), so **no barrage findings were produced to harvest**. Findings came from a
**controller whole-feature review**; both are non-blocking for the target sources and were
**captured to the backlog** rather than fixed pre-ship (neither affects correctness for
PB-P054/P055/P002, which all build green). Convergence recorded via `govern --override` after
extensive live validation (132 pdf tests + full suite green + typecheck clean + all
`src/pdf/load/archive-*` modules ≤ 500 lines; end-to-end integration proof of both variants +
untranslatable + sha256 verification).

- **CONTROLLER-01** — LOW (quality) — the monograph title-page `date` falls back to the folio
  `retrieved` (acquisition) timestamp; a scholarly facsimile should show the imprint year.
  Needs a date-source decision (a structured Source date field, or parsing the bibliography
  `Years:` note). **acknowledged-2026-07-17 → TASK-38** (backlog).
- **CONTROLLER-02** — LOW (latent bug) — `archive-edition.ts` hard-requires `issue.txt` even
  when per-page `pNNN.fr.txt` OCR exists; a per-page-OCR-only source with no `issue.txt` would
  fail early. Latent (all current targets carry `issue.txt`). **acknowledged-2026-07-17 →
  TASK-39** (backlog).

Fleet coverage note: the killed run produced no cross-model signal; convergence rests on the
controller review + live validation, recorded explicitly via override (not treated as a clean
quiet round).
